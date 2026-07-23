"""
diag_autofit.py — diagnose the auto-fit pipeline WITHOUT the browser or GPU.

Runs autofit.analyze_and_fit directly on a local .glb so we can see whether the
model PROCESSING is the problem, isolated from the browser's WebGL rendering
(which is the only part that touches the GPU / can cause a video BSOD).

Usage (PowerShell, from the ml-service folder):
    python diag_autofit.py "C:\\Users\\you\\Downloads\\3d model\\your_model.glb"

It prints each stage + timing. If this completes without crashing, the Python
auto-fit is NOT the cause of the crash — the crash is the browser rendering the
model in WebGL, i.e. a GPU/driver issue on the machine.
"""
import sys
import time
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: python diag_autofit.py <path-to-.glb>")
        return
    path = sys.argv[1]
    if not os.path.isfile(path):
        print("File not found:", path)
        return

    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"[0] Reading file: {path} ({size_mb:.1f} MB)")
    with open(path, "rb") as f:
        data = f.read()

    print("[1] Importing autofit (loads trimesh)…")
    t = time.time()
    import autofit
    print(f"    ok ({time.time() - t:.2f}s)")

    print("[2] LIGHT analysis (build_files=False) — same as the 'Run auto-fit' button…")
    t = time.time()
    meta, fitted = autofit.analyze_and_fit(data, declared_count=None, build_files=False)
    print(f"    ok ({time.time() - t:.2f}s)")
    print(f"    rejected={meta['rejected']} reason={meta['rejectReason']}")
    print(f"    shoeCount={meta['shoeCount']} dims={meta['dimensionsCm']}")
    print(f"    textures={meta['textures']}")
    print(f"    decimation={meta['decimation']}")
    print(f"    warnings={meta['warnings']}")

    print("[3] FULL build (build_files=True) — same as 'Generate fitted model'…")
    t = time.time()
    meta2, fitted2 = autofit.analyze_and_fit(data, declared_count=None, build_files=True)
    kb = (len(fitted2["combined"]) / 1024) if fitted2 and "combined" in fitted2 else 0
    print(f"    ok ({time.time() - t:.2f}s) — fitted pair glb = {kb:.0f} KB")

    print("\nDONE. Python processed the model with NO crash.")
    print("If your PC still BSODs in the browser, the cause is WebGL/GPU rendering,")
    print("not this auto-fit logic.")

if __name__ == "__main__":
    main()
