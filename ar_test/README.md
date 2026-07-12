# ar_test — DeepAR feasibility spike (using `deepar_flutter_plus`)

Confirms DeepAR **foot-tracking** shoe try-on works on your phone (**ALI NX1**)
before we build anything real. Throwaway — delete this folder when done.

> The official `deepar_shoe_try_on_flutter` plugin is an **abandoned 2022 beta**
> and won't build. We use the maintained community fork **`deepar_flutter_plus`**
> instead (it runs the real native DeepAR SDK). This fork **requires a DeepAR
> license key**, so unlike before there's no free demo shortcut — you must create
> a (free) DeepAR account first.

## The two unknowns this spike answers
1. Does the fork build + initialize on your device? (likely yes)
2. **Does it actually FOOT-track a shoe effect?** (the real question — the fork is
   face-effects–oriented; foot tracking depends on the native SDK version it ships)

---

## Step A — DeepAR account + Android license key + native SDK (.aar)
1. Create a **free DeepAR account** → developer portal.
2. Create a **project / app** with package id **`com.example.ar_test`**
   (that's this spike's applicationId).
3. Copy the **Android license key**.
4. **Download the DeepAR Android SDK (`.aar`)** from the portal. (DeepAR's native
   SDK is NOT bundled in the plugin — you must add it manually.) Follow the
   `deepar_flutter_plus` README for the exact placement — typically drop the
   `.aar` into `ar_test/android/app/libs/` and it's picked up by Gradle. Without
   this, the Android build fails.

## Step B — Pull the updated spike + generate platform folders
```bash
git checkout ar-deepar-spike
git pull
cd ar_test
flutter create .        # keeps our pubspec.yaml + lib/main.dart
flutter pub get
```

## Step C — Android setup
- `android/app/src/main/AndroidManifest.xml` — add ABOVE `<application ...>`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.INTERNET" />
  ```
- `android/app/build.gradle` (or `build.gradle.kts`): set **`minSdkVersion 23`**
  (the fork needs Android SDK 23+).

## Step D — Run on your phone WITH your license key
```bash
flutter run -d AWCX6R4329002626 --dart-define=DEEPAR_ANDROID_KEY=PASTE_YOUR_KEY
```
Tap **Start AR Try-On**, grant camera/mic, point at your feet. The on-screen
status line shows progress/errors.

---

## What to report back
- ✅ **Shoe appears on your foot and tracks it** → 🎉 DeepAR-Flutter works; we
  integrate it into the real app.
- ⚠️ **Face-only / shoe doesn't stick to foot** → the fork's SDK version may not
  support foot tracking; tell me and we decide (newer effect, or fall back).
- ⚠️ **An error on the status line or in the terminal** → paste it; likely an API
  name tweak (check the `deepar_flutter_plus` pub.dev example) or the effect URL
  needs replacing with one you export from DeepAR Studio.

## If the demo effect URL fails
Build a shoe effect in **DeepAR Studio** (foot-tracking template → export
`.deepar`), host it (Firebase), and change `kEffectUrl` in `lib/main.dart`.
