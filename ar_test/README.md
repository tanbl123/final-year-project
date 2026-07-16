# ar_test — Snapchat Camera Kit shoe try-on spike ✅ WORKING

Throwaway spike that **confirmed** Snapchat Camera Kit foot-tracking shoe try-on
works with **our own custom shoe lens** on the phone (**ALI NX1**). Delete this
folder once the real customer app is wired up.

## ⚠️ The two non-obvious things that made it work (READ THIS)

1. **A Lens *Folder* is NOT a Camera Kit *Lens Group*.** Publishing a lens puts it
   in a My-Lenses *folder* (id `331a5457…`) — Camera Kit will NOT serve that id.
   You must go to **Camera Kit portal → Lens Scheduler → Lens Groups → New Lens
   Group**, add your lens, and use **that** group id (`fdac5175…`). The lens id is
   `0a1cd533…`.

2. **The `camerakit_flutter` plugin bundles an OLD Camera Kit SDK (1.40.0)** that
   can't run lenses built in Lens Studio 5.22. Force the current SDK (1.50.0) in
   `android/app/build.gradle.kts` — but leave the two media modules at their
   pinned 1.27.0 (Snap never published them at 1.50.0):
   ```kotlin
   configurations.all {
     resolutionStrategy.eachDependency {
       if (requested.group == "com.snap.camerakit" &&
           requested.name != "support-media-picker-source" &&
           requested.name != "support-media-recording") {
         useVersion("1.50.0")
       }
     }
   }
   ```

## Run command that works
```bash
flutter run -d <device> \
  --dart-define=CK_GROUP_ID=fdac5175-05fe-47e9-adf5-108b36419d71 \
  --dart-define=CK_LENS_ID=0a1cd533-081e-41b9-8a82-3091f8a21c4b
```
(Credentials — App ID `e7546233…` + staging token — go in the local
AndroidManifest, never committed.)

## Known limitation (for the report)
Snap's SnapML foot detector occasionally **false-positives on a hand** (similar
shape/skin tone to a foot). It tracks the real foot well, but this is a monocular
foot-tracking limitation worth noting in the evaluation. DeepAR's tracking looked
a touch tighter, but DeepAR no longer supports custom footwear effects at all — so
Camera Kit is the only viable free path, with this minor trade-off.

---

## Why Snapchat (not DeepAR)

DeepAR **removed shoe try-on from its SDK** (a staff member confirmed it "has been
moved from the DeepAR SDK to the ShopAR platform", and "Flutter is not being
actively supported"). So custom foot-tracking effects can't run on the free DeepAR
path. Snapchat's **Camera Kit** + **Lens Studio Footwear Try-On** is the only free
route left to a custom in-app shoe — and Snap actively maintains it (foot tracking
was upgraded to a new SnapML model in 2025).

> The DeepAR version is preserved on the `ar-deepar-spike` branch as a fallback.

- Free at our scale; **staging** token just adds a Snapchat watermark (fine for a
  demo — mention it as a limitation, like DeepAR's).
- Live camera + real-time lens via the `camerakit_flutter` package.

---

## Step 1 — Snap developer account + Camera Kit app
1. Sign in at **https://devportal.snap.com/** with a Snapchat account.
2. Create an **Organization** (if asked), then a **Camera Kit** app.
3. Copy the **App ID** and the **Staging API token** (Staging = watermark, fine).

## Step 2 — Build the lens in Lens Studio, publish to Camera Kit
1. Install **Lens Studio** (free, https://ar.snap.com/download) — v4.34.0+.
2. New project → **Footwear Try-On** template.
3. Replace the `[REPLACE_ME]` shoe object with your own shoe model (`model.glb`).
   Tune scale/position/rotation so it sits on the foot. (This is your per-shoe
   tuning contribution — same skill, better tool.)
4. **Publish** the lens and **link it to your Camera Kit app** (assign it to a
   **lens group**). Copy the **lens group ID**.

## Step 3 — wire credentials into the Android build
`git checkout ar-snapchat-spike && git pull`, then in `ar_test`:
```bash
flutter create .
flutter pub get
```
- `android/app/src/main/AndroidManifest.xml` — inside `<application>` add (paste
  your real values; these stay LOCAL, not committed):
  ```xml
  <meta-data android:name="com.snap.camerakit.app.id" android:value="YOUR_APP_ID" />
  <meta-data android:name="com.snap.camerakit.api.token" android:value="YOUR_STAGING_TOKEN" />
  ```
  Keep the CAMERA / RECORD_AUDIO / INTERNET `<uses-permission>` lines (above
  `<application>`).
- `android/app/build.gradle(.kts)` → `minSdk = 21` or higher (23 is fine).
- Kotlin **1.8.10+** (bump `ext.kotlin_version` / the Kotlin plugin if older).
- `android/app/src/main/res/values/styles.xml` — the app theme must inherit
  **`Theme.AppCompat.NoActionBar`** (Camera Kit requires an AppCompat theme).

## Step 4 — run with your lens group ID
```bash
flutter run -d AWCX6R4329002626 --dart-define=CK_GROUP_ID=YOUR_LENS_GROUP_ID
```
Tap **Open AR Try-On**, grant camera/mic, point at your foot.

---

## What to report back
- ✅ **Your custom shoe appears and tracks your foot** → 🎉 we integrate Camera Kit
  into the real customer app.
- ⚠️ **Camera opens but no shoe / wrong placement** → Lens Studio tuning (scale /
  position / occluder) — we iterate on the lens.
- ⚠️ **Build error** (Kotlin/theme/minSdk) → paste it; usually the AppCompat theme,
  Kotlin version, or minSdk bump above.
- ⚠️ **"Invalid token" / lenses don't load** → double-check the App ID + staging
  token in the manifest and the lens group ID passed via `--dart-define`.
