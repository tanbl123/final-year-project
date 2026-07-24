"""
diag_autofit.py — diagnose the auto-fit pipeline WITHOUT the browser or GPU.

Runs the pipeline on a local .glb, one stage at a time with flushed prints, so
the LAST line printed tells us exactly where a crash/freeze happens. No browser,
no WebGL — so if this still crashes the PC, the cause is the machine (RAM / GPU
driver on a shared-memory laptop), not the browser rendering.

Usage (PowerShell, from the ml-service folder):
    python diag_autofit.py "C:\\Users\\User\\Downloads\\3d model\\model.glb"
    python diag_autofit.py "...model.glb" --full     # also run the heavy build

TIP: try a SMALL model first (e.g. a 2-5 MB one). If a small model works and a
big one crashes, it's a memory limit on this machine.
"""
import sys
import time
import os
import io


def mem_mb():
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        return None


def log(msg):
    m = mem_mb()
    suffix = f"  [RAM {m:.0f} MB]" if m is not None else ""
    print(msg + suffix, flush=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_full = "--full" in sys.argv
    if not args:
        print("Usage: python diag_autofit.py <path-to-.glb> [--full]")
        return
    path = args[0]
    if not os.path.isfile(path):
        print("File not found:", path)
        return

    size_mb = os.path.getsize(path) / (1024 * 1024)
    log(f"[0] Reading file: {os.path.basename(path)} ({size_mb:.1f} MB)")
    with open(path, "rb") as f:
        data = f.read()

    log("[1] import trimesh …")
    import trimesh
    import autofit

    log("[2] trimesh.load (decodes geometry + textures — a RAM spike here means")
    log("    the file's textures are too big for this machine) …")
    t = time.time()
    loaded = trimesh.load(io.BytesIO(data), file_type="glb", process=False)
    log(f"    loaded in {time.time() - t:.2f}s")

    log("[3] combine + strip to geometry-only …")
    mesh = autofit._combined(loaded)
    tri = int(len(mesh.faces))
    tex = autofit._max_texture_px(mesh)
    log(f"    triangles={tri}  max_texture={tex}px")
    del loaded, mesh

    log("[4] LIGHT analysis (build_files=False) — the 'Run auto-fit' button …")
    t = time.time()
    meta, fitted = autofit.analyze_and_fit(data, declared_count=None, build_files=False)
    log(f"    done in {time.time() - t:.2f}s  rejected={meta['rejected']}")
    print(f"    shoeCount={meta['shoeCount']} dims={meta['dimensionsCm']}", flush=True)
    print(f"    textures={meta['textures']}", flush=True)
    print(f"    warnings={meta['warnings']}", flush=True)

    if do_full:
        log("[5] FULL build (build_files=True) — 'Generate fitted model' (heavy) …")
        t = time.time()
        meta2, f2 = autofit.analyze_and_fit(data, declared_count=None, build_files=True)
        kb = (len(f2["combined"]) / 1024) if f2 and "combined" in f2 else 0
        log(f"    done in {time.time() - t:.2f}s  fitted pair = {kb:.0f} KB")

    print("\nDONE — Python processed the model with NO crash.", flush=True)
    print("If your PC still BSODs only in the browser, the cause is WebGL/GPU"
          " rendering, not this logic.", flush=True)


if __name__ == "__main__":
    main()
