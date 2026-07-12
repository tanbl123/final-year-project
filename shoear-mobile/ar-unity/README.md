# ShoeAR — AR Virtual Try-On (Unity AR Foundation)

This folder holds the **AR try-on scaffold** for the customer app, matching the
proposal's Chapter 2 SDK choice: **Unity AR Foundation** (cross-platform, wraps
ARCore on Android + ARKit on iOS) embedded into the Flutter app via
`flutter_unity_widget`.

> It is **staged here, outside `lib/`**, on purpose. `flutter_unity_widget`
> won't build until the exported Unity library is present in your local
> `android/` and `ios/` folders — so integrating early would break the app.
> Follow the steps below on your machine, then activate.

## What's here

```
ar-unity/
  Assets/Scripts/
    ArTryOnController.cs   # AR brain: receives Flutter commands, tap-to-place,
                           # transform (scale/rotate/flip), screenshot, events.
                           # ← YOUR tunable parameters live here.
    ShoeModelLoader.cs     # loads .glb/.gltf from a URL (glTFast) + fallback
  flutter/
    ar_tryon_screen.dart   # the Flutter screen that hosts Unity + the controls
  README.md                # this guide
```

## Architecture

```
Flutter (customer app)                Unity (AR Foundation)
──────────────────────                ─────────────────────
ArTryOnScreen  ──postMessage──►  ARController GameObject
  scale/rotate/flip/reset/capture      ├─ ARSession + XR Origin (camera/SLAM)
                                       ├─ ARPlaneManager (floor detection)
  ◄──SendMessageToFlutter──            ├─ ARRaycastManager (tap-to-place)
  ready / placed / captured / error    ├─ ArTryOnController.cs  ← parameters
                                       └─ ShoeModelLoader.cs (glTFast .glb)
```

Unity does the heavy lifting (camera, SLAM tracking, plane detection, 3D
rendering). The Flutter screen only sends control commands and reacts to events.

---

## Prerequisites

- **Unity 2021.3 LTS or 2022.3 LTS** (match the version `flutter_unity_widget`
  supports — check its pub.dev page).
- A **physical Android device with ARCore** support (emulators can't do AR).
  iOS needs a real device with ARKit + a Mac/Xcode to build.
- Your existing Flutter customer app.

---

## Step 1 — Create the Unity project + packages

1. New Unity project → **3D (URP or Built-in)**.
2. **Window → Package Manager**, install:
   - **AR Foundation**
   - **Google ARCore XR Plugin**
   - **Apple ARKit XR Plugin**
   - **glTFast** — *Add package by name* → `com.unity.cloud.gltfast`
     (older Unity: `com.atteneder.gltfast`)
3. **Edit → Project Settings → XR Plug-in Management** → enable **ARCore**
   (Android tab) and **ARKit** (iOS tab).

## Step 2 — Build the AR scene

In a new scene:

1. Delete the default `Main Camera`.
2. Add **XR Origin (AR)**  (`GameObject → XR → XR Origin (AR)`) — this brings the
   AR camera.
3. Add **AR Session** (`GameObject → XR → AR Session`).
4. On the **XR Origin**, add components:
   - **AR Plane Manager**
   - **AR Raycast Manager**
5. Create an empty GameObject, **rename it exactly `ARController`**, and add:
   - `ArTryOnController.cs`
   - `ShoeModelLoader.cs`
6. On `ArTryOnController`, assign in the Inspector:
   - **Raycast Manager** → the XR Origin's AR Raycast Manager
   - **Model Loader** → the `ShoeModelLoader` component
7. (Optional) On `ShoeModelLoader`, assign a **Fallback Prefab** (any bundled
   shoe) so offline demos still show a model.

> Copy the two `.cs` files from `Assets/Scripts/` here into your Unity project's
> `Assets/Scripts/`.

## Step 3 — Add the flutter_unity_widget bridge to Unity

1. In your Flutter project, add the dependency (see Step 5) and run
   `flutter pub get` so the package is downloaded.
2. From the downloaded package, import its Unity helper package
   (`fuw-*.unitypackage`, found under the package's `unity/` folder) into your
   Unity project — this provides the `FlutterUnityIntegration` namespace
   (`UnityMessageManager`) that the controller uses.
3. Follow the package's **"Configure Unity Project"** and **"Export"** docs:
   set the scene in **Build Settings**, then use its menu
   **Flutter → Export Android (or iOS)**.

## Step 4 — Export Unity into the Flutter app

- **Android:** export creates `android/unityLibrary`. The package's setup adds
  it to `android/settings.gradle` and `android/app/build.gradle`. Set
  `minSdkVersion 24` (ARCore requirement).
- **iOS:** export creates `ios/UnityLibrary`; add `UnityFramework` per the
  package docs, open the workspace in Xcode.

Follow the current `flutter_unity_widget` README exactly for these — the steps
change per version and are easy to get wrong.

## Step 5 — Activate on the Flutter side

1. Add to `shoear-mobile/customer/pubspec.yaml` under `dependencies:`
   ```yaml
     flutter_unity_widget: ^2022.2.0   # use the latest compatible version
   ```
2. Copy the screen into the app:
   ```
   ar-unity/flutter/ar_tryon_screen.dart
     →  shoear-mobile/customer/lib/features/ar/screens/ar_tryon_screen.dart
   ```
3. Wire the existing **AR Try-On** button in
   `lib/features/catalog/screens/product_detail_screen.dart`.
   Add the import:
   ```dart
   import 'package:customer/features/ar/screens/ar_tryon_screen.dart';
   ```
   Replace the placeholder `onPressed`:
   ```dart
   // BEFORE
   onPressed: () => context.showSnack('AR try-on is coming in the next update.'),

   // AFTER
   onPressed: () {
     final url = p.modelUrl;
     if (url == null || url.isEmpty) {
       context.showSnack('No 3D model available for this product yet.');
       return;
     }
     Navigator.of(context).push(MaterialPageRoute(
       builder: (_) => ArTryOnScreen(productName: p.name, modelUrl: url),
     ));
   },
   ```

## Step 6 — Platform permissions

- **Android** (`android/app/src/main/AndroidManifest.xml`):
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-feature android:name="android.hardware.camera.ar" android:required="true" />
  <meta-data android:name="com.google.ar.core" android:value="required" />
  ```
- **iOS** (`ios/Runner/Info.plist`):
  ```xml
  <key>NSCameraUsageDescription</key>
  <string>Camera access is needed for AR shoe try-on.</string>
  ```

## Step 7 — Run on a device

```
cd shoear-mobile/customer
flutter pub get
flutter run   # on a connected ARCore/ARKit device (NOT an emulator)
```

Open a product that has a 3D model + AR enabled → tap **AR Try-On** → point at
the floor → tap to place → use the controls.

---

## Your parameter-tuning work (for the viva)

Unity AR Foundation is the SDK; **your contribution is calibrating the
parameters** so the shoe fits and behaves correctly. They're the `[SerializeField]`
values in `ArTryOnController.cs`:

| Parameter | Meaning | Maps to report |
|---|---|---|
| `baseScale` | Base size applied to every model | `ScaleFactor = DetectedFootWidth / ModelWidth` |
| `rotationStep` | Degrees per Rotate tap | rotation term in the affine transform |
| `previewOffset` | Where the shoe floats before placement | initial translation `(t_x, t_y)` |
| `_flipped` (Flip) | Horizontal reflection (`-x` scale) | "flip function … horizontal reflection" |
| Reset / Capture | Restore transform / screenshot | "reset function" / "capture function" |

Tune `baseScale` first: place a shoe next to a real one and adjust until a
UK9 model looks life-sized.

## Honest scope note (defensible)

AR Foundation (ARCore/ARKit) provides plane/world tracking but **not native foot
tracking**. So try-on = **place on a detected surface + manual fit** (scale to
your foot, rotate, flip). This is consistent with your report's own statement
that the AR is at a **"basic interaction level."** True foot-locked tracking
(as in WANNA Kicks/DeepAR) needs a dedicated foot-tracking ML model, noted as
future work in your Chapter 4 evaluation.

## Follow-up (optional)

- **"AR try-on frequency"** admin analytic (mentioned in the proposal): add a
  `POST /catalog/products/{id}/ar-view` event log the screen calls on open, and
  surface the count in the admin dashboard. Ask and I'll build the backend +
  wiring (that part IS testable here).
