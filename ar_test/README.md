# ar_test — Snapchat Camera Kit shoe try-on spike

Throwaway spike to confirm **Snapchat Camera Kit** foot-tracking shoe try-on works
with **our own custom shoe lens** on your phone (**ALI NX1**). Delete this folder
when done.

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
