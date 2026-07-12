# ar_test — DeepAR feasibility spike

Throwaway project to confirm DeepAR foot-tracking shoe try-on works on your phone
(**ALI NX1**) before we build anything real. Delete this folder when done.

Only `pubspec.yaml` + `lib/main.dart` are in git — you generate the rest locally.

## Run it (on this branch, `ar-deepar-spike`)

```bash
# 1. get this branch
git fetch origin
git checkout ar-deepar-spike

# 2. go into the spike
cd ar_test

# 3. generate the platform folders (android/ios). This does NOT overwrite our
#    pubspec.yaml or lib/main.dart. If it ever does, restore them with:
#      git checkout -- pubspec.yaml lib/main.dart
flutter create .

# 4. fetch packages
flutter pub get
```

### Add camera permission (Android)
`flutter create` just made `android/`. Open
`android/app/src/main/AndroidManifest.xml` and add these ABOVE `<application ...>`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
```
Also confirm `minSdkVersion` is 21+ in `android/app/build.gradle`
(if it says `flutter.minSdkVersion`, change to `21`).

### Run on your phone (with live logs)
```bash
flutter run -d AWCX6R4329002626
```
Tap **Start AR Try-On**, grant camera permission, point at your feet.

## What to report back
- ✅ shoe appears on your foot and tracks it → the plugin works; we proceed.
- ⚠️ red error / blank screen / build failure → copy the terminal error text
  (or screenshot) so we can debug. Likely culprits (all fixable): the plugin's
  import/class name differs in the installed version, the demo link changed, or
  a license prompt.

> If `flutter create .` feels awkward, you can instead just run
> `flutter create ar_test2` fresh, then copy our `lib/main.dart` + the
> `deepar_shoe_try_on_flutter` dependency into it — same result.
