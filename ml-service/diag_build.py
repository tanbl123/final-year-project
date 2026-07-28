"""Standalone build diagnostic — isolates the AR auto-fit BUILD from the web app,
browser and Lens Studio, so we can see exactly where a "Generate fitted model"
hang happens on a specific file (and Ctrl+C it safely).

Usage (from the ml-service folder):
    python diag_build.py "C:\\path\\to\\the_model.glb"
    python diag_build.py "C:\\...\\world_cup_shoes.glb" --count 2 --side right --length 27.9
    python diag_build.py "C:\\...\\model.glb" --straighten     # test with auto-straighten on

Watch the [autofit build] lines. The LAST one before it stalls is the culprit:
  * stalls after "start"           -> the split
  * stalls after "split done"      -> a foot prep/orient
  * stalls after both feet         -> the combine/export
  * prints "combined+exported" fast, total is small -> the ML build is FINE, so
    the crash is the browser rendering the result (client-side), not this code.
Press Ctrl+C to stop instead of waiting for a crash.
"""
import argparse
import time

import autofit as A


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="path to the .glb file")
    ap.add_argument("--count", type=int, default=2, help="1 (single) or 2 (pair); default 2")
    ap.add_argument("--side", default="right", help="single-shoe base foot: left|right")
    ap.add_argument("--length", type=float, default=27.9, help="real shoe length in cm")
    ap.add_argument("--straighten", action="store_true", help="auto-straighten (default off = trust file)")
    args = ap.parse_args()

    with open(args.path, "rb") as f:
        data = f.read()
    print("loaded %s (%.1f MB)" % (args.path, len(data) / 1024 / 1024), flush=True)

    t0 = time.time()
    try:
        meta, fitted = A.analyze_and_fit(
            data,
            declared_count=(args.count if args.count in (1, 2) else None),
            declared_length_cm=args.length,
            declared_side=args.side,
            auto_orient=args.straighten,
            build_files=True,
        )
    except KeyboardInterrupt:
        print("\n[interrupted] hung for %.1fs — see the last [autofit build] line above." % (time.time() - t0))
        return
    dt = time.time() - t0
    combined = (fitted or {}).get("combined")
    print("\nDONE in %.2fs" % dt, flush=True)
    print("  rejected:", meta.get("rejected"), meta.get("rejectReason") or "")
    print("  shoeCount:", meta.get("shoeCount"), " dims:", meta.get("dimensionsCm"))
    print("  combined .glb bytes:", len(combined) if combined else 0)


if __name__ == "__main__":
    main()
