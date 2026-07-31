"""
autofit.py — ShoeAR AR auto-fit (semi-automatic pipeline).

DETERMINISTIC GEOMETRY (NOT machine learning). Given a supplier's shoe .glb +
a few declared facts, it:

  1. VALIDATES the model (format / size / triangle budget + shape sanity).
  2. DETECTS the native unit (mm / cm / m) so the reported dimensions are honest
     and an implausibly-sized model is flagged.
  3. AUTO-ORIENTS the model in two stages:
       (a) PCA aligns the AXES — eigenvectors of the vertex covariance rotate an
           arbitrarily-rotated model to canonical axes (length -> +Z, width -> X,
           height -> Y). PCA is linear algebra, not ML.
       (b) Cross-sectional geometry then fixes the three sign ambiguities PCA
           leaves — sole-down (mass sits low), toe-forward (the heel end is
           taller) — each with a CONFIDENCE score so low-confidence fits are
           flagged for QC instead of silently trusted.
  4. OPTIMISES for the mobile target: downscales oversized textures (the real
     phone bottleneck — lossless to the UV mapping) and decimates high-poly
     geometry to a per-foot triangle budget with quadric edge collapse. Geometry
     decimation is skipped for textured models (the backend drops UVs) and
     flagged for Lens Studio's UV-aware optimiser instead.
  5. BAKES the fit into ONE .glb holding both shoes as named nodes (Shoe_L /
     Shoe_R) — uniform-scaled to real length, sole on Y=0, laid out as a pair —
     which is what Lens Studio publishes to a lens group. Also SUGGESTS the
     anchor transform (where to seat each shoe on its foot binding) so the admin
     pastes numbers instead of eyeballing.
  6. Handles 1 or 2 shoes.

The output REPLACES only the shoe meshes (model_L/R, Shoe_L/R). The template's
Foot Occluder is always retained — without it the shoe renders over the foot and
appears to float — and a high-top collar is flagged so the occluder can be
extended up the ankle. Two shoes are separated STRUCTURE-FIRST — named
     nodes (_L/_R) > connected components > geometric split — so the reliable
     methods are preferred and the unreliable one is reported with low
     confidence. A single shoe is mirrored for the other foot (branding
     reversed — supplier is warned).

Runs OFFLINE in the ML service, so it does NOT hit Camera Kit's
"no network + biometric tracking in one lens" restriction (which is why full
runtime auto-generation isn't possible — see ar-lens-prototype/README.md).
"""

import io
import gc
import os
import sys
import time
import numpy as np
import trimesh


def _blog(msg):
    """Build-path timing line. OFF by default (quiet in normal runs); set the env
    var AUTOFIT_DEBUG=1 to enable — diag_build.py does this automatically. Flushed
    immediately so it shows in the console even if the next step hangs, which is
    how we pinpoint a slow/stuck build step."""
    if not os.environ.get("AUTOFIT_DEBUG"):
        return
    print("[autofit build] %s" % msg, file=sys.stderr, flush=True)

try:
    from PIL import Image
except Exception:                # Pillow ships with trimesh's texture support
    Image = None

MAX_BYTES = 50 * 1024 * 1024     # 50 MB — generous; Lens Studio optimises at publish
TRI_TARGET = 50_000              # per-foot triangle budget for real-time mobile AR
MAX_TEX = 2048                   # cap texture edge (px) — the real mobile bottleneck
# Camera Kit rejects any lens whose bundle exceeds 8 MB at publish, and the
# fitted .glb is by far the biggest thing in the lens. So the build TARGETS a
# little under the cap (headroom for Lens Studio's own overhead) and, if the
# export is still over, shrinks textures step by step until it fits.
LENS_MAX_BYTES = 8 * 1024 * 1024         # Camera Kit hard per-lens cap
LENS_TARGET_BYTES = 7 * 1024 * 1024      # aim here so we clear the cap with headroom
MIN_TEX = 256                    # don't shrink textures below this while fitting to size
DEFAULT_LENGTH_CM = 26.0         # average adult foot if none declared
MIN_PLAUSIBLE_CM = 5.0           # a real shoe is never shorter than this
MAX_PLAUSIBLE_CM = 55.0          # ...or longer than this (after unit conversion)
HIGH_TOP_CM = 12.0               # collar higher than this -> boot/high-top (occluder)
SPLIT_MAX_FACES = 400_000        # skip connected-component splits above this (too heavy)
HARD_MAX_FACES = 4_000_000       # reject a genuinely degenerate file that could OOM on load
                                 # (real shoe models are well under ~1.5M — never affected)
_TEX_ATTRS = ("baseColorTexture", "emissiveTexture", "normalTexture",
              "occlusionTexture", "metallicRoughnessTexture", "image")


# --------------------------------------------------------------------------- #
#  Loading / geometry helpers
# --------------------------------------------------------------------------- #
def _combined(loaded):
    """Collapse a Trimesh or Scene into one Trimesh (for whole-model analysis)."""
    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    if isinstance(loaded, trimesh.Scene):
        geoms = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not geoms:
            return None
        return trimesh.util.concatenate(geoms)
    return None


def _detect_unit(mesh):
    """Guess the native modelling unit from the longest axis and return
    (scale_to_metres, unit_name). Shoes are ~0.26 m, so a longest axis of a few
    hundred is millimetres, a few tens is centimetres, a fraction of one is
    metres. Output is unaffected (we rescale to a real length either way) — this
    only makes the reported native size honest and flags implausible models."""
    longest = float(mesh.extents.max())
    if longest > 100.0:
        return 0.001, "mm"
    if longest > 5.0:
        return 0.01, "cm"
    if longest > 0.02:
        return 1.0, "m"
    return 1.0, "unknown"


def _has_uv_texture(mesh):
    """True if the mesh carries a UV-mapped image texture (so decimation, which
    drops UVs with this backend, would destroy it)."""
    v = getattr(mesh, "visual", None)
    if v is None or getattr(v, "uv", None) is None:
        return False
    mat = getattr(v, "material", None)
    if mat is None:
        return False
    return any(getattr(mat, a, None) is not None for a in _TEX_ATTRS)


def _max_texture_px(mesh):
    """Largest texture edge (px) on the mesh, read-only (no resize). Cheap — used
    to report what texture optimisation WOULD do without doing the heavy work."""
    v = getattr(mesh, "visual", None)
    mat = getattr(v, "material", None) if v is not None else None
    if mat is None:
        return 0
    biggest = 0
    for a in _TEX_ATTRS:
        img = getattr(mat, a, None)
        if img is not None and hasattr(img, "size"):
            biggest = max(biggest, max(img.size))
    return biggest


def _optimize_textures(mesh, max_dim):
    """Downscale oversized textures to max_dim — on a phone a 4K texture costs
    more than the triangles, and it's the same 0..1 UVs afterwards so the
    mapping is untouched (lossless to the fit). Returns (before_px, after_px,
    resized_count). No-op if Pillow is unavailable."""
    if Image is None:
        return 0, 0, 0
    v = getattr(mesh, "visual", None)
    mat = getattr(v, "material", None) if v is not None else None
    if mat is None:
        return 0, 0, 0
    before_px = after_px = resized = 0
    for a in _TEX_ATTRS:
        img = getattr(mat, a, None)
        if img is None or not hasattr(img, "size"):
            continue
        w, h = img.size
        before_px = max(before_px, w, h)
        if max(w, h) > max_dim:
            s = max_dim / float(max(w, h))
            nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
            try:
                setattr(mat, a, img.resize((nw, nh), Image.LANCZOS))
                resized += 1
                after_px = max(after_px, nw, nh)
            except Exception:
                after_px = max(after_px, w, h)
        else:
            after_px = max(after_px, w, h)
    return before_px, after_px, resized


# ── Lens Studio foot-binding calibration ────────────────────────────────────
# Where a normalised shoe (sole at Y=0, X/Z centred, metres) must sit under the
# foot-tracking template's foot binding so the foot OCCLUDER ends up INSIDE the
# shoe. These are CONSTANTS, not geometry-derived: the occluder is the user's
# real foot (the same for every product) and the binding origin is a fixed point
# on it, so once our mesh is normalised the seat is the same for every shoe.
#
# Calibrated in Lens Studio (semi-auto lens, LS 5.22) by seating a shoe against
# the foot occluders: the binding origin sits ~5 cm above the sole, and the shoe
# is centred front/back and left/right on the foot. The earlier opening-based
# guess assumed the origin was at the ankle, which dropped the shoe ~8 cm too far
# and pushed it ~7 cm too far forward. Retune these if the foot rig changes.
#   position: base (right) foot below; the left foot is the same with X negated.
#   scale:    fit-to-foot — we scale every shoe to a fixed ON-SCREEN length so it
#             covers the (fixed) occluder with a little reserve, regardless of the
#             model's real size. See FOOT_COVER_LENGTH_CM.
FOOT_BIND_DROP_CM = 5.0    # lower the shoe this far so its sole meets the foot sole
FOOT_BIND_Z_CM = 0.7       # nudge forward onto the foot — both test shoes agreed on +0.7
FOOT_BIND_X_CM = 0.0       # centred. A per-model ±~0.6 lateral nudge is left to QC: its
                           # SIGN varied between test shoes (each model's foot cavity is
                           # centred a hair differently), so it isn't a fixed constant.

# On-screen (Lens Studio) shoe LENGTH in cm that covers the template's foot
# occluder with a little reserve — a real foot reads slightly bigger than the
# occluder proxy, so a skin-tight fit leaves the foot poking out. Calibrated on
# device: scale 110 covered a 27.9 cm (UK 8) shoe → 27.9 × 1.10 ≈ 30.7 cm.
# The occluder is fixed, so we scale EVERY shoe to this length regardless of its
# real size → it always wraps the foot. Lens Studio scale = this ÷ the model's
# real length (in metres), which gives ≈110 for a 27.9 cm shoe and auto-adjusts
# for any other declared size. Retune if the foot rig / desired fit changes.
FOOT_COVER_LENGTH_CM = 30.7


def _anchor(mesh_norm):
    """Suggest how to seat the fitted shoe onto the Lens Studio foot binding, so
    the admin pastes numbers instead of eyeballing. Works on the NORMALISED mesh
    (metres; sole on Y=0, X/Z centred, toe +Z, heel -Z).

    The seat POSITION is a CALIBRATED CONSTANT (see FOOT_BIND_* above), not derived
    from the shoe's opening: the foot occluder is fixed, so the binding origin sits
    at a fixed height above the sole for every product. The SCALE is size-aware —
    we scale the shoe to a fixed on-screen length (FOOT_COVER_LENGTH_CM) so it
    covers the fixed occluder regardless of the model's real size. We still read
    the collar/toe from the geometry, but only for the high-top occluder note. A
    SUGGESTION the admin fine-tunes in QC."""
    b = mesh_norm.bounds
    zmin, zmax = float(b[0][2]), float(b[1][2])
    ymax = float(b[1][1])
    lz = zmax - zmin
    V = np.asarray(mesh_norm.vertices, dtype=np.float64)
    rear_top = V[(V[:, 2] <= zmin + 0.35 * lz) & (V[:, 1] >= 0.60 * ymax)]
    opening = rear_top.mean(axis=0) if len(rear_top) else np.array([0.0, ymax, zmin])
    collar_cm = round(float(opening[1]) * 100, 1)
    # Lens Studio scale that makes the shoe FOOT_COVER_LENGTH_CM long on screen.
    # lz is the real length in metres, so (cover_cm / lz) already folds in the
    # metres→cm 100x (e.g. 30.7 / 0.279 ≈ 110). Fall back to 100 if length is odd.
    cover_scale = round(FOOT_COVER_LENGTH_CM / lz, 1) if lz > 1e-6 else 100.0
    return {
        "assumption": "position calibrated to the foot-tracking binding; scale sized to cover the foot occluder",
        "positionCm": [FOOT_BIND_X_CM, round(-FOOT_BIND_DROP_CM, 1), FOOT_BIND_Z_CM],
        "rotationDeg": [0.0, 0.0, 0.0],
        "scale": [cover_scale, cover_scale, cover_scale],
        "toeTipCm": round(zmax * 100, 1),
        "collarHeightCm": collar_cm,
        "note": "Left foot mirrors X (negate position X). Set the Lens Studio Scale to this value on both feet — it sizes the shoe to cover the foot with a little margin.",
    }


def _decimate(mesh, target_faces):
    """Reduce the triangle count to <= target with quadric edge collapse — it
    merges the vertex pairs that change the silhouette least, so the shoe still
    looks the same but renders far faster on a phone. This is what makes the
    output safe for real-time mobile AR (and keeps the lens under Camera Kit's
    8 MB cap) instead of leaving it to the supplier.

    Preserves the UV texture. trimesh stores UVs per-vertex, and
    fast-simplification can hand back the sequence of vertex collapses and
    "replay" them, giving a map from every original vertex to its surviving
    vertex — so we carry the UVs (and the material/image) onto the decimated
    mesh. This is why textured shoes can now be decimated too: the old path
    dropped UVs, so heavy textured models used to skip decimation and blow past
    the 8 MB cap.

    Returns (mesh, before, after, applied). Graceful: if the simplifier backend
    (fast-simplification) isn't installed, or the UV replay fails, returns the
    original unchanged rather than silently dropping the texture."""
    before = int(len(mesh.faces))
    if before <= target_faces:
        return mesh, before, before, False

    uv = None
    vis = getattr(mesh, "visual", None)
    if vis is not None and getattr(vis, "uv", None) is not None:
        _uv = np.asarray(vis.uv, dtype=np.float32)
        if _uv.ndim == 2 and _uv.shape[0] == len(mesh.vertices):
            uv = _uv                                  # per-vertex UVs we can carry across collapses

    # Untextured (or UVs we can't map safely): the simple, exact path.
    if uv is None:
        try:
            simplified = mesh.simplify_quadric_decimation(face_count=int(target_faces))
        except Exception:
            return mesh, before, before, False
        after = int(len(simplified.faces))
        if after == 0 or after >= before:
            return mesh, before, before, False
        return simplified, before, after, True

    # Textured: decimate the geometry AND replay the collapses onto the UVs so
    # the texture still maps.
    try:
        import fast_simplification as _fs
        pts = np.asarray(mesh.vertices, dtype=np.float32)
        faces = np.asarray(mesh.faces, dtype=np.int64)
        reduction = min(0.99, max(0.0, 1.0 - float(target_faces) / float(before)))
        _, _, collapses = _fs.simplify(pts, faces, target_reduction=reduction,
                                       return_collapses=True)
        rv, rf, mapping = _fs.replay_simplification(pts, faces, collapses)
        after = int(len(rf))
        if after == 0 or after >= before:
            return mesh, before, before, False
        mapping = np.asarray(mapping)
        new_uv = np.zeros((len(rv), 2), dtype=np.float32)
        new_uv[mapping] = uv                          # surviving vertex keeps its UV
        material = getattr(vis, "material", None)
        new_vis = trimesh.visual.TextureVisuals(uv=new_uv, material=material)
        out = trimesh.Trimesh(vertices=rv, faces=rf, visual=new_vis, process=False)
        return out, before, after, True
    except Exception:
        return mesh, before, before, False


def _pca_align(mesh, trust_file=False):
    """Return (copy rotated to canonical axes, axis_conf).

    Canonical: length -> Z, width -> X, height -> Y, centred at the origin.

    The LENGTH axis is the largest PCA spread (toe->heel). The other two (width
    and height) are NOT assigned by variance order — that laid tall boots on
    their side, because a boot's shaft spreads almost as much as its length. We
    decide which of the two is UP with TWO INDEPENDENT cues and cross-check them:

      1. LOP-SIDEDNESS (skewness). Every shoe has a flat sole, so along its up
         axis the mass is bunched to one end (thick sole low, thin/open top),
         while the width axis is left-right balanced. Higher |skewness| -> up.
      2. MIRROR SYMMETRY (voxel overlap). A shoe is left-right symmetric, so a
         coarse occupancy grid mirrored across the WIDTH plane lands almost on
         top of itself (high overlap); mirrored across the HEIGHT plane it does
         NOT (the flat sole is nothing like the open collar). Lower overlap ->
         up. This uses SHAPE OCCUPANCY, not mass, so it's independent of cue 1.

    These attack the problem from opposite ends (cue 1 finds "up" by mass, cue 2
    finds "the symmetric side" by shape). When they AGREE we're confident; DISAGREE
    (a near-cubic / unusual model) we keep the skewness pick but report a LOW
    axis_conf so the orientation is flagged for a human instead of trusted.
    Deterministic geometry, not ML. Signs (toe/heel, sole down) come later.

    axis_conf is 0..1: >=0.6 means the two cues agree (trust the up axis); <0.4
    means they conflict (verify)."""
    m = mesh.copy()
    V = np.asarray(m.vertices, dtype=np.float64)
    if len(V) < 3:
        return m, 0.0
    c = V.mean(axis=0)

    if trust_file:
        # Trust the file's own orientation (assume +Y up — the glTF convention,
        # and what the supplier sees in any viewer). We do NOT run PCA here: for a
        # boot, PCA's largest-variance axis is the DIAGONAL from the toe up to the
        # top of the shaft, so aligning to it tilts the shoe ~45° ("like a tick").
        # Instead we read the AXIS-ALIGNED extents, call the longer horizontal axis
        # the length, and rotate ONLY about Y (a yaw) to put length->Z, width->X.
        # The model keeps the supplier's exact upright pose; we just tidy the axes
        # so the length scale and side-by-side pairing are correct.
        ext = V.max(axis=0) - V.min(axis=0)
        axis_h = np.array([0.0, 1.0, 0.0])
        if float(ext[0]) >= float(ext[2]):          # length runs along file X
            axis_l = np.array([1.0, 0.0, 0.0]); axis_w = np.array([0.0, 0.0, 1.0])
        else:                                        # length runs along file Z
            axis_l = np.array([0.0, 0.0, 1.0]); axis_w = np.array([1.0, 0.0, 0.0])
        P = np.column_stack([axis_w, axis_h, axis_l])
        if np.linalg.det(P) < 0:
            P[:, 0] = -P[:, 0]                      # proper rotation (width side is arbitrary)
        T = np.eye(4)
        T[:3, :3] = P.T
        T[:3, 3] = -P.T @ c
        m.apply_transform(T)
        return m, 1.0

    cov = np.cov(V - c, rowvar=False)
    _, vecs = np.linalg.eigh(cov)          # eigenvalues ascending
    axis_l = vecs[:, 2]                     # largest spread -> length (Z)
    cand = [vecs[:, 0], vecs[:, 1]]         # the two smaller: width & height (order TBD)

    tc = np.asarray(m.triangles_center, dtype=np.float64) - c
    aw = np.asarray(m.area_faces, dtype=np.float64)
    wsum = float(aw.sum()) if aw.sum() > 1e-12 else 1.0

    # cue 1 — area-weighted |skewness| of the triangle centres along an axis:
    # high for the up-axis (flat sole makes the mass lop-sided), ~0 for width.
    def _skew(axis):
        p = tc @ axis
        mean = float((p * aw).sum() / wsum)
        var = float(((p - mean) ** 2 * aw).sum() / wsum)
        if var < 1e-12:
            return 0.0
        return abs(float(((p - mean) ** 3 * aw).sum() / wsum) / (var ** 1.5))

    # cue 2 — mirror symmetry via a coarse voxel occupancy grid (robust to mesh
    # sampling, unlike point-to-point distances). Points are expressed in the
    # (cand0, cand1, length) frame, binned into an occupancy grid, and compared
    # to the grid mirrored along cand-axis k. IoU ~1 => that axis is a symmetry
    # plane (the width side); low IoU => the asymmetric (height) side.
    pts_all = np.vstack([V, np.asarray(m.triangles_center, dtype=np.float64)]) - c
    frame = np.column_stack([cand[0], cand[1], axis_l])
    coords = pts_all @ frame

    def _sym_iou(k, nbins=24):
        mins = coords.min(axis=0)
        span = coords.max(axis=0) - mins
        span[span < 1e-9] = 1.0
        idx = np.clip(((coords - mins) / span * (nbins - 1e-6)).astype(int), 0, nbins - 1)
        grid = np.zeros((nbins, nbins, nbins), dtype=bool)
        grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        mir = np.flip(grid, axis=k)
        union = int((grid | mir).sum())
        return (int((grid & mir).sum()) / union) if union else 1.0

    s0, s1 = _skew(cand[0]), _skew(cand[1])
    io0, io1 = _sym_iou(0), _sym_iou(1)              # symmetry of cand0, cand1

    def _margin(x0, x1):                             # 0 (tied) .. 1 (one dominates)
        return abs(x0 - x1) / (abs(x0) + abs(x1) + 1e-12)

    skew_pick = 0 if s0 >= s1 else 1                 # higher skew    => up (height)
    sym_pick = 0 if io0 <= io1 else 1                # lower symmetry => up (height)
    agree = (skew_pick == sym_pick)
    sm, im = _margin(s0, s1), _margin(io0, io1)
    if agree:
        up = skew_pick
        axis_conf = round(0.6 + 0.4 * min(1.0, max(sm, im) / 0.25), 2)   # 0.6 .. 1.0
    else:
        up = skew_pick if sm >= im else sym_pick     # trust the more decisive cue
        axis_conf = round(0.25 + 0.14 * min(1.0, max(sm, im) / 0.25), 2)  # stays < 0.4

    axis_h = cand[up]
    axis_w = cand[1 - up]

    P = np.column_stack([axis_w, axis_h, axis_l])   # canonical -> principal
    if np.linalg.det(P) < 0:
        P[:, 0] = -P[:, 0]                          # keep a proper rotation (no mirror)
    T = np.eye(4)
    T[:3, :3] = P.T                                 # principal -> canonical
    T[:3, 3] = -P.T @ c                             # centre at origin
    m.apply_transform(T)
    return m, axis_conf


def _xz_footprint(tc, mask):
    """Footprint spread (X x Z bbox area) of the triangle centres in a slab."""
    p = tc[mask][:, [0, 2]]
    if len(p) < 3:
        return 0.0
    return float((p[:, 0].max() - p[:, 0].min()) * (p[:, 1].max() - p[:, 1].min()))


def _vertical_skew(m):
    """Area-weighted |skewness| of the triangle centres along Y (up). High when
    one Y-end carries much more material (the flat sole vs the open collar); low
    for a shoe resting on its left-right-symmetric side."""
    tc = np.asarray(m.triangles_center, dtype=np.float64)
    aw = np.asarray(m.area_faces, dtype=np.float64)
    w = float(aw.sum()) or 1.0
    p = tc[:, 1] - float((tc[:, 1] * aw).sum() / w)
    var = float(((p ** 2) * aw).sum() / w)
    if var < 1e-12:
        return 0.0
    return abs(float(((p ** 3) * aw).sum() / w) / (var ** 1.5))


def _surface_flatness(m, contact_frac=0.6):
    """Roughness of the OUTER surface on each Y-end, as (flat_bottom, flat_top).

    Grid the footprint (X x Z) into cells; in each occupied cell take the lowest
    surface point (traces the bottom skin) and the highest (traces the top skin).
    The spread of those per-cell heights, normalised by shoe height, is SMALL for
    a flat continuous sheet (the outsole / midsole / feather edge) and LARGE for a
    shaped upper (topline opening, tongue, eyestay, laces). So the flatter Y-end is
    the sole. This is the "flat cluster = base, shaped cluster = upper" cue, and it
    is independent of the footprint-size and centroid cues (it survives tall boots
    whose shaft pulls mass high but whose outsole is still the flat face).

    ARCH-TOLERANT: a real outsole is not a perfect plane — it touches the ground at
    the heel and forefoot and LIFTS in the midfoot (the arch, strongest on the
    medial side), and heeled shoes lift even more. That lift is a MINORITY of the
    surface. So on each side we keep only the outermost `contact_frac` of the cells
    (the band nearest the extreme = the ground-contact band for the sole) and ignore
    the inward-curving arch tail. This makes the number mean the same thing across a
    flat sneaker, an arched shoe and a heel, so one threshold can actually work.

    Returns (flat_bottom, flat_top) with smaller = flatter, or None if too sparse."""
    tc = np.asarray(m.triangles_center, dtype=np.float64)
    if len(tc) < 8:
        return None
    b = m.bounds
    hy = float(b[1][1] - b[0][1])
    if hy < 1e-9:
        return None
    xz = tc[:, [0, 2]]
    mn = xz.min(axis=0)
    sp = xz.max(axis=0) - mn
    sp[sp < 1e-9] = 1.0
    nb = 12
    idx = np.clip(((xz - mn) / sp * (nb - 1e-6)).astype(int), 0, nb - 1)
    key = idx[:, 0] * nb + idx[:, 1]
    y = tc[:, 1]
    order = np.argsort(key, kind="stable")
    key_s, y_s = key[order], y[order]
    bounds = np.flatnonzero(np.diff(key_s)) + 1
    lows, highs = [], []
    for grp in np.split(y_s, bounds):
        lows.append(grp.min())
        highs.append(grp.max())
    if len(lows) < 4:
        return None
    lo = np.asarray(lows, dtype=np.float64)
    hi = np.asarray(highs, dtype=np.float64)
    pf = max(0.1, min(1.0, contact_frac)) * 100.0
    # Bottom skin: the ground-contact band is the LOWEST cells; its thickness is the
    # range from the very bottom up to the contact_frac percentile (the arch, in the
    # upper tail of the lows, is dropped). p2 rather than the raw min ignores strays.
    flat_bottom = float(np.percentile(lo, pf) - np.percentile(lo, 2)) / hy
    # Top skin: mirror image — keep the HIGHEST cells (from the (100-frac) percentile
    # up to the top), so if this end were the sole its arch dip is dropped too.
    flat_top = float(np.percentile(hi, 98) - np.percentile(hi, 100.0 - pf)) / hy
    return flat_bottom, flat_top


def _cavity_wells(m, nb=14):
    """(well_bottom, well_top): how much each Y-face has a CENTRAL DEPRESSION — the
    foot opening (collar/tongue cavity) — vs a raised rim. Grid the footprint; per
    cell take the top surface (max Y) and bottom surface (min Y). At the OPENING end
    the centre of the shoe sinks well below the rim (you're looking into the hole),
    giving a large 'well'; a solid face (the sole) has centre ~ rim, so ~0. This is
    the "which end is the mouth of the shoe" cue — the opposite end is the sole.
    numpy only (no rtree). Returns None if too sparse to judge."""
    tc = np.asarray(m.triangles_center, dtype=np.float64)
    if len(tc) < 20:
        return None
    b = m.bounds
    ymin, ymax = float(b[0][1]), float(b[1][1])
    hy = ymax - ymin
    if hy < 1e-9:
        return None
    xz = tc[:, [0, 2]]
    mn = xz.min(axis=0)
    sp = xz.max(axis=0) - mn
    sp[sp < 1e-9] = 1.0
    gi = np.clip(((xz - mn) / sp * (nb - 1e-6)).astype(int), 0, nb - 1)
    key = gi[:, 0] * nb + gi[:, 1]
    y = tc[:, 1]
    order = np.argsort(key, kind="stable")
    ks, ys, gis = key[order], y[order], gi[order]
    bounds = np.flatnonzero(np.diff(ks)) + 1
    lo, hi, cx, cz = [], [], [], []
    for grp, gg in zip(np.split(ys, bounds), np.split(gis, bounds)):
        lo.append(grp.min()); hi.append(grp.max()); cx.append(gg[0, 0]); cz.append(gg[0, 1])
    lo = np.asarray(lo); hi = np.asarray(hi)
    c = (nb - 1) / 2.0
    rad = np.sqrt((np.asarray(cx) - c) ** 2 + (np.asarray(cz) - c) ** 2) / (c if c > 0 else 1.0)
    centre = rad < 0.45
    rim = rad > 0.6
    if centre.sum() < 3 or rim.sum() < 3:
        return None
    well_top = float(np.median(hi[rim]) - np.median(hi[centre])) / hy   # centre sinks below rim
    well_bot = float(np.median(lo[centre]) - np.median(lo[rim])) / hy   # centre lifts above rim
    return well_bot, well_top


def _cavity_flip(m):
    """Opening-cavity vote for sole-down. Returns (flip_pref, conf): flip_pref True
    if the shoe's OPENING points DOWN (so the sole is up and we must flip), None if
    no real cavity is detected (solid/closed model -> no opinion). conf scales with
    how decisively one end is the mouth."""
    r = _cavity_wells(m)
    if r is None:
        return None, 0.0
    well_bot, well_top = r
    if max(well_bot, well_top) < 0.15:            # neither end is a real cavity -> silent
        return None, 0.0
    denom = abs(well_bot) + abs(well_top) + 1e-9
    return (well_bot > well_top), min(1.0, abs(well_top - well_bot) / denom)


FLAT_SOLE_MAX = 0.35   # a real, arch-tolerant outsole reads at/below this

def _axis_flatness(m, sole_conf, toe_conf):
    """Up-axis sanity GATE. ONLY the sole<->upper axis has a FLAT end (the outsole)
    — the heel/toe ends and the medial/lateral sides are all curved. So once
    oriented, the FLATTER Y-end should be clearly flat; if NEITHER end is flat, the
    model is likely resting on its side / at an angle (a wrong up-axis) and the
    facing we'd report is meaningless.

    Threshold FLAT_SOLE_MAX = 0.35 is calibrated on real uploads: correctly-oriented
    soles read ~0.01-0.04 across a flat sneaker, a high-top, a running pair and a
    heeled boot (the arch-tolerant measure keeps the arch from inflating it). 0.35
    sits ~9x above that cluster, so it cannot false-alarm on a good upload, while a
    mis-oriented model with no flat sole reads far higher. When no flat end is found,
    cap the sole/toe confidence so the report flags the facing for a human check
    (and the 'lying on its side' message fires).

    Returns (sole_conf, toe_conf, axis_flat, flat_sole)."""
    fl = _surface_flatness(m)
    if fl is None:
        return sole_conf, toe_conf, True, None
    flat_sole = min(fl[0], fl[1])                 # the flatter end should be the outsole
    axis_flat = flat_sole <= FLAT_SOLE_MAX
    if not axis_flat:
        sole_conf = min(sole_conf, 0.3)
        toe_conf = min(toe_conf, 0.3)
    return sole_conf, toe_conf, axis_flat, round(flat_sole, 2)


def _stable_align(mesh):
    """AUTO-STRAIGHTEN via STABLE RESTING POSE + sole disambiguation.

    PCA tilts tall shoes (its largest-variance axis is the toe->collar diagonal),
    and a raw "drop on a table" pose flops a high-top onto its big side face. So
    we combine them:
      1. compute_stable_poses enumerates the flat orientations the shoe could
         rest in — this removes any tilt in the upload.
      2. Among those, keep the one whose VERTICAL axis is most lop-sided
         (area-weighted skewness): sole-down is bottom-heavy (high skew), while a
         shoe on its side is left-right symmetric (low skew). This rejects the
         side-resting pose a high-top otherwise prefers.
      3. Fix sole-DOWN by footprint (the sole spreads over the whole foot) and
         toe-forward by heel height, then set length->Z, width->X.

    Returns (mesh, conf) matching _orient_canonical, or None if the pose engine
    is unavailable / the computation fails (caller then falls back to PCA)."""
    try:
        import trimesh.poses as _poses          # needs networkx; optional dependency
    except Exception:
        return None
    if len(mesh.faces) == 0 or len(mesh.vertices) < 4:
        return None
    try:
        com = mesh.bounding_box.centroid          # bbox centre: robust for non-watertight
        transforms, probs = _poses.compute_stable_poses(mesh, center_mass=com, n_samples=1)
    except Exception:
        return None
    if transforms is None or len(transforms) == 0:
        return None

    z2y = trimesh.transformations.rotation_matrix(-np.pi / 2.0, [1, 0, 0])  # +Z up -> +Y up
    cand = []
    for t in transforms[:8]:                      # consider the most probable poses
        m = mesh.copy()
        m.apply_transform(t)
        m.apply_transform(z2y)
        if float(m.extents[1]) >= float(max(m.extents)) - 1e-9:
            continue                              # standing on toe/heel — not a shoe pose
        cand.append((_vertical_skew(m), m))
    if not cand:
        return None
    sk, m = max(cand, key=lambda c: c[0])         # sole/collar axis vertical

    tc = m.triangles_center
    b = m.bounds
    ymin, ymax = float(b[0][1]), float(b[1][1])
    hy = ymax - ymin
    fp_bot = _xz_footprint(tc, tc[:, 1] <= ymin + 0.25 * hy)
    fp_top = _xz_footprint(tc, tc[:, 1] >= ymax - 0.25 * hy)
    flip_fp = fp_top > fp_bot                     # footprint says the sole ended up
    fp_margin = abs(fp_bot - fp_top) / (fp_bot + fp_top + 1e-9)
    # Second cue: FLATNESS. The outsole is a flat sheet, the upper is shaped
    # (tongue/collar/laces). The flatter Y-end is the sole.
    flat = _surface_flatness(m)
    flip_flat, flat_margin = flip_fp, 0.0
    if flat is not None:
        flat_bot, flat_top = flat                 # smaller = flatter = sole
        flip_flat = flat_bot > flat_top           # flatter end is up -> sole up -> flip
        flat_margin = abs(flat_bot - flat_top) / (flat_bot + flat_top + 1e-9)
    # Third cue: OPENING CAVITY. The foot goes in the top, so the mouth (a central
    # depression) marks the TOP; the sole is the opposite, solid end. Silent on a
    # solid/closed model. Strong and semantic when present.
    cav_flip, cav_conf = _cavity_flip(m)
    flip_y = flip_fp if fp_margin >= 0.02 else flip_flat
    sole_conf = min(1.0, fp_margin / 0.25)
    if flat is not None:
        if flip_flat == flip_fp:                  # footprint + flatness agree -> more sure
            sole_conf = min(1.0, sole_conf + 0.2 * min(1.0, flat_margin / 0.2))
        else:                                     # disagree -> less sure
            sole_conf = min(sole_conf, 0.7)
    if cav_flip is not None:                      # cavity present: strong confirm/tiebreak
        if cav_flip == flip_fp:
            sole_conf = min(1.0, sole_conf + 0.2 * cav_conf)
        else:
            sole_conf = min(sole_conf, 0.6)
    if fp_margin < 0.02:                          # footprint can't call -> cavity, then flatness
        if cav_flip is not None and cav_conf >= 0.3:
            flip_y = cav_flip
            sole_conf = min(1.0, cav_conf)
        elif flat is not None:
            flip_y = flip_flat
            sole_conf = min(1.0, flat_margin / 0.2)
    flipped = []
    if flip_y:                                    # sole ended up — flip it down
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
        flipped.append("upside-down -> sole down")

    if float(m.extents[0]) > float(m.extents[2]):  # length -> Z (yaw)
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2.0, [0, 1, 0]))

    tc = m.triangles_center
    b = m.bounds
    z = tc[:, 2]
    zmin, zmax = float(b[0][2]), float(b[1][2])
    lz = zmax - zmin
    toe_conf = 0.0
    if lz > 1e-9:
        fmask = z >= zmax - 0.30 * lz
        bmask = z <= zmin + 0.30 * lz
        hf = float(np.ptp(tc[fmask][:, 1])) if fmask.any() else 0.0
        hb = float(np.ptp(tc[bmask][:, 1])) if bmask.any() else 0.0
        flip_toe = hf > hb                        # heel (taller) on +Z -> flip toe forward
        denom = max(hf, hb)
        toe_conf = (abs(hf - hb) / denom) if denom > 1e-9 else 0.0
        if toe_conf < 0.12 and fmask.any() and bmask.any():
            # height is ambiguous -> WIDTH TAPER tie-breaker: the toe box is narrower
            # than the heel, so the wider end is the heel (put it on -Z).
            wf = float(np.ptp(tc[fmask][:, 0]))
            wb = float(np.ptp(tc[bmask][:, 0]))
            wd = max(wf, wb)
            if wd > 1e-9:
                flip_toe = wf > wb
                toe_conf = min(0.5, abs(wf - wb) / wd)
        if flip_toe:
            m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
            flipped.append("heel/toe -> toe forward")

    b = m.bounds                                  # centre at origin (pipeline re-seats later)
    m.apply_translation([-(b[0][0] + b[1][0]) / 2.0, -(b[0][1] + b[1][1]) / 2.0,
                         -(b[0][2] + b[1][2]) / 2.0])
    axis_conf = round(min(1.0, sk / 0.2), 2)
    sole_conf, toe_conf, axis_flat, flat_sole = _axis_flatness(m, sole_conf, toe_conf)
    return m, {"sole": round(sole_conf, 2), "toe": round(toe_conf, 2),
               "axis": axis_conf, "axisAgree": axis_conf >= 0.4, "axisFlat": axis_flat,
               "flatSole": flat_sole, "flipped": flipped, "trustedFile": False,
               "method": "stable-pose"}


def _orient_canonical(mesh, straighten=True):
    """Align to canonical axes (length->Z, width->X, height->Y), then optionally
    resolve the sign ambiguities PCA can't (sole-down, toe-forward).

    straighten=True  — AUTO-STRAIGHTEN: guess sole-down / toe-forward from the
                       geometry (footprint + heel height). Use when a model is
                       uploaded mis-oriented.
    straighten=False — TRUST THE FILE (default): only tidy the axes for scaling
                       and pairing; keep the supplier's own up/forward. A model
                       already modelled upright stays upright — no sole-flip
                       guessing (which is what wrongly inverted some boots).

    Returns (mesh, conf). conf = {'sole','toe','axis','axisAgree','flipped',
    'trustedFile'}. In trust mode sole/toe are None (we didn't guess them).
    Convention: sole on -Y, heel on -Z, toe on +Z. Deterministic geometry, not
    ML — each cue is a heuristic, so its strength is reported as a confidence."""
    if not straighten:
        m, axis_conf = _pca_align(mesh, trust_file=True)
        return m, {"sole": None, "toe": None, "axis": round(axis_conf, 2),
                   "axisAgree": axis_conf >= 0.4, "axisFlat": True, "flatSole": None,
                   "flipped": [], "trustedFile": True, "method": "trust-file"}

    # AUTO-STRAIGHTEN: prefer stable-pose (handles tall shoes PCA tilts); if the
    # pose engine is unavailable or fails, fall back to the PCA + footprint path.
    stable = _stable_align(mesh)
    if stable is not None:
        return stable

    m, axis_conf = _pca_align(mesh)
    tc = m.triangles_center
    aw = m.area_faces
    total = float(aw.sum()) if aw.sum() > 1e-12 else 1.0
    b = m.bounds

    # --- sole-down. PRIMARY cue = FOOTPRINT SIZE: the sole end spreads over the
    #     whole foot (toe->heel), while the far end is small (a boot's ankle
    #     opening, a shoe's toe tip). So the end with the LARGER footprint is the
    #     sole. This works for tall boots, where the old "mass sits low" rule
    #     FAILED — a boot's heavy shaft pulls the centroid high and flipped a
    #     correctly-standing boot upside down. The centroid is kept only as a
    #     confirming SECONDARY cue (it can't override the footprint).
    ymin, ymax = float(b[0][1]), float(b[1][1])
    hy = ymax - ymin

    def _footprint(mask):
        """Scale-free spread of the triangle centres in the (width, length) plane
        for the given height-slab mask: occupied fraction x bbox area. Bigger =
        more of the foot's outline sits in that slab (the sole)."""
        pts = tc[mask][:, [0, 2]]
        if len(pts) < 3:
            return 0.0
        mn = pts.min(axis=0)
        sp = pts.max(axis=0) - mn
        sp[sp < 1e-9] = 1.0
        nb = 20
        idx = np.clip(((pts - mn) / sp * (nb - 1e-6)).astype(int), 0, nb - 1)
        occ = len(np.unique(idx[:, 0] * nb + idx[:, 1]))
        return (occ / (nb * nb)) * float(sp[0] * sp[1])

    if hy > 1e-9:
        yy = tc[:, 1]
        fp_bottom = _footprint(yy <= ymin + 0.25 * hy)   # lowest quarter
        fp_top = _footprint(yy >= ymax - 0.25 * hy)       # highest quarter
        xs_margin = abs(fp_bottom - fp_top) / (fp_bottom + fp_top + 1e-9)
        flip_fp = fp_top > fp_bottom                      # bigger footprint on top -> upside down
        # secondary: area-weighted centroid below mid -> sole down (sneakers)
        cy = float((yy * aw).sum() / total)
        cen_flip = (cy - (ymin + ymax) / 2.0) > 0.0
        cen_margin = min(1.0, abs(cy - (ymin + ymax) / 2.0) / hy / 0.08)
        # third cue: FLATNESS — the outsole is a flat sheet, the upper is shaped
        # (tongue/collar/laces). The flatter Y-end is the sole. Independent of the
        # footprint-size and centroid cues.
        flat = _surface_flatness(m)
        flat_flip, flat_margin = flip_fp, 0.0
        if flat is not None:
            flat_bot, flat_top = flat                     # smaller = flatter = sole
            flat_flip = flat_bot > flat_top               # flatter end up -> sole up -> flip
            flat_margin = abs(flat_bot - flat_top) / (flat_bot + flat_top + 1e-9)
        # fourth cue: OPENING CAVITY — the foot's mouth (a central depression) marks
        # the TOP; the sole is the solid opposite end. Silent on solid/closed models.
        cav_flip, cav_conf = _cavity_flip(m)
        flip_y = flip_fp
        sole_conf = min(1.0, xs_margin / 0.25)
        voters = [cen_flip, flat_flip] + ([cav_flip] if cav_flip is not None else [])
        n_agree = sum(1 for v in voters if v == flip_fp)  # confirmations of footprint
        if n_agree == len(voters):                        # everyone agrees -> boost
            sole_conf = min(1.0, sole_conf + 0.2)
        elif n_agree == 0:                                # all cues dissent -> less sure
            sole_conf = min(sole_conf, 0.7)
        if xs_margin < 0.05:                              # footprint too flat to call
            if cav_flip is not None and cav_conf >= 0.3:  # -> cavity is the strongest cue
                flip_y = cav_flip
                sole_conf = min(1.0, cav_conf)
            elif flat is not None and flat_margin >= 0.03:  # -> then flatness
                flip_y = flat_flip
                sole_conf = min(1.0, flat_margin / 0.2)
            else:                                         # -> else centroid
                flip_y = cen_flip
                sole_conf = min(sole_conf, cen_margin)
    else:
        flip_y = False
        sole_conf = 0.0

    # --- toe-forward: the heel end is taller (ankle collar) than the toe end,
    #     which tapers low. Compare the Y-extent of the front vs back quartile
    #     along the length axis. Taller end = heel; put it on -Z.
    z = tc[:, 2]
    zmin, zmax = float(b[0][2]), float(b[1][2])
    lz = zmax - zmin
    if lz > 1e-9:
        front = tc[z >= zmax - 0.30 * lz]        # +Z end
        back = tc[z <= zmin + 0.30 * lz]         # -Z end
        h_front = float(np.ptp(front[:, 1])) if len(front) else 0.0
        h_back = float(np.ptp(back[:, 1])) if len(back) else 0.0
        flip_z = h_front > h_back                 # heel is on +Z -> flip so it's -Z
        denom = max(h_front, h_back)
        toe_conf = (abs(h_front - h_back) / denom) if denom > 1e-9 else 0.0
        if toe_conf < 0.12 and len(front) and len(back):
            # height is ambiguous -> WIDTH TAPER tie-breaker: the toe box is
            # narrower than the heel, so the wider end is the heel (put it on -Z).
            w_front = float(np.ptp(front[:, 0]))
            w_back = float(np.ptp(back[:, 0]))
            wd = max(w_front, w_back)
            if wd > 1e-9:
                flip_z = w_front > w_back
                toe_conf = min(0.5, abs(w_front - w_back) / wd)
    else:
        flip_z = False
        toe_conf = 0.0

    # Apply the sign flips as a PROPER rotation (det +1): the X sign is chosen to
    # cancel any mirror the Y/Z flips would introduce (width side is arbitrary
    # for a single shoe — the supplier declares it and we mirror as needed).
    sy = -1.0 if flip_y else 1.0
    sz = -1.0 if flip_z else 1.0
    sx = sy * sz                                  # keeps det(diag) = +1
    if flip_y or flip_z:
        m.apply_transform(np.diag([sx, sy, sz, 1.0]))
        if sx < 0:                               # a mirror crept in -> fix winding
            m.faces = np.fliplr(m.faces).copy()

    flipped = []
    if flip_y:
        flipped.append("upside-down -> sole down")
    if flip_z:
        flipped.append("heel/toe -> toe forward")

    # Cross-check: sole-down and toe-forward both assume we picked the up axis
    # correctly. If the two independent up-axis cues DISAGREED (axis_conf < 0.4),
    # that assumption is shaky, so cap the sign confidences to it — the report
    # then honestly asks for a human check instead of reporting a confident-but-
    # possibly-sideways fit.
    axis_agree = axis_conf >= 0.4
    if not axis_agree:
        sole_conf = min(sole_conf, axis_conf)
        toe_conf = min(toe_conf, axis_conf)

    sole_conf, toe_conf, axis_flat, flat_sole = _axis_flatness(m, sole_conf, toe_conf)
    return m, {"sole": round(sole_conf, 2), "toe": round(toe_conf, 2),
               "axis": round(axis_conf, 2), "axisAgree": axis_agree, "axisFlat": axis_flat,
               "flatSole": flat_sole, "flipped": flipped, "trustedFile": False,
               "method": "pca"}


# Convention for this pipeline's oriented frame (sole -Y, heel -Z, toe +Z, width X),
# a right-handed system: the MEDIAL (big-toe) side of a right foot ends up on +X.
# So medial-on-+X => RIGHT shoe, medial-on--X => LEFT. If a real L/R-known test shows
# the guess inverted, flip this one constant (do not touch the cue maths).
_MEDIAL_POS_X_IS = "right"


def _lr_from_geometry(m):
    """Guess LEFT vs RIGHT from an already-oriented shoe (sole -Y, toe +Z, width X).

    Only meaningful when the orientation is resolved (auto-straighten), because L/R
    depends on knowing toe-forward and sole-down. Two soft, foot-anatomy cues, both
    pointing at the MEDIAL (big-toe) side; the medial side then maps to a side via
    the convention above:

      1. ARCH TILT (primary) — the arch sits on the medial side, so at the MIDFOOT
         the outsole rides HIGHER on the medial side than the lateral side.
      2. TOE-APEX OFFSET (backup) — the toe's forward-most point leans toward the
         medial (big-toe) side of the centre line.

    Deliberately conservative: returns (None, 0.0) when the sole is flat/symmetric
    (no arch, centred toe) — many AR models simplify the sole to a flat slab, and a
    wrong guess must never override the supplier. Otherwise returns (side, conf)."""
    tc = np.asarray(m.triangles_center, dtype=np.float64)
    if len(tc) < 12:
        return None, 0.0
    b = m.bounds
    ymin, ymax = float(b[0][1]), float(b[1][1])
    zmin, zmax = float(b[0][2]), float(b[1][2])
    xmin, xmax = float(b[0][0]), float(b[1][0])
    hy, lz, wx = ymax - ymin, zmax - zmin, xmax - xmin
    if hy < 1e-9 or lz < 1e-9 or wx < 1e-9:
        return None, 0.0
    x, y, z = tc[:, 0], tc[:, 1], tc[:, 2]
    xmid, zmid = (xmin + xmax) / 2.0, (zmin + zmax) / 2.0

    def _medial_to_side(medial_pos_x):
        if _MEDIAL_POS_X_IS == "right":
            return "right" if medial_pos_x else "left"
        return "left" if medial_pos_x else "right"

    votes = {"left": 0.0, "right": 0.0}

    # 1. arch tilt: midfoot, lower (outsole) band; higher mean height side = medial
    band = (y <= ymin + 0.35 * hy) & (np.abs(z - zmid) <= 0.20 * lz)
    neg, pos = band & (x < xmid), band & (x > xmid)
    if neg.sum() > 3 and pos.sum() > 3:
        d = (float(np.mean(y[pos])) - float(np.mean(y[neg]))) / hy   # >0 => +X higher
        conf = min(1.0, abs(d) / 0.05)
        if conf > 0.0:
            votes[_medial_to_side(d > 0)] += 1.0 * conf

    # 2. toe-apex offset: forward-most slice; mean X offset leans toward medial
    toe = z >= zmax - 0.12 * lz
    if toe.sum() > 3:
        ax = float(np.mean(x[toe])) - xmid
        conf = min(1.0, abs(ax) / (0.5 * wx) / 0.30)
        if conf > 0.0:
            votes[_medial_to_side(ax > 0)] += 0.5 * conf

    side = max(votes, key=votes.get)
    net = votes[side] - votes["left" if side == "right" else "right"]
    if net < 0.15:                                   # too weak / symmetric -> don't guess
        return None, 0.0
    return side, round(min(1.0, net), 2)


# --------------------------------------------------------------------------- #
#  Pair separation (structure-first) + count detection
# --------------------------------------------------------------------------- #
_LEFT_TOKENS = ("left", "_l", "-l", ".l", "l_", "shoe_l", "foot_l")
_RIGHT_TOKENS = ("right", "_r", "-r", ".r", "r_", "shoe_r", "foot_r")


def _classify_side(*names):
    """Return 'left'/'right'/None from any of the given node/geometry names.
    Right is checked first so 'right' never trips the 'l' tokens."""
    for raw in names:
        n = (raw or "").lower()
        if any(t in n for t in _RIGHT_TOKENS):
            return "right"
        if any(t in n for t in _LEFT_TOKENS):
            return "left"
    return None


def _split_by_names(loaded):
    """Separate a pair using explicit node/geometry names (_L/_R, left/right).
    This is the reliable path and the submission policy asks suppliers for it.
    Returns [left_mesh, right_mesh] in world space, or None."""
    if not isinstance(loaded, trimesh.Scene):
        return None
    buckets = {"left": [], "right": []}
    try:
        for node in loaded.graph.nodes_geometry:
            transform, geom_name = loaded.graph[node]
            side = _classify_side(node, geom_name)
            if side is None:
                continue
            geom = loaded.geometry.get(geom_name)
            if not isinstance(geom, trimesh.Trimesh):
                continue
            g = geom.copy()
            g.apply_transform(transform)
            buckets[side].append(g)
    except Exception:
        return None
    if buckets["left"] and buckets["right"]:
        return [trimesh.util.concatenate(buckets["left"]),
                trimesh.util.concatenate(buckets["right"])]
    return None


def _has_named_pair(loaded):
    """True if the scene tags geometry for BOTH left and right, so we can assign
    Shoe_L/Shoe_R from the supplier's own labels instead of a positional guess.
    Cheap: reads node/geometry names only (no geometry copied), so it's safe to
    call in the light analysis path before the textured scene is freed."""
    if not isinstance(loaded, trimesh.Scene):
        return False
    sides = set()
    try:
        for node in loaded.graph.nodes_geometry:
            _, gname = loaded.graph[node]
            s = _classify_side(node, gname)
            if s:
                sides.add(s)
    except Exception:
        return False
    return "left" in sides and "right" in sides


def _split_by_components(mesh):
    """Separate a pair by CLUSTERING its parts into two groups.

    A shoe is often many connected pieces (sole, upper, laces, eyelets), so a
    pair is two spatial CLUMPS of pieces. We take every piece's centroid and
    cluster them into 2 groups by proximity (area-weighted 2-means), then merge
    each group into one shoe. This beats the old 'exactly two big pieces' rule:
    it keeps ALL parts (that rule dropped small ones like laces) and it works
    even when the pair is placed at an angle — it groups by nearness, not a
    straight cut. Returns [left, right] ordered by X, or None if it can't find
    two balanced, separated groups (then the caller uses the gap split, which is
    flagged for QC). Needs scipy/networkx for connected_components."""
    n = len(mesh.faces)
    if n > SPLIT_MAX_FACES:                  # too heavy — fall back to geometric
        return None
    # Connected components as FACE-INDEX arrays, NOT submeshes. Building a submesh
    # per component (mesh.split) copies the mesh's texture image onto EVERY
    # component, so a many-part TEXTURED model (e.g. an ornamented sneaker) blows
    # up memory and OOM-crashes the machine. Face indices are free; only the final
    # two halves are ever materialised.
    try:
        comps = [np.asarray(c) for c in trimesh.graph.connected_components(
            mesh.face_adjacency, min_len=1, nodes=np.arange(n)) if len(c) > 0]
    except Exception:
        return None
    if len(comps) < 2:
        return None

    tc = np.asarray(mesh.triangles_center, dtype=np.float64)
    fa = np.asarray(mesh.area_faces, dtype=np.float64)
    cents = np.array([tc[c].mean(axis=0) for c in comps], dtype=np.float64)
    areas = np.array([max(float(fa[c].sum()), 1e-9) for c in comps], dtype=np.float64)

    if len(comps) == 2:
        labels = np.array([0, 1])
        centers = cents.copy()
    else:
        # 2-means seeded by the two farthest-apart centroids; area-weighted so
        # big parts (sole/upper) anchor each cluster and small parts follow.
        mean = cents.mean(axis=0)
        a = cents[int(np.argmax(((cents - mean) ** 2).sum(1)))]
        b = cents[int(np.argmax(((cents - a) ** 2).sum(1)))]
        centers = np.array([a, b], dtype=np.float64)
        labels = np.zeros(len(comps), dtype=int)
        for _ in range(15):
            dist = ((cents[:, None, :] - centers[None, :, :]) ** 2).sum(2)
            new_labels = dist.argmin(1)
            new_centers = np.array([
                (cents[new_labels == k] * areas[new_labels == k, None]).sum(0)
                / areas[new_labels == k].sum() if (new_labels == k).any() else centers[k]
                for k in (0, 1)])
            done = np.array_equal(new_labels, labels) and np.allclose(new_centers, centers)
            labels, centers = new_labels, new_centers
            if done:
                break

    g0 = [comps[i] for i in range(len(comps)) if labels[i] == 0]
    g1 = [comps[i] for i in range(len(comps)) if labels[i] == 1]
    if not g0 or not g1:
        return None
    a0, a1 = float(areas[labels == 0].sum()), float(areas[labels == 1].sum())
    if min(a0, a1) < 0.15 * (a0 + a1):          # lop-sided groups -> not two shoes
        return None

    # Materialise ONLY the two final halves (one texture copy each) from the
    # grouped face indices — never a submesh per component.
    left = mesh.submesh([np.concatenate(g0)], append=True)
    right = mesh.submesh([np.concatenate(g1)], append=True)
    # the two groups must actually sit APART along the axis that separates them;
    # if they overlap heavily it isn't a clean pair -> let the gap split try and
    # the 'verify' flag catch it.
    axis = int(np.argmax(np.abs(centers[0] - centers[1])))
    lo = max(float(left.bounds[0][axis]), float(right.bounds[0][axis]))
    hi = min(float(left.bounds[1][axis]), float(right.bounds[1][axis]))
    overlap = max(0.0, hi - lo)
    span = (max(float(left.bounds[1][axis]), float(right.bounds[1][axis]))
            - min(float(left.bounds[0][axis]), float(right.bounds[0][axis])))
    if span > 1e-9 and overlap / span > 0.35:
        return None
    return sorted([left, right], key=lambda c: float(c.centroid[0]))


def _split_two_by_gap(mesh):
    """Fallback split: cut where the two shoes are actually separated.

    Scans EACH axis for the widest interior empty slab that divides the faces
    into two balanced masses (a genuine gap between two shoes) and cuts at the
    middle of that gap. So it works whether the pair is side-by-side (gap along
    width), staggered front-to-back (gap along length), or even stacked (gap
    along height) — not just left-right like the old median-X cut. When no clear
    gap exists (the shoes overlap), it falls back to the median X. Returns
    (halves, found_gap): found_gap is False when it had to use the median so the
    caller can report low confidence. Needs no graph engine."""
    tc = np.asarray(mesh.triangles_center, dtype=np.float64)
    n = len(tc)
    best = None                                  # (gap_width_frac, axis, cut_coord)
    if n >= 50:
        bins = 48
        empty_thresh = max(1, int(0.003 * n))    # a bin with <0.3% of faces is "empty"
        for ax in (0, 1, 2):
            hist, edges = np.histogram(tc[:, ax], bins=bins)
            empty = hist < empty_thresh
            i = 0
            while i < bins:
                if empty[i]:
                    j = i
                    while j < bins and empty[j]:
                        j += 1
                    if i > 0 and j < bins:        # an INTERIOR empty slab (not an edge)
                        left, right = int(hist[:i].sum()), int(hist[j:].sum())
                        if left > 0.35 * n and right > 0.35 * n:   # two balanced masses
                            width = (j - i) / bins
                            if best is None or width > best[0]:
                                best = (width, ax, float((edges[i] + edges[j]) / 2.0))
                    i = j
                else:
                    i += 1

    def _cut(ax, coord):
        out = []
        for face_idx in (np.where(tc[:, ax] <= coord)[0], np.where(tc[:, ax] > coord)[0]):
            if len(face_idx):
                out.append(mesh.submesh([face_idx], append=True))
        return out

    if best is not None and best[0] >= 0.04:      # a real gap (>=~2 empty bins)
        halves = _cut(best[1], best[2])
        if len(halves) == 2:
            return halves, True
    return _cut(0, float(np.median(tc[:, 0]))), False   # no gap -> median X (unreliable)


def _split_pair(loaded, combined):
    """Separate two shoes, preferring reliable structure over geometry.
    Returns (halves, method, confidence)."""
    named = _split_by_names(loaded)
    if named:
        return named, "named nodes (_L/_R)", 0.95
    comps = _split_by_components(combined)
    if comps:
        return comps, "connected components", 0.85
    halves, found_gap = _split_two_by_gap(combined)
    ordered = sorted(halves, key=lambda c: float(c.centroid[0])) if len(halves) >= 2 else halves
    if found_gap:
        return ordered, "geometric gap (verify in QC)", 0.55
    return ordered, "geometric median (unreliable — verify in QC)", 0.35


def _count_clusters(mesh, overall_max):
    """Best-effort count of the BIG connected pieces (a pair = 2 big clumps).
    Returns int, or None if a graph engine isn't available / the mesh is too big.

    Uses face-index connected components (not mesh.split) so it never builds a
    submesh per component — same reason as _split_by_components: on a textured mesh
    that would copy the texture per part and blow up memory. The count is identical
    either way: each component's bounding-box max extent is measured directly from
    its faces' vertices and compared to 15% of the overall size."""
    n = len(mesh.faces)
    if n > SPLIT_MAX_FACES:                 # too heavy — skip this best-effort check
        return None
    try:
        comps = trimesh.graph.connected_components(
            mesh.face_adjacency, min_len=1, nodes=np.arange(n))
    except Exception:
        return None
    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces)
    thresh = 0.15 * overall_max
    big = 0
    for c in comps:
        if len(c) == 0:
            continue
        vids = np.unique(F[np.asarray(c)])          # vertices used by this component
        ext = V[vids].max(axis=0) - V[vids].min(axis=0)
        if float(ext.max()) > thresh:
            big += 1
    return big if big else 1


def _detect_count(mesh):
    """Guess 1 or 2 shoes when the supplier didn't declare it, with a confidence.

    The reliable signature of a PAIR is a spatial GAP: two shoes sit side by side
    with empty space between them, so along some axis there is a full-width empty
    slab through the middle with substantial geometry on BOTH sides. A single
    shoe — however many parts it has (upper, sole, laces, eyelets...) — is one
    compact blob with no such separating gap. (Neither connected-component count
    nor a width/length ratio works: a detailed single shoe has many pieces, and a
    tall boot's shaft reads as "wide".) Returns (count, reason, confidence)."""
    # orient sole-down so Y is height; a pair is separated along a HORIZONTAL
    # axis (X or Z) into two roughly equal masses. Vertical gaps (sole vs upper
    # vs collar) are ignored so a single multi-part shoe isn't mistaken for a pair.
    # Use TRIANGLE CENTRES, not vertices: a hollow surface mesh has vertices only
    # on its shell (sparse interior = false gaps), but its faces cover the whole
    # body, so triangle centres fill the interior — only a real inter-shoe gap
    # reads as empty.
    oriented, _ = _orient_canonical(mesh)
    P = np.asarray(oriented.triangles_center, dtype=np.float64)
    n = len(P)
    if n < 50:
        return 1, "too few faces to assess", 0.40

    bins = 48
    empty_thresh = max(1, int(0.003 * n))   # a bin with <0.3% of faces is "empty"
    best_gap = 0.0
    for ax in (0, 2):   # X (width) and Z (length) only — skip Y (height)
        hist, _ = np.histogram(P[:, ax], bins=bins)
        empty = hist < empty_thresh
        i = 0
        while i < bins:
            if empty[i]:
                j = i
                while j < bins and empty[j]:
                    j += 1
                if i > 0 and j < bins:
                    left, right = hist[:i].sum(), hist[j:].sum()
                    # a pair splits into two BALANCED masses (each >=35%)
                    if left > 0.35 * n and right > 0.35 * n:
                        best_gap = max(best_gap, (j - i) / bins)
                i = j
            else:
                i += 1

    if best_gap >= 0.15:   # a wide empty slab separating two balanced masses -> pair
        return 2, "two balanced masses separated by a gap (%.0f%% empty)" % (best_gap * 100), \
            round(min(1.0, best_gap / 0.25), 2)
    return 1, "one compact shoe (no separating gap)", 0.85


# --------------------------------------------------------------------------- #
#  Baking
# --------------------------------------------------------------------------- #
def _normalise(mesh, target_length_m, mirror=False, straighten=True):
    """Return a copy: axes tidied to canonical (length->Z etc), auto-straightened
    if `straighten` else kept in the file's own up/forward, uniform-scaled so its
    length == target, optionally mirrored across X, then seated (X/Z centred,
    sole on Y=0) — ready to drop into the foot rig. Axes are ALWAYS aligned (so
    the length scale and side-by-side pairing are correct); `straighten` only
    controls whether we re-guess sole-down / toe-forward."""
    m, _ = _orient_canonical(mesh, straighten=straighten)
    length_now = float(m.extents[2])
    m.apply_scale(target_length_m / length_now if length_now > 1e-9 else 1.0)
    if mirror:
        m.apply_transform(np.diag([-1.0, 1.0, 1.0, 1.0]))   # reflect across X
        # A reflection reverses triangle winding. Flipping the face order by hand
        # (np.fliplr) fixed the winding but left the normals pointing INWARD after
        # GLB export (trimesh re-derives normals from winding on export), so the
        # mirrored foot rendered inside-out — you saw its interior/lining instead
        # of the outer material. fix_normals re-orients the winding OUTWARD per
        # body (multibody: a shoe is many separate pieces) and that survives export.
        m.fix_normals(multibody=True)
    b = m.bounds
    cx = (b[0][0] + b[1][0]) / 2.0
    cz = (b[0][2] + b[1][2]) / 2.0
    m.apply_translation([-cx, -b[0][1], -cz])
    return m


def _combine_pair(left_mesh, right_mesh, lr_known=True):
    """Pack both fitted shoes into ONE .glb as two named nodes (Shoe_L / Shoe_R),
    laid out side by side as a pair. This is what Lens Studio wants at publish:
    import a single file, bind each named node to its foot, publish the pair to
    the lens group. Each node's geometry stays centred/seated at its own origin
    (so the suggested anchor still applies); the side-by-side offset is a node
    transform for a clean pair preview and is reset when binding to a foot.

    Layout depends on whether we actually KNOW which shoe is left vs right:
      lr_known=True  — named parts, or a single shoe mirrored from a declared
        side. Show it as worn facing the viewer: the LEFT shoe on the viewer's
        RIGHT (+X), the right shoe on the left.
      lr_known=False — an unnamed pair whose left/right was only GUESSED by
        position. Don't impose the facing convention (it would mirror the pair
        vs the upload and look wrong); keep the file's own left-right order and
        let the "verify" flag prompt a human. Cosmetic only either way — each
        foot binds by its named node."""
    scene = trimesh.Scene()
    w = float(max(left_mesh.extents[0], right_mesh.extents[0]))
    off = w / 2.0 + 0.02                      # 2 cm gap so they don't touch
    left_x = off if lr_known else -off        # known L/R -> as-worn (left on viewer's right)
    t_left = np.eye(4); t_left[0, 3] = left_x
    t_right = np.eye(4); t_right[0, 3] = -left_x
    scene.add_geometry(left_mesh, node_name="Shoe_L", geom_name="Shoe_L", transform=t_left)
    scene.add_geometry(right_mesh, node_name="Shoe_R", geom_name="Shoe_R", transform=t_right)
    return scene.export(file_type="glb")


def analyze_and_fit(glb_bytes, declared_count=None, declared_length_cm=None,
                    declared_side="right", mirror_single=True, auto_orient=True,
                    build_files=True, count_declared=True):
    """Validate + auto-fit a shoe model.

    count_declared: whether the caller has actually chosen the number of shoes.
    True (default, and for the admin's Auto-detect) -> emit the count-specific
    notes (mirror copy, pair-split, count-mismatch). False (supplier upload
    before they pick 1 vs a pair) -> suppress those notes (they'd be a premature
    guess) and instead prompt for the count. The count itself is still
    auto-detected so shoeCount is populated; only the notes wait.

    build_files=False does only the (light) analysis — validation, dimensions,
    orientation, count, anchor + a projection of what texture/triangle
    optimisation WOULD do — and returns fitted=None. The heavy work (texture
    resize, decimation, baking + glb export of both feet) runs only when
    build_files=True, so "just analyse" never spikes memory/CPU.

    Returns (meta, fitted):
      meta   = dict (ok / rejected / rejectReason / warnings / shoeCount /
               countDetection / nativeUnit / nativeLengthCm / dimensionsCm /
               appliedScale / side / autoOriented / orientation / split)
      fitted = {"combined": glb_bytes} — ONE .glb with both shoes as named
               nodes (Shoe_L / Shoe_R) ready to publish, or None if rejected.
    """
    length_cm = float(declared_length_cm) if declared_length_cm else DEFAULT_LENGTH_CM
    target_m = length_cm / 100.0
    meta = {
        "ok": False, "rejected": False, "rejectReason": None, "warnings": [],
        "shoeCount": declared_count, "countDetection": None,
        "nativeUnit": None, "nativeLengthCm": None, "dimensionsCm": None,
        "appliedScale": None, "side": declared_side, "autoOriented": bool(auto_orient),
        "orientation": None, "split": None, "decimation": None,
        "textures": None, "anchor": None, "occluder": None,
    }

    # 1. size ---------------------------------------------------------------
    if len(glb_bytes) > MAX_BYTES:
        meta["rejected"] = True
        meta["rejectReason"] = ("This file is too large (over %d MB). Please export a "
                                "lighter model." % (MAX_BYTES // (1024 * 1024)))
        return meta, None

    # 2. parse (Draco / corrupt raise here) ---------------------------------
    try:
        loaded = trimesh.load(io.BytesIO(glb_bytes), file_type="glb", process=False)
    except Exception:
        meta["rejected"] = True
        meta["rejectReason"] = ("This 3D file couldn't be opened. It may be damaged or use "
                                "a compression format that isn't supported. Re-export it as "
                                "a standard .glb.")
        return meta, None

    mesh = _combined(loaded)
    if mesh is None or len(mesh.faces) == 0:
        meta["rejected"] = True
        meta["rejectReason"] = "This file doesn't contain a 3D model."
        return meta, None

    # Geometry-only working copy for the ANALYSIS (PCA, count, orient, anchor).
    # Textures are the bulk of the RAM but are irrelevant to analysis, so we
    # never copy them here — and in light mode we drop the textured data now,
    # keeping the footprint tiny (this is what a low-RAM / shared-VRAM laptop
    # was choking on).
    tex_px = _max_texture_px(mesh)
    total_faces = int(len(mesh.faces))
    # Does the file label both feet? (cheap name-only check) — decides whether a
    # pair's left/right comes from the supplier's labels or a positional guess.
    # Capture it now, before the textured scene is freed in the light path.
    named_pair = _has_named_pair(loaded)
    geo = trimesh.Trimesh(vertices=np.asarray(mesh.vertices, dtype=np.float64),
                          faces=np.asarray(mesh.faces), process=False)

    # SAFETY BACKSTOP (reject only): analysis is a fast per-triangle numpy pass, so
    # it runs full-resolution — no decimation, so measurements/cues are exact. The
    # only guard is a hard reject for a genuinely degenerate, multi-million-triangle
    # file that could exhaust RAM just to load. Real shoe models (well under ~1.5M)
    # are never affected; this only stops an absurd upload from OOM-ing the service.
    if total_faces > HARD_MAX_FACES:
        meta["rejected"] = True
        meta["rejectReason"] = ("This model is extremely detailed (%d triangles) and can't be "
                                "processed safely. Please decimate it (aim for under ~1M "
                                "triangles) and re-upload." % total_faces)
        return meta, None

    if not build_files:
        loaded = None
        mesh = None
        gc.collect()

    # 3. native unit + plausibility (informational; output is rescaled anyway)
    unit_scale, unit_name = _detect_unit(geo)
    native_len_cm = float(geo.extents.max()) * unit_scale * 100.0
    meta["nativeUnit"] = unit_name
    meta["nativeLengthCm"] = round(native_len_cm, 1)
    if not (MIN_PLAUSIBLE_CM <= native_len_cm <= MAX_PLAUSIBLE_CM):
        meta["warnings"].append(
            "The model's built-in size is unusual (about %.0f cm). It's rescaled to the "
            "entered real length, so check the preview looks right." % native_len_cm)

    # 4. auto-detect 1 vs 2 shoes when the supplier didn't declare it --------
    if declared_count is None:
        declared_count, reason, conf = _detect_count(geo)
        meta["countDetection"] = {"count": declared_count, "reason": reason, "confidence": conf}
    meta["shoeCount"] = declared_count

    # 5. separate a pair (if needed) + measure ONE shoe (oriented) ----------
    #    Analysis split runs on the geometry-only copy (loaded=None in light
    #    mode, so it uses components/geometric, not named nodes — fine for a
    #    measurement). The build path re-splits the textured mesh below.
    split_method = split_conf = None
    pair_halves = None                          # both oriented-independently later, for the consistency check
    if declared_count == 2:
        halves_geo, split_method, split_conf = _split_pair(loaded, geo)
        if halves_geo and len(halves_geo) >= 2:
            meta["split"] = {"method": split_method, "confidence": split_conf,
                             "lrFromNames": named_pair}
            pair_halves = sorted(halves_geo, key=lambda c: float(c.centroid[0]))
            measure = pair_halves[0]
            # the split-quality note is deferred to step 7 so it can also use the
            # measured shoe's proportions + the cluster count (overlap detection).
        else:
            meta["warnings"].append("The two shoes couldn't be separated cleanly, so the "
                                    "file is treated as one. Name the two parts Shoe_L and "
                                    "Shoe_R when exporting.")
            declared_count = 1
            meta["shoeCount"] = 1
            measure = geo
    else:
        measure = geo
    if count_declared and declared_count == 1 and mirror_single:
        meta["warnings"].append("Only one shoe was uploaded; a mirror-image copy is "
                                "generated for the other foot. Text or logos will look "
                                "reversed on the copy, so upload both shoes if left and "
                                "right differ.")
    # Axes are ALWAYS tidied (needed for a correct length scale + pairing); the
    # auto_orient flag only decides whether we re-guess sole-down/toe-forward
    # (True) or keep the supplier's own orientation (False, the default).
    aligned, orient_conf = _orient_canonical(measure, straighten=auto_orient)
    meta["orientation"] = orient_conf
    # L/R VERIFY (soft, geometry-assist) — SINGLE SHOE ONLY. It verifies the "which
    # foot" the supplier declared, so it's meaningless for a pair (where left/right
    # comes from the split, shown in the "Pair split" row) — showing a per-foot
    # "geometry looks left" next to a declared pair only confuses. Also requires the
    # orientation to be RESOLVED and confident (auto-straighten, not trust-file,
    # sole/toe both solid), since L/R needs a known toe-forward + sole-down frame.
    if (declared_count == 1 and auto_orient and not orient_conf.get("trustedFile")
            and (orient_conf.get("sole") or 0.0) >= 0.4
            and (orient_conf.get("toe") or 0.0) >= 0.4):
        lr_side, lr_conf = _lr_from_geometry(aligned)
        orient_conf["lrGuess"] = lr_side
        orient_conf["lrConf"] = lr_conf
        orient_conf["lrDeclared"] = declared_side
        # Automatic L/R verify flag: a CONFIDENT geometry guess that DISAGREES with
        # the supplier's declared side raises a checklist note so the admin verifies
        # which foot before publishing. Soft: it never flips or relabels the shoe and
        # never blocks approval — geometry only assists, the declared side stays
        # authoritative.
        if (count_declared and lr_side is not None
                and lr_conf >= 0.4 and lr_side != declared_side):
            orient_conf["lrMismatch"] = True
            meta["warnings"].append(
                "The shape looks like a %s shoe, but it's marked as the %s foot. "
                "Verify left / right before publishing." % (lr_side, declared_side))
    size = aligned.extents
    length_n, width_n, height_n = float(size[2]), float(size[0]), float(size[1])
    scale = (target_m / length_n) if length_n > 1e-9 else 1.0
    meta["appliedScale"] = round(scale, 5)
    meta["dimensionsCm"] = {
        "length": round(length_n * scale * 100, 1),
        "width":  round(width_n * scale * 100, 1),
        "height": round(height_n * scale * 100, 1),
    }

    # 5b. PAIR CONSISTENCY — the two shoes of a pair are the same size, so once
    #     oriented their box dimensions should match. If the OTHER shoe orients to
    #     a very different shape, one of them landed in a wrong pose (e.g. lying on
    #     its side while the other stands) — that's the mismatched-pair result. We
    #     flag it so the admin doesn't ship a shoe-standing / shoe-lying pair.
    if count_declared and pair_halves is not None and len(pair_halves) >= 2:
        other, _ = _orient_canonical(pair_halves[1], straighten=auto_orient)
        # compare the ORIENTED extents component-wise (width vs width, height vs
        # height, length vs length) — NOT sorted: a pair is two same-size mirror
        # shoes, so consistently-oriented they share (w,h,l). A shoe left on its
        # side has a different HEIGHT even though its sorted dims are identical, so
        # sorting would hide the very mismatch we want to catch.
        a = np.asarray(aligned.extents, dtype=np.float64)   # (width, height, length)
        b = np.asarray(other.extents, dtype=np.float64)
        rel = float(np.max(np.abs(a - b) / (np.maximum(a, b) + 1e-9)))
        if rel > 0.35:                                # the two shoes came out different shapes
            orient_conf["pairMismatch"] = True
            orient_conf["sole"] = min(orient_conf.get("sole") or 0.0, 0.3)  # force "verify"
            meta["warnings"].append("The two shoes came out in different orientations (one "
                                    "may be lying on its side while the other stands). Re-export "
                                    "both shoes upright and the same way, or name them Shoe_L and "
                                    "Shoe_R, then re-upload.")

    # 6. orientation / shape notes ------------------------------------------
    if orient_conf.get("trustedFile"):
        # Audience note: the admin panel filters this line out (it has the
        # Facing row + the Auto-straighten toggle right there), so in practice
        # only the SUPPLIER reads it — keep it in supplier language: their fix is
        # to re-export upright, not an admin-only toggle.
        meta["warnings"].append("Orientation was kept from the file. Check the preview "
                                "stands upright; if it's lying down or upside-down, "
                                "re-export it upright and upload again.")
    else:
        if orient_conf["flipped"]:
            meta["warnings"].append("The shoe was automatically adjusted to face forward "
                                    "and sit flat.")
        if orient_conf["sole"] < 0.4 or orient_conf["toe"] < 0.4:
            # The trusted cues already flagged the facing uncertain. If flatness ALSO
            # found no clearly-flat end, the likely cause is a wrong up-axis (the
            # model is lying on its side / at an angle) -> give that sharper message.
            if orient_conf.get("axisFlat") is False:
                meta["warnings"].append(
                    "The model doesn't appear to have a flat sole facing down, so it may "
                    "be lying on its side or at an angle. Re-export it standing upright on "
                    "its sole and upload again.")
            else:
                meta["warnings"].append(
                    "The facing (toe direction and which side is the sole) is uncertain. "
                    "Verify it before publishing.")

    # 7. count sanity + pair-split quality (best-effort; warning only) -------
    detected = _count_clusters(geo, float(geo.extents.max()))

    # Pair-split note, decided once here so it can use the measured shoe's
    # PROPORTIONS + the cluster count. Skipped for a named pair (that split is
    # reliable regardless of how the shoes sit).
    #   * "suspect" = the separated shoe is implausibly wide/tall for its length
    #     (a real shoe is long and slim), OR the pair didn't separate into >=2
    #     pieces. Either way the split/orientation is likely off — commonly the
    #     two shoes overlap or are joined. We report the SYMPTOM (unusual shape)
    #     and the likely causes rather than asserting a single cause, because a
    #     tilted shoe in trust-file mode can also read wide.
    # Count-specific notes are shown only once the count is actually chosen. Before
    # that (supplier upload, count not declared) they'd be a premature guess (and
    # can contradict each other), so we suppress them and prompt for the count.
    if not count_declared:
        meta["warnings"].append("Select the number of shoes (1 or a pair) to finish the "
                                "AR check.")
    else:
        if declared_count == 2 and meta.get("split") and not named_pair:
            suspect = (width_n > 0.55 * length_n) or (height_n > 0.95 * length_n)
            fused = detected is not None and detected < 2
            if suspect or fused:
                meta["split"]["suspect"] = True
                meta["split"]["confidence"] = min(meta["split"].get("confidence") or 0.3, 0.2)
                meta["warnings"].append("The separated shoe looks unusually wide or tall for its "
                                        "length, so the two shoes may overlap or the split isn't "
                                        "clean. Name the parts Shoe_L and Shoe_R, or place the two "
                                        "shoes flat and apart, then re-upload.")
            elif split_conf is not None and split_conf < 0.5:
                meta["warnings"].append("Two shoes were found and separated automatically. For the "
                                        "cleanest split, name the two parts Shoe_L and Shoe_R when "
                                        "exporting.")
            else:
                meta["warnings"].append("Left and right were assigned by position, so the two shoes "
                                        "may be swapped. Name the two parts Shoe_L and Shoe_R to "
                                        "place each on the correct foot.")

        if detected is not None and declared_count == 1 and detected >= 2:
            meta["warnings"].append("This is marked as one shoe, but the file has %d separate "
                                    "pieces. Confirm whether it's a pair or includes extra "
                                    "parts." % detected)

    # 8. anchor + occluder (cheap: scale+seat ONE already-oriented shoe in
    #    memory, no export). Runs in both the light and full paths.
    seated = aligned.copy()                               # aligned is a fresh oriented copy
    seated.apply_scale(scale)
    sb = seated.bounds
    seated.apply_translation([-(sb[0][0] + sb[1][0]) / 2.0, -sb[0][1], -(sb[0][2] + sb[1][2]) / 2.0])
    meta["anchor"] = _anchor(seated)
    collar = meta["anchor"]["collarHeightCm"]
    high_top = collar > HIGH_TOP_CM
    meta["occluder"] = {"retainFromTemplate": True, "collarHeightCm": collar, "highTop": high_top}
    # NOTE: a high collar (high-top) needs the foot occluder extended up the ankle,
    # but that's an ADMIN/Lens-Studio task the supplier can't act on — so we surface
    # it via the structured occluder field for the admin panel, NOT as a supplier
    # warning (which read oddly as "boot" on a sport-shoe platform).

    # 9. projected optimisation report (cheap: texture size + face count captured
    #    up front). The full build below overrides with actuals.
    if tex_px:
        meta["textures"] = {"beforePx": tex_px, "afterPx": min(tex_px, MAX_TEX),
                            "resized": 0, "cap": MAX_TEX, "willResize": tex_px > MAX_TEX}
    per_foot = total_faces // (2 if declared_count == 2 else 1)
    textured = tex_px > 0
    meta["decimation"] = {"applied": False, "before": per_foot, "after": per_foot,
                          "targetPerFoot": TRI_TARGET, "textured": textured,
                          "willDecimate": per_foot > TRI_TARGET}

    # 10. build the fitted files — HEAVY, only on request -------------------
    fitted = None
    if build_files:
        _t0 = time.time()
        _blog("start: faces=%d textured=%s count=%s texPx=%d straighten=%s"
              % (int(len(mesh.faces)), _has_uv_texture(mesh), declared_count, tex_px, auto_orient))
        dec_before = dec_after = tex_before = tex_after = tex_resized = 0
        dec_skipped_tex = [False]

        def _prep(shoe):
            nonlocal dec_before, dec_after, tex_before, tex_after, tex_resized
            tb, ta, tr = _optimize_textures(shoe, MAX_TEX)
            tex_before = max(tex_before, tb)
            tex_after = max(tex_after, ta)
            tex_resized += tr
            d, before, after, _ = _decimate(shoe, TRI_TARGET)
            dec_before += before
            dec_after += after
            # Textured, over budget, but nothing came off -> the UV-preserving
            # backend is unavailable/failed (see _decimate). Flag it so we warn
            # instead of shipping a mesh that will bust the 8 MB cap.
            if _has_uv_texture(shoe) and before > TRI_TARGET and after >= before:
                dec_skipped_tex[0] = True
            return d

        # re-split the TEXTURED mesh for the actual bake (analysis used geo)
        build_halves = build_method = None
        if declared_count == 2:
            build_halves, build_method, _ = _split_pair(loaded, mesh)
            _blog("split done in %.2fs -> method=%s halves=%s"
                  % (time.time() - _t0, build_method, build_halves and len(build_halves)))
        left_norm = right_norm = None
        lr_known = True                            # do we truly know which shoe is left vs right?
        if declared_count == 2 and build_halves and len(build_halves) >= 2:
            if build_method and "named" in build_method:
                # supplier labelled the parts -> trust their left/right order
                # (_split_by_names returns [left, right]); do NOT re-sort by position.
                left_src, right_src = build_halves[0], build_halves[1]
                lr_known = True
            else:
                # no labels -> we can only guess left/right by position (flagged above)
                ordered = sorted(build_halves, key=lambda c: float(c.centroid[0]))
                left_src, right_src = ordered[0], ordered[-1]
                lr_known = False
            left_norm = _normalise(_prep(left_src), target_m, straighten=auto_orient)
            _blog("left foot prepped+oriented at %.2fs" % (time.time() - _t0))
            right_norm = _normalise(_prep(right_src), target_m, straighten=auto_orient)
            _blog("right foot prepped+oriented at %.2fs" % (time.time() - _t0))
        else:
            side = (declared_side or "right").lower()   # single shoe: side is declared
            src = _prep(mesh)
            base = _normalise(src, target_m, straighten=auto_orient)
            opp = _normalise(src, target_m, mirror=True, straighten=auto_orient) if mirror_single else None
            _blog("single foot prepped+oriented (mirror=%s) at %.2fs" % (bool(opp is not None), time.time() - _t0))
            if side == "left":
                left_norm, right_norm = base, opp
            else:
                right_norm, left_norm = base, opp

        primary_norm = right_norm or left_norm

        def _export_combined():
            if left_norm is not None and right_norm is not None:
                return _combine_pair(left_norm, right_norm, lr_known=lr_known)
            if primary_norm is not None:
                return primary_norm.export(file_type="glb")
            return b""

        fitted = {"combined": _export_combined()}
        _blog("combined+exported at %.2fs (bytes=%d)"
              % (time.time() - _t0, len(fitted.get("combined") or b"")))

        # Fit to Camera Kit's 8 MB lens cap. Geometry is already decimated to the
        # mobile budget (UV-preserving), so if the export is still over target the
        # texture is what's left to trim — shrink it in halves and re-export until
        # it clears the cap or hits the texture floor. Cheap: at most a few extra
        # exports, and only when a model is genuinely oversized.
        cap_cap = MAX_TEX
        fit_shrunk = False
        fit_meshes = [m for m in (left_norm, right_norm, primary_norm) if m is not None]
        while (len(fitted["combined"]) > LENS_TARGET_BYTES and cap_cap > MIN_TEX
               and fit_meshes):
            cap_cap = max(MIN_TEX, cap_cap // 2)
            for m in fit_meshes:
                _optimize_textures(m, cap_cap)
            fitted["combined"] = _export_combined()
            fit_shrunk = True
            _blog("size-fit: texture cap %dpx -> %d bytes" % (cap_cap, len(fitted["combined"])))
        if fit_shrunk:
            tex_after = max((_max_texture_px(m) for m in fit_meshes), default=tex_after)

        # override the projected report with what actually happened
        if tex_before:
            meta["textures"] = {"beforePx": tex_before, "afterPx": tex_after,
                                "resized": tex_resized, "cap": MAX_TEX}
            if tex_resized:
                meta["warnings"].append("Downscaled texture(s) %dpx -> %dpx for mobile "
                                        "AR performance." % (tex_before, tex_after))
        if dec_before:
            applied = dec_after < dec_before
            # "heavy" = we removed the bulk of the triangles (>70%). Decimation to
            # the mobile budget normally looks fine (the Fitted-pair preview IS the
            # exact model the customer tries on), but a very aggressive cut can soften
            # fine surface detail — so we flag it for the admin to eyeball the preview
            # rather than hard-rejecting an otherwise-good upload.
            heavy = applied and dec_after < 0.30 * dec_before
            meta["decimation"] = {"applied": applied, "before": dec_before,
                                  "after": dec_after, "targetPerFoot": TRI_TARGET,
                                  "heavy": heavy}
            if applied:
                meta["warnings"].append("Decimated %d -> %d triangles for real-time "
                                        "mobile AR performance." % (dec_before, dec_after))
                if heavy:
                    meta["warnings"].append("This model was heavily reduced (%.0f%% of its "
                                            "triangles removed) to meet the mobile AR budget. "
                                            "Check the Fitted-pair preview still looks like the "
                                            "product before approving; Reject if detail is lost."
                                            % (100.0 * (1.0 - dec_after / float(dec_before))))
            elif dec_skipped_tex[0]:
                meta["warnings"].append("High poly (%d triangles) and the geometry "
                                        "simplifier is unavailable, so the mesh was left "
                                        "as-is — it may exceed Camera Kit's 8 MB lens cap. "
                                        "Reduce the model's polygon count before export."
                                        % dec_before)

        # Report the final lens size against Camera Kit's hard cap so the admin
        # panel can flag a still-oversized model instead of it failing in Lens Studio.
        lens_bytes = len(fitted.get("combined") or b"")
        within = lens_bytes <= LENS_MAX_BYTES
        meta["lens"] = {"bytes": lens_bytes, "capBytes": LENS_MAX_BYTES,
                        "withinCap": within}
        if not within:
            meta["warnings"].append("Fitted lens is %.1f MB, over Camera Kit's %d MB cap — "
                                    "Lens Studio will reject it. The model's polygon count "
                                    "is too high even after optimisation; reduce it and "
                                    "re-upload." % (lens_bytes / 1048576.0,
                                                    LENS_MAX_BYTES // 1048576))

    meta["ok"] = True
    return meta, fitted
