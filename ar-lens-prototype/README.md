# ShoeAR — Full-auto AR try-on prototype

Experimental. Goal: **one "universal" Camera Kit lens** that renders **any** shoe by
downloading its `.glb` at runtime and applying an auto-computed fit — so there is
**no per-shoe Lens Studio build**. If it works we cut the admin's manual lens work
to zero; if it doesn't, we fall back to the semi-automatic flow (admin builds the
lens, `autofit.py` only assists).

This is on the `ar-auto-fit` branch so `main` stays a working demo.

## How it would work (if the gate passes)
```
supplier uploads .glb
   → autofit.py computes { modelUrl, scale, pos, rot }   (geometry, not ML)
   → customer app opens the ONE universal lens + those values as Camera Kit LaunchData
   → the lens downloads the .glb at runtime and fits it on both feet
```
Every product uses the **same lens id**; only the LaunchData differs.

## The de-risk gate — do this FIRST (Lens Studio, on a COPY of your project)
`UniversalTryOn.js` is the make-or-break piece. Set it up per the header comments,
then test with **hardcoded fallback values** (your known-good numbers from `Shoe_L`:
pos `-12.7, -6.77, 1.0`, scale `3.25, 2.81, 3.04`) and a **public `.glb` URL**.

Outcomes:
- ✅ **Shoe downloads and foot-tracks** → full-auto is viable. Next: build
  `autofit.py` + wire the app's LaunchData, then merge to `main`.
- ❌ **Fails** (can't bind the dynamic mesh / domain blocked / Draco-only model)
  → abandon this branch, keep semi-auto on `main`. Note the exact blocker for the
  report.

## Known risks to watch (report these if hit)
1. **Dynamic foot-binding** — attaching a runtime-loaded mesh to the foot rig +
   occluder is the hardest part.
2. **Domain allowlist** — the `.glb` host must be allowlisted in the project, or
   `loadResourceAsGltfAsset` fails.
3. **Runtime download latency** — first open downloads the model (cache later).
4. **glTF constraints** — heavy textures / Draco compression may not load at
   runtime; keep models lean.

## Docs
- GltfAsset: https://developers.snap.com/lens-studio/api/lens-scripting/classes/Built-In.GltfAsset
- RemoteServiceModule: https://developers.snap.com/lens-studio/api/lens-scripting/classes/Built-In.RemoteServiceModule.html
- Camera Kit LaunchData / app↔lens: https://developers.snap.com/camera-kit/ar-content/guides/communicating-between-lenses-and-app
