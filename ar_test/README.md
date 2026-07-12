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

## THE REAL ROOT CAUSE (why the custom effect said "couldn't find this effect")

The plugin builds the webview URL like this (from its source):

```dart
static const String kBaseUrl = "https://try.deepar.ai/flutter/shoe";
controller.loadRequest(Uri.parse('$kBaseUrl?e=$link'));   // link NOT url-encoded
```

So it loads `https://try.deepar.ai/flutter/shoe?e=<effectUrl>`. Because `<effectUrl>`
is pasted in **raw**, a Firebase *download* URL breaks it: that URL has its own
query string `...model.deepar?alt=media&token=XXXX`. The player splits on `&`, so
`token=XXXX` is torn off as a separate param and the effect URL loses its token →
Firebase returns **403** → the player shows *"couldn't find this effect"*.

The demo URL works only because it has **no `?`/`&`** to collide.

**Fix: host the effect at a CLEAN url (no `?`, no `&`).** The direct Google Cloud
Storage object URL is clean — it just needs the object made public.

### Make the effect object public (one command, in Cloud Shell)

```bash
gsutil acl ch -u AllUsers:R gs://shoear-65edb.firebasestorage.app/model.deepar
```
If that errors with *"uniform bucket-level access"*, use IAM instead:
```bash
gsutil iam ch allUsers:objectViewer gs://shoear-65edb.firebasestorage.app
```
Then the clean URL (already set as `kCustomEffectUrl` in `lib/main.dart`) is:
```
https://storage.googleapis.com/shoear-65edb.firebasestorage.app/model.deepar
```

### CORS (already done, keep it)

We also set the bucket CORS earlier so the cross-origin fetch is allowed:
```bash
gsutil cors set cors.json gs://shoear-65edb.firebasestorage.app
gsutil cors get gs://shoear-65edb.firebasestorage.app   # verify
```
`cors.json` is in this folder. This stays required — leave it in place.

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
