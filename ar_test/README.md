# ar_test — DeepAR shoe try-on spike (webview plugin)

Throwaway spike to confirm DeepAR **foot-tracking** shoe try-on works with **our
own custom effect** on your phone (**ALI NX1**). Delete this folder when done.

## Why the webview plugin (not the native fork)

We tried the native fork `deepar_flutter_plus` (+ a downloaded `deepar.aar`). It
initialised, applied the effect and ran the camera, but **never tracked a shoe** —
not the demo, not our custom effect. The free native DeepAR SDK doesn't include
foot tracking.

The **official webview plugin `deepar_shoe_try_on_flutter`** uses DeepAR's *web*
engine, which **does** have foot tracking — it already tracked the demo shoe on
the foot. So we're back on it, and the only remaining job is getting our **own**
`.deepar` effect (hosted on Firebase) to load in it.

- No DeepAR license key needed.
- No `.aar` needed (the plugin bundles its own web engine).
- Only needs the **camera** permission and **minSdk ≥ 19**.

---

## Step CORS — let DeepAR's web player fetch our effect (do this first)

Our custom effect on Firebase gave *"Oops couldn't find this effect"* because the
plugin's web player fetches the `.deepar` file **cross-origin**, and the Firebase
bucket sends **no CORS headers**, so the browser blocks it. Fix it once:

Easiest — **Google Cloud Shell** (nothing to install):

1. Open <https://console.cloud.google.com>, pick project **shoear-65edb**.
2. Click the **Activate Cloud Shell** icon (`>_`, top-right).
3. Upload `cors.json` (⋮ menu → Upload) **or** paste this to create it:
   ```bash
   cat > cors.json <<'EOF'
   [{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Access-Control-Allow-Origin"],"maxAgeSeconds":3600}]
   EOF
   ```
4. Apply it to the bucket:
   ```bash
   gsutil cors set cors.json gs://shoear-65edb.firebasestorage.app
   ```
5. Confirm:
   ```bash
   gsutil cors get gs://shoear-65edb.firebasestorage.app
   ```
   You should see the policy printed back.

> If gsutil says the bucket doesn't exist, try `gs://shoear-65edb.appspot.com`
> (older Firebase projects use that name). Run `gsutil ls` to list your buckets.

---

## Step B — pull + build the spike

```bash
git checkout ar-deepar-spike
git pull
cd ar_test
flutter create .        # keeps our pubspec.yaml + lib/main.dart
flutter pub get
```

## Step C — Android setup

- `android/app/build.gradle(.kts)` → `minSdk = 19` or higher (23 is fine).
- `android/app/src/main/AndroidManifest.xml` — add ABOVE `<application ...>`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.INTERNET" />
  ```
- The `deepar.aar` from the native attempt is no longer needed — you can leave it
  or delete `android/app/libs/deepar.aar`; it's ignored by this plugin.

## Step D — run

```bash
flutter run -d AWCX6R4329002626
```
Grant camera, point at your foot. The app **starts on the CUSTOM effect**; use the
bottom button to flip between **CUSTOM** and **DEMO** to compare.

---

## What to report back
- ✅ **Custom shoe tracks your foot** → 🎉 done — we wire this into the customer app.
- ⚠️ **"Couldn't find this effect" on CUSTOM but DEMO tracks** → CORS not applied
  yet (redo Step CORS) or the bucket name is different.
- ⚠️ **Neither tracks / build error** → paste the exact error; likely a
  `webview_flutter` version pin on this old plugin.

## If a build error appears (`does not provide an inline implementation`)
This plugin is an old (2022) beta and pins old webview packages. If `flutter pub
get` / build fails, paste the FULL error — the fix is a `dependency_overrides`
block in pubspec pinning `webview_flutter*` to versions the plugin expects.
