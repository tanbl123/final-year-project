"""
autofit.py — ShoeAR AR auto-fit (semi-automatic pipeline).

This is a DETERMINISTIC GEOMETRY algorithm (NOT machine learning). Given a
supplier's shoe .glb + a few declared facts, it:

  1. VALIDATES the model against the ShoeAR submission policy
     (format / size / triangle budget / basic shape + orientation sanity).
  2. BAKES the fit into the geometry — uniform-scales the shoe to its real
     length, orients it to the standard (toe +Z, sole on Y=0), and centres it
     on the sole — then exports normalised per-foot .glb files that drop into
     the Lens Studio foot rig with (near) no manual tuning.
  3. Handles 1 or 2 shoes: two shoes are placed left/right; a single shoe is
     mirrored for the other foot (branding reversed — the supplier is warned).

It runs OFFLINE in the ML service, so it does NOT hit Camera Kit's
"no network + biometric tracking in one lens" restriction (which is why full
runtime auto-generation isn't possible — see ar-lens-prototype/README.md).

Submission policy the validation assumes:
  * .glb, textures embedded, no Draco, <= 8 MB, <= 100k triangles
  * modelled at real-world size (metres); toe -> +Z, up -> +Y, sole on Y=0
  * supplier declares: shoe count (1 or 2), real length (cm), and (for a
    single shoe) which side it is.
"""

import io
import numpy as np
import trimesh

MAX_BYTES = 8 * 1024 * 1024      # 8 MB
MAX_TRIANGLES = 100_000
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


def _split_two_by_x(mesh):
    """Split a two-shoe mesh into left/right halves by the median X of the face
    centres. Robust for two shoes sitting side by side and needs no graph engine
    (works even where connected-component splitting is unavailable)."""
    tc = mesh.triangles_center
    med = float(np.median(tc[:, 0]))
    out = []
    for face_idx in (np.where(tc[:, 0] <= med)[0], np.where(tc[:, 0] > med)[0]):
        if len(face_idx):
            out.append(mesh.submesh([face_idx], append=True))
    return out


def _count_clusters(mesh, overall_max):
    """Best-effort shoe-count (for a validation warning only). Returns an int, or
    None if connected-component splitting isn't available in this environment."""
    try:
        comps = mesh.split(only_watertight=False)
    except Exception:
        return None
    big = [c for c in comps if float(c.extents.max()) > 0.15 * overall_max]
    return len(big) if big else 1


def _normalise(mesh, scale, mirror=False):
    """Return a copy scaled by `scale`, optionally mirrored across X, then seated
    on the ground: centred in X/Z with the sole (min Y) at Y=0."""
    m = mesh.copy()
    m.apply_scale(scale)
    if mirror:
        m.apply_transform(np.diag([-1.0, 1.0, 1.0, 1.0]))  # reflect across X
        m.faces = np.fliplr(m.faces).copy()                # restore winding (normals outward)
    b = m.bounds                       # [[minx,miny,minz],[maxx,maxy,maxz]]
    cx = (b[0][0] + b[1][0]) / 2.0
    cz = (b[0][2] + b[1][2]) / 2.0
    m.apply_translation([-cx, -b[0][1], -cz])   # X/Z centred, sole to Y=0
    return m


def analyze_and_fit(glb_bytes, declared_count=1, declared_length_cm=None,
                    declared_side="right", mirror_single=True):
    """Validate + auto-fit a shoe model.

    Returns (meta, fitted) where:
      meta   = dict (ok / rejected / rejectReason / warnings / shoeCount /
               dimensionsCm / appliedScale / side)
      fitted = {"left": glb_bytes, "right": glb_bytes} normalised per foot,
               or None if the model was rejected.
    """
    length_cm = float(declared_length_cm) if declared_length_cm else DEFAULT_LENGTH_CM
    meta = {
        "ok": False, "rejected": False, "rejectReason": None, "warnings": [],
        "shoeCount": declared_count, "dimensionsCm": None,
        "appliedScale": None, "side": declared_side,
    }

    # 1. size ---------------------------------------------------------------
    if len(glb_bytes) > MAX_BYTES:
        meta["rejected"] = True
        meta["rejectReason"] = "File exceeds the 8 MB limit."
        return meta, None

    # 2. parse (Draco / corrupt files raise here) ---------------------------
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

    # 3. triangle budget ----------------------------------------------------
    tri = int(len(mesh.faces))
    if tri > MAX_TRIANGLES:
        meta["rejected"] = True
        meta["rejectReason"] = "Model has %d triangles (limit %d)." % (tri, MAX_TRIANGLES)
        return meta, None

    # dimensions + uniform scale (length runs along +Z per the policy) ------
    size = mesh.extents                       # [x, y, z] in native units (metres)
    length_n, width_n, height_n = float(size[2]), float(size[0]), float(size[1])
    target_m = length_cm / 100.0
    scale = (target_m / length_n) if length_n > 1e-9 else 1.0
    meta["appliedScale"] = round(scale, 5)
    meta["dimensionsCm"] = {
        "length": round(length_n * scale * 100, 1),
        "width":  round(width_n * scale * 100, 1),
        "height": round(height_n * scale * 100, 1),
    }

    # 4. shape / orientation sanity (warnings only) -------------------------
    if not (length_n >= width_n >= height_n):
        meta["warnings"].append("Unusual proportions (expected length >= width >= "
                                "height); the model may be mis-oriented "
                                "(toe should point +Z, sole down).")
    if height_n > 1e-9 and abs(mesh.bounds[0][1]) > 0.5 * height_n:
        meta["warnings"].append("Sole is not near Y=0; check the sole-down / "
                                "origin-at-sole rule.")

    # 5. count sanity (best-effort; warning only) ---------------------------
    detected = _count_clusters(mesh, float(size.max()))
    if detected is not None:
        if declared_count == 2 and detected < 2:
            meta["warnings"].append("Declared 2 shoes but only one cluster "
                                    "detected — parts may be joined.")
        if declared_count == 1 and detected >= 2:
            meta["warnings"].append("Declared 1 shoe but %d clusters detected — "
                                    "extra parts, or is this actually a pair?" % detected)

    # 6. bake -> normalised per-foot glbs -----------------------------------
    fitted = {}
    if declared_count == 2:
        # two shoes: split by X median (policy: left shoe on -X, right on +X)
        halves = _split_two_by_x(mesh)
        if len(halves) >= 2:
            ordered = sorted(halves, key=lambda c: float(c.centroid[0]))
            fitted["left"] = _normalise(ordered[0], scale).export(file_type="glb")
            fitted["right"] = _normalise(ordered[-1], scale).export(file_type="glb")
        else:
            meta["warnings"].append("Could not separate two shoes; treating as one.")
            declared_count = 1
    if declared_count == 1 and not fitted:
        # single shoe: place on its declared side, mirror for the other foot
        side = (declared_side or "right").lower()
        base = _normalise(mesh, scale)
        opp = _normalise(mesh, scale, mirror=True) if mirror_single else None
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
