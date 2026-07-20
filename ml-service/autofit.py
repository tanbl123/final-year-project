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
import numpy as np
import trimesh

try:
    from PIL import Image
except Exception:                # Pillow ships with trimesh's texture support
    Image = None

MAX_BYTES = 50 * 1024 * 1024     # 50 MB — generous; Lens Studio optimises at publish
TRI_TARGET = 50_000              # per-foot triangle budget for real-time mobile AR
MAX_TEX = 2048                   # cap texture edge (px) — the real mobile bottleneck
DEFAULT_LENGTH_CM = 26.0         # average adult foot if none declared
MIN_PLAUSIBLE_CM = 5.0           # a real shoe is never shorter than this
MAX_PLAUSIBLE_CM = 55.0          # ...or longer than this (after unit conversion)
HIGH_TOP_CM = 12.0               # collar higher than this -> boot/high-top (occluder)
SPLIT_MAX_FACES = 400_000        # skip connected-component splits above this (too heavy)
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


def _anchor(mesh_norm):
    """Suggest how to seat the fitted shoe onto the Lens Studio foot binding, so
    the admin pastes numbers instead of eyeballing. Works on the NORMALISED mesh
    (metres; sole on Y=0, X/Z centred, toe +Z, heel -Z), so the numbers match
    the exported glb. The ankle opening is the top rim over the rear of the shoe;
    seating it at the foot-binding origin (assumed at the ankle) gives a suggested
    local position. Rotation/scale are identity because the bake already oriented
    and scaled the model (Lens Studio's convertMetersToCentimeters handles cm).
    A SUGGESTION with its assumption stated — the admin fine-tunes in QC."""
    b = mesh_norm.bounds
    zmin, zmax = float(b[0][2]), float(b[1][2])
    ymax = float(b[1][1])
    lz = zmax - zmin
    V = np.asarray(mesh_norm.vertices, dtype=np.float64)
    rear_top = V[(V[:, 2] <= zmin + 0.35 * lz) & (V[:, 1] >= 0.60 * ymax)]
    opening = rear_top.mean(axis=0) if len(rear_top) else np.array([0.0, ymax, zmin])
    collar_cm = round(float(opening[1]) * 100, 1)
    return {
        "assumption": "foot-binding origin at ankle; convertMetersToCentimeters on",
        "positionCm": [round(float(-opening[0]) * 100, 1),
                       round(float(-opening[1]) * 100, 1),
                       round(float(-opening[2]) * 100, 1)],
        "rotationDeg": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
        "toeTipCm": round(zmax * 100, 1),
        "collarHeightCm": collar_cm,
        "note": "Left foot mirrors X (negate position X).",
    }


def _decimate(mesh, target_faces):
    """Reduce the triangle count to <= target with quadric edge collapse — it
    merges the vertex pairs that change the silhouette least, so the shoe still
    looks the same but renders far faster on a phone. This is what makes the
    output safe for real-time mobile AR instead of leaving it to the supplier.
    Returns (mesh, before, after, applied). Graceful: if the simplifier backend
    (fast-simplification) isn't installed, returns the original unchanged."""
    before = int(len(mesh.faces))
    if before <= target_faces:
        return mesh, before, before, False
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=int(target_faces))
    except Exception:
        return mesh, before, before, False
    after = int(len(simplified.faces))
    if after == 0 or after >= before:
        return mesh, before, before, False
    return simplified, before, after, True


def _pca_align(mesh):
    """Return a copy rotated so its natural axes are canonical: length -> Z,
    width -> X, height -> Y, centred at the origin. Uses PCA (eigenvectors of the
    vertex covariance), so it straightens an arbitrarily-rotated model.
    Deterministic geometry, not ML. Only the AXES are aligned here; the sign of
    each axis (toe/heel, sole/top) is fixed later by _orient_canonical."""
    m = mesh.copy()
    V = np.asarray(m.vertices, dtype=np.float64)
    if len(V) < 3:
        return m
    c = V.mean(axis=0)
    cov = np.cov(V - c, rowvar=False)
    # eigh -> eigenvalues ascending; columns are the principal directions.
    _, vecs = np.linalg.eigh(cov)
    axis_h = vecs[:, 0]   # smallest spread -> height (Y)
    axis_w = vecs[:, 1]   # middle spread  -> width  (X)
    axis_l = vecs[:, 2]   # largest spread -> length (Z)
    P = np.column_stack([axis_w, axis_h, axis_l])   # canonical -> principal
    if np.linalg.det(P) < 0:
        P[:, 0] = -P[:, 0]                          # keep a proper rotation (no mirror)
    T = np.eye(4)
    T[:3, :3] = P.T                                 # principal -> canonical
    T[:3, 3] = -P.T @ c                             # centre at origin
    m.apply_transform(T)
    return m


def _orient_canonical(mesh):
    """PCA-align, then resolve the sign ambiguities PCA can't (sole-down,
    toe-forward) from cross-sectional geometry. Returns (mesh, conf) where conf
    is {'sole': 0..1, 'toe': 0..1, 'flipped': [..]}. Convention: sole on -Y,
    heel on -Z, toe on +Z. Deterministic geometry, not ML — but each cue is a
    heuristic, so its strength is reported as a confidence rather than trusted
    blindly."""
    m = _pca_align(mesh)
    tc = m.triangles_center
    aw = m.area_faces
    total = float(aw.sum()) if aw.sum() > 1e-12 else 1.0
    b = m.bounds

    # --- sole-down: a real shoe carries more material low (thick sole + upper)
    #     than high (thin collar), so the area-weighted centroid sits below the
    #     mid-height when the sole is down. If it sits high, the model is upside
    #     down. Confidence = how far the centroid is from the mid-plane.
    ymin, ymax = float(b[0][1]), float(b[1][1])
    hy = ymax - ymin
    cy = float((tc[:, 1] * aw).sum() / total)
    frac_y = (cy - (ymin + ymax) / 2.0) / hy if hy > 1e-9 else 0.0
    flip_y = frac_y > 0.0                       # mass sits high -> upside down
    sole_conf = min(1.0, abs(frac_y) / 0.08)    # ~8% offset -> full confidence

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
    return m, {"sole": round(sole_conf, 2), "toe": round(toe_conf, 2), "flipped": flipped}


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


def _split_by_components(mesh):
    """Separate a pair by connected components (two big disjoint meshes).
    Needs a graph engine (scipy); returns None if unavailable or not clearly
    two. Halves are ordered left (smaller X centroid) then right."""
    if len(mesh.faces) > SPLIT_MAX_FACES:   # too heavy — fall back to geometric
        return None
    try:
        comps = mesh.split(only_watertight=False)
    except Exception:
        return None
    overall = float(mesh.extents.max())
    big = [c for c in comps if float(c.extents.max()) > 0.15 * overall]
    if len(big) != 2:
        return None
    return sorted(big, key=lambda c: float(c.centroid[0]))


def _split_two_by_x(mesh):
    """Fallback: split by the median X of the face centres. Least reliable — a
    joined pair rarely divides cleanly at the midline — so callers report low
    confidence. Needs no graph engine."""
    tc = mesh.triangles_center
    med = float(np.median(tc[:, 0]))
    out = []
    for face_idx in (np.where(tc[:, 0] <= med)[0], np.where(tc[:, 0] > med)[0]):
        if len(face_idx):
            out.append(mesh.submesh([face_idx], append=True))
    return out


def _split_pair(loaded, combined):
    """Separate two shoes, preferring reliable structure over geometry.
    Returns (halves, method, confidence)."""
    named = _split_by_names(loaded)
    if named:
        return named, "named nodes (_L/_R)", 0.95
    comps = _split_by_components(combined)
    if comps:
        return comps, "connected components", 0.85
    halves = _split_two_by_x(combined)
    ordered = sorted(halves, key=lambda c: float(c.centroid[0])) if len(halves) >= 2 else halves
    return ordered, "geometric X-median (unreliable — verify in QC)", 0.35


def _count_clusters(mesh, overall_max):
    """Best-effort connected-component count. Returns int, or None if a graph
    engine isn't available (or the mesh is too big to split cheaply)."""
    if len(mesh.faces) > SPLIT_MAX_FACES:   # too heavy — skip this best-effort check
        return None
    try:
        comps = mesh.split(only_watertight=False)
    except Exception:
        return None
    big = [c for c in comps if float(c.extents.max()) > 0.15 * overall_max]
    return len(big) if big else 1


def _detect_count(mesh):
    """Guess 1 or 2 shoes when the supplier didn't declare it, with a confidence.
    Two cues: connected-component count (2 big clusters -> a pair, high
    confidence) and a PCA width/length ratio (a single shoe is ~0.35-0.45 wide
    relative to its length; a side-by-side pair is ~0.6-0.8). Returns
    (count, reason, confidence). Deterministic geometry, not ML."""
    clusters = _count_clusters(mesh, float(mesh.extents.max()))
    aligned = _pca_align(mesh)
    L = float(aligned.extents[2])
    W = float(aligned.extents[0])
    ratio = (W / L) if L > 1e-9 else 0.0

    if clusters == 2:
        return 2, "two separate meshes", 0.90
    thr = 0.55
    ratio_conf = min(1.0, abs(ratio - thr) / 0.15)   # distance from the boundary
    if clusters == 1:
        # one connected mesh, but a very wide footprint can still be a joined pair
        if ratio > 0.60:
            return 2, "wide footprint (w/l=%.2f)" % ratio, round(min(1.0, (ratio - 0.60) / 0.15), 2)
        return 1, "single connected mesh (w/l=%.2f)" % ratio, round(max(0.6, ratio_conf), 2)
    # no graph engine -> decide on the ratio alone (inherently less certain)
    if ratio > 0.55:
        return 2, "wide footprint (w/l=%.2f)" % ratio, round(ratio_conf, 2)
    return 1, "narrow footprint (w/l=%.2f)" % ratio, round(ratio_conf, 2)


# --------------------------------------------------------------------------- #
#  Baking
# --------------------------------------------------------------------------- #
def _normalise(mesh, target_length_m, mirror=False, auto_orient=True):
    """Return a copy: (canonically oriented if auto_orient), uniform-scaled so
    its length == target, optionally mirrored across X, then seated (X/Z centred,
    sole on Y=0) — ready to drop into the foot rig."""
    if auto_orient:
        m, _ = _orient_canonical(mesh)
    else:
        m = mesh.copy()
    length_now = float(m.extents[2])
    m.apply_scale(target_length_m / length_now if length_now > 1e-9 else 1.0)
    if mirror:
        m.apply_transform(np.diag([-1.0, 1.0, 1.0, 1.0]))   # reflect across X
        m.faces = np.fliplr(m.faces).copy()                 # restore winding
    b = m.bounds
    cx = (b[0][0] + b[1][0]) / 2.0
    cz = (b[0][2] + b[1][2]) / 2.0
    m.apply_translation([-cx, -b[0][1], -cz])
    return m


def _combine_pair(left_mesh, right_mesh):
    """Pack both fitted shoes into ONE .glb as two named nodes (Shoe_L / Shoe_R),
    laid out side by side as a pair. This is what Lens Studio wants at publish:
    import a single file, bind each named node to its foot, publish the pair to
    the lens group. Each node's geometry stays centred/seated at its own origin
    (so the suggested anchor still applies); the side-by-side offset is a node
    transform for a clean pair preview and is reset when binding to a foot."""
    scene = trimesh.Scene()
    w = float(max(left_mesh.extents[0], right_mesh.extents[0]))
    off = w / 2.0 + 0.02                      # 2 cm gap so they don't touch
    tl = np.eye(4); tl[0, 3] = -off
    tr = np.eye(4); tr[0, 3] = off
    scene.add_geometry(left_mesh, node_name="Shoe_L", geom_name="Shoe_L", transform=tl)
    scene.add_geometry(right_mesh, node_name="Shoe_R", geom_name="Shoe_R", transform=tr)
    return scene.export(file_type="glb")


def analyze_and_fit(glb_bytes, declared_count=None, declared_length_cm=None,
                    declared_side="right", mirror_single=True, auto_orient=True,
                    build_files=True):
    """Validate + auto-fit a shoe model.

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
        meta["rejectReason"] = "File exceeds the %d MB limit." % (MAX_BYTES // (1024 * 1024))
        return meta, None

    # 2. parse (Draco / corrupt raise here) ---------------------------------
    try:
        loaded = trimesh.load(io.BytesIO(glb_bytes), file_type="glb", process=False)
    except Exception:
        meta["rejected"] = True
        meta["rejectReason"] = ("Could not read the .glb (corrupt, or uses Draco "
                                "compression, which is not supported).")
        return meta, None

    mesh = _combined(loaded)
    if mesh is None or len(mesh.faces) == 0:
        meta["rejected"] = True
        meta["rejectReason"] = "No 3D mesh found in the file."
        return meta, None

    # 3. native unit + plausibility (informational; output is rescaled anyway)
    unit_scale, unit_name = _detect_unit(mesh)
    native_len_cm = float(mesh.extents.max()) * unit_scale * 100.0
    meta["nativeUnit"] = unit_name
    meta["nativeLengthCm"] = round(native_len_cm, 1)
    if not (MIN_PLAUSIBLE_CM <= native_len_cm <= MAX_PLAUSIBLE_CM):
        meta["warnings"].append(
            "Native size ~%.1f cm (read as %s) is outside the %g-%g cm range for a "
            "real shoe — check the model's units/scale." %
            (native_len_cm, unit_name, MIN_PLAUSIBLE_CM, MAX_PLAUSIBLE_CM))

    # 4. auto-detect 1 vs 2 shoes when the supplier didn't declare it --------
    if declared_count is None:
        declared_count, reason, conf = _detect_count(mesh)
        meta["countDetection"] = {"count": declared_count, "reason": reason, "confidence": conf}
    meta["shoeCount"] = declared_count

    # 5. separate a pair (if needed) + measure ONE shoe (oriented) ----------
    halves = None
    split_method = split_conf = None
    if declared_count == 2:
        halves, split_method, split_conf = _split_pair(loaded, mesh)
        if halves and len(halves) >= 2:
            meta["split"] = {"method": split_method, "confidence": split_conf}
            measure = sorted(halves, key=lambda c: float(c.centroid[0]))[0]
            if split_conf is not None and split_conf < 0.5:
                meta["warnings"].append("Two shoes separated by %s — verify the "
                                        "split in QC." % split_method)
        else:
            meta["warnings"].append("Could not separate two shoes; treating as one.")
            declared_count = 1
            meta["shoeCount"] = 1
            halves = None
            measure = mesh
    else:
        measure = mesh
    if declared_count == 1 and mirror_single:
        meta["warnings"].append("Single shoe mirrored for the other foot — "
                                "branding on the mirrored side is reversed. "
                                "Upload both shoes for accurate left/right designs.")
    if auto_orient:
        aligned, orient_conf = _orient_canonical(measure)
        meta["orientation"] = orient_conf
    else:
        aligned, orient_conf = measure, None
    size = aligned.extents
    length_n, width_n, height_n = float(size[2]), float(size[0]), float(size[1])
    scale = (target_m / length_n) if length_n > 1e-9 else 1.0
    meta["appliedScale"] = round(scale, 5)
    meta["dimensionsCm"] = {
        "length": round(length_n * scale * 100, 1),
        "width":  round(width_n * scale * 100, 1),
        "height": round(height_n * scale * 100, 1),
    }

    # 6. orientation / shape notes ------------------------------------------
    if auto_orient and orient_conf is not None:
        if orient_conf["flipped"]:
            meta["warnings"].append("Auto-oriented (%s)." % "; ".join(orient_conf["flipped"]))
        if orient_conf["sole"] < 0.4 or orient_conf["toe"] < 0.4:
            meta["warnings"].append(
                "Low orientation confidence (sole %.2f, toe %.2f) — verify "
                "toe/heel and sole-down direction during QC." %
                (orient_conf["sole"], orient_conf["toe"]))
    elif not auto_orient:
        if not (length_n >= width_n >= height_n):
            meta["warnings"].append("Unusual proportions (expected length >= width "
                                    ">= height); model may be mis-oriented.")
        if height_n > 1e-9 and abs(measure.bounds[0][1]) > 0.5 * height_n:
            meta["warnings"].append("Sole is not near Y=0; check the sole-down rule.")

    # 7. count sanity (best-effort; warning only) ---------------------------
    detected = _count_clusters(mesh, float(mesh.extents.max()))
    if detected is not None:
        if declared_count == 2 and detected < 2:
            meta["warnings"].append("Declared 2 shoes but only one cluster "
                                    "detected — parts may be joined.")
        if declared_count == 1 and detected >= 2:
            meta["warnings"].append("Declared 1 shoe but %d clusters detected — "
                                    "extra parts, or is this a pair?" % detected)

    # 8. anchor + occluder (cheap: scale+seat ONE already-oriented shoe in
    #    memory, no export). Runs in both the light and full paths.
    seated = aligned if auto_orient else aligned.copy()   # aligned is a fresh copy when auto_orient
    seated.apply_scale(scale)
    sb = seated.bounds
    seated.apply_translation([-(sb[0][0] + sb[1][0]) / 2.0, -sb[0][1], -(sb[0][2] + sb[1][2]) / 2.0])
    meta["anchor"] = _anchor(seated)
    collar = meta["anchor"]["collarHeightCm"]
    high_top = collar > HIGH_TOP_CM
    meta["occluder"] = {"retainFromTemplate": True, "collarHeightCm": collar, "highTop": high_top}
    if high_top:
        meta["warnings"].append("High-top/boot (collar ~%.1f cm) — extend the foot "
                                "occluder up the ankle so the shoe doesn't clip or "
                                "float." % collar)

    # 9. projected optimisation report (cheap: read texture sizes + face counts,
    #    no resize/decimate/export). The full build below overrides with actuals.
    tex_px = _max_texture_px(mesh)
    if tex_px:
        meta["textures"] = {"beforePx": tex_px, "afterPx": min(tex_px, MAX_TEX),
                            "resized": 0, "cap": MAX_TEX, "willResize": tex_px > MAX_TEX}
    per_foot = int(len(mesh.faces)) // (2 if declared_count == 2 else 1)
    textured = _has_uv_texture(mesh)
    meta["decimation"] = {"applied": False, "before": per_foot, "after": per_foot,
                          "targetPerFoot": TRI_TARGET, "textured": textured,
                          "willDecimate": per_foot > TRI_TARGET and not textured}

    # 10. build the fitted files — HEAVY, only on request -------------------
    fitted = None
    if build_files:
        dec_before = dec_after = tex_before = tex_after = tex_resized = 0
        dec_skipped_tex = [False]

        def _prep(shoe):
            nonlocal dec_before, dec_after, tex_before, tex_after, tex_resized
            tb, ta, tr = _optimize_textures(shoe, MAX_TEX)
            tex_before = max(tex_before, tb)
            tex_after = max(tex_after, ta)
            tex_resized += tr
            n = int(len(shoe.faces))
            if _has_uv_texture(shoe):
                dec_before += n
                dec_after += n
                if n > TRI_TARGET:
                    dec_skipped_tex[0] = True
                return shoe
            d, before, after, _ = _decimate(shoe, TRI_TARGET)
            dec_before += before
            dec_after += after
            return d

        left_norm = right_norm = None
        if declared_count == 2 and halves and len(halves) >= 2:
            ordered = sorted(halves, key=lambda c: float(c.centroid[0]))
            left_norm = _normalise(_prep(ordered[0]), target_m, auto_orient=auto_orient)
            right_norm = _normalise(_prep(ordered[-1]), target_m, auto_orient=auto_orient)
        else:
            side = (declared_side or "right").lower()
            src = _prep(mesh)
            base = _normalise(src, target_m, auto_orient=auto_orient)
            opp = _normalise(src, target_m, mirror=True, auto_orient=auto_orient) if mirror_single else None
            if side == "left":
                left_norm, right_norm = base, opp
            else:
                right_norm, left_norm = base, opp

        primary_norm = right_norm or left_norm
        fitted = {}
        if left_norm is not None and right_norm is not None:
            fitted["combined"] = _combine_pair(left_norm, right_norm)
        elif primary_norm is not None:
            fitted["combined"] = primary_norm.export(file_type="glb")

        # override the projected report with what actually happened
        if tex_before:
            meta["textures"] = {"beforePx": tex_before, "afterPx": tex_after,
                                "resized": tex_resized, "cap": MAX_TEX}
            if tex_resized:
                meta["warnings"].append("Downscaled texture(s) %dpx -> %dpx for mobile "
                                        "AR performance." % (tex_before, tex_after))
        if dec_before:
            applied = dec_after < dec_before
            meta["decimation"] = {"applied": applied, "before": dec_before,
                                  "after": dec_after, "targetPerFoot": TRI_TARGET}
            if applied:
                meta["warnings"].append("Decimated %d -> %d triangles for real-time "
                                        "mobile AR performance." % (dec_before, dec_after))
            elif dec_skipped_tex[0]:
                meta["warnings"].append("High poly (%d triangles) but textured — "
                                        "geometry decimation skipped to preserve the UV "
                                        "texture; Lens Studio optimises it (UV-aware) at "
                                        "publish." % dec_before)

    meta["ok"] = True
    return meta, fitted
