"""
autofit.py — ShoeAR AR auto-fit (semi-automatic pipeline).

DETERMINISTIC GEOMETRY (NOT machine learning). Given a supplier's shoe .glb +
a few declared facts, it:

  1. VALIDATES the model (format / size / triangle budget + shape sanity).
  2. AUTO-ORIENTS the model with PCA — finds its natural length/width/height
     axes (eigenvectors of the vertex covariance) and rotates it to canonical
     axes (length -> +Z, width -> X, height -> Y). This straightens an
     arbitrarily-rotated model so the fit is reliable. PCA is linear algebra,
     not ML. It fixes the AXES; it does not disambiguate DIRECTION (toe/heel,
     sole/top) — the submission policy + admin QC cover that.
  3. BAKES the fit into normalised per-foot .glb files (uniform-scale to real
     length, seat sole on Y=0, centre on the sole) that drop into the Lens
     Studio foot rig with (near) no manual tuning.
  4. Handles 1 or 2 shoes: two shoes are split left/right; a single shoe is
     mirrored for the other foot (branding reversed — supplier is warned).

Runs OFFLINE in the ML service, so it does NOT hit Camera Kit's
"no network + biometric tracking in one lens" restriction (which is why full
runtime auto-generation isn't possible — see ar-lens-prototype/README.md).
"""

import io
import numpy as np
import trimesh

MAX_BYTES = 50 * 1024 * 1024     # 50 MB — generous; Lens Studio optimises at publish
TRI_WARN = 150_000               # high-poly: warn (admin/Lens Studio can decimate)
DEFAULT_LENGTH_CM = 26.0         # average adult foot if none declared


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


def _pca_align(mesh):
    """Return a copy rotated so its natural axes are canonical: length -> Z,
    width -> X, height -> Y, centred at the origin. Uses PCA (eigenvectors of the
    vertex covariance), so it straightens an arbitrarily-rotated model.
    Deterministic geometry, not ML. DIRECTION (toe/heel, sole/top) is NOT
    disambiguated — only the axes are aligned."""
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


def _split_two_by_x(mesh):
    """Split a two-shoe mesh into left/right halves by the median X of the face
    centres — robust for two shoes side by side, needs no graph engine."""
    tc = mesh.triangles_center
    med = float(np.median(tc[:, 0]))
    out = []
    for face_idx in (np.where(tc[:, 0] <= med)[0], np.where(tc[:, 0] > med)[0]):
        if len(face_idx):
            out.append(mesh.submesh([face_idx], append=True))
    return out


def _count_clusters(mesh, overall_max):
    """Best-effort shoe-count (validation warning only). Returns int, or None if
    connected-component splitting isn't available here."""
    try:
        comps = mesh.split(only_watertight=False)
    except Exception:
        return None
    big = [c for c in comps if float(c.extents.max()) > 0.15 * overall_max]
    return len(big) if big else 1


def _normalise(mesh, target_length_m, mirror=False, auto_orient=True):
    """Return a copy: (PCA-aligned if auto_orient), uniform-scaled so its length
    == target, optionally mirrored across X, then seated (X/Z centred, sole on
    Y=0) — ready to drop into the foot rig."""
    m = _pca_align(mesh) if auto_orient else mesh.copy()
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


def analyze_and_fit(glb_bytes, declared_count=1, declared_length_cm=None,
                    declared_side="right", mirror_single=True, auto_orient=True):
    """Validate + auto-fit a shoe model.

    Returns (meta, fitted):
      meta   = dict (ok / rejected / rejectReason / warnings / shoeCount /
               dimensionsCm / appliedScale / side / autoOriented)
      fitted = {"left": glb_bytes, "right": glb_bytes} normalised per foot,
               or None if rejected.
    """
    length_cm = float(declared_length_cm) if declared_length_cm else DEFAULT_LENGTH_CM
    target_m = length_cm / 100.0
    meta = {
        "ok": False, "rejected": False, "rejectReason": None, "warnings": [],
        "shoeCount": declared_count, "dimensionsCm": None, "appliedScale": None,
        "side": declared_side, "autoOriented": bool(auto_orient),
    }

    # 1. size ---------------------------------------------------------------
    if len(glb_bytes) > MAX_BYTES:
        meta["rejected"] = True
        meta["rejectReason"] = "File exceeds the 8 MB limit."
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

    # 3. triangle budget (warn, don't reject — Lens Studio can decimate) ----
    tri = int(len(mesh.faces))
    if tri > TRI_WARN:
        meta["warnings"].append("High poly count (%d triangles) — consider "
                                "decimating for AR performance." % tri)

    # measure ONE shoe (aligned) for the reported dimensions + scale --------
    if declared_count == 2:
        halves = _split_two_by_x(mesh)
        measure = halves[0] if halves else mesh
    else:
        measure = mesh
    aligned = _pca_align(measure) if auto_orient else measure
    size = aligned.extents
    length_n, width_n, height_n = float(size[2]), float(size[0]), float(size[1])
    scale = (target_m / length_n) if length_n > 1e-9 else 1.0
    meta["appliedScale"] = round(scale, 5)
    meta["dimensionsCm"] = {
        "length": round(length_n * scale * 100, 1),
        "width":  round(width_n * scale * 100, 1),
        "height": round(height_n * scale * 100, 1),
    }

    # 4. orientation / shape notes ------------------------------------------
    if auto_orient:
        meta["warnings"].append("Auto-oriented with PCA — verify toe/heel and "
                                "sole-down direction during QC (PCA fixes the "
                                "axes, not the facing).")
    else:
        if not (length_n >= width_n >= height_n):
            meta["warnings"].append("Unusual proportions (expected length >= width "
                                    ">= height); model may be mis-oriented.")
        if height_n > 1e-9 and abs(measure.bounds[0][1]) > 0.5 * height_n:
            meta["warnings"].append("Sole is not near Y=0; check the sole-down rule.")

    # 5. count sanity (best-effort; warning only) ---------------------------
    detected = _count_clusters(mesh, float(mesh.extents.max()))
    if detected is not None:
        if declared_count == 2 and detected < 2:
            meta["warnings"].append("Declared 2 shoes but only one cluster "
                                    "detected — parts may be joined.")
        if declared_count == 1 and detected >= 2:
            meta["warnings"].append("Declared 1 shoe but %d clusters detected — "
                                    "extra parts, or is this a pair?" % detected)

    # 6. bake -> normalised per-foot glbs -----------------------------------
    fitted = {}
    if declared_count == 2:
        halves = _split_two_by_x(mesh)
        if len(halves) >= 2:
            ordered = sorted(halves, key=lambda c: float(c.centroid[0]))
            fitted["left"] = _normalise(ordered[0], target_m, auto_orient=auto_orient).export(file_type="glb")
            fitted["right"] = _normalise(ordered[-1], target_m, auto_orient=auto_orient).export(file_type="glb")
        else:
            meta["warnings"].append("Could not separate two shoes; treating as one.")
            declared_count = 1
    if declared_count == 1 and not fitted:
        side = (declared_side or "right").lower()
        base = _normalise(mesh, target_m, auto_orient=auto_orient)
        opp = _normalise(mesh, target_m, mirror=True, auto_orient=auto_orient) if mirror_single else None
        if side == "left":
            fitted["left"] = base.export(file_type="glb")
            if opp is not None:
                fitted["right"] = opp.export(file_type="glb")
        else:
            fitted["right"] = base.export(file_type="glb")
            if opp is not None:
                fitted["left"] = opp.export(file_type="glb")
        if mirror_single and declared_count == 1:
            meta["warnings"].append("Single shoe mirrored for the other foot — "
                                    "branding on the mirrored side is reversed. "
                                    "Upload both shoes for accurate left/right designs.")

    meta["ok"] = True
    return meta, fitted
