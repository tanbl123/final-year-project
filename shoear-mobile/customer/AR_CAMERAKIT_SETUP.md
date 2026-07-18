# Customer app — AR Try-On (Snapchat Camera Kit) setup

The AR try-on is wired into the customer app (Dart side is committed). To run it
you apply the **native Android config once, locally** (it carries your Camera Kit
credentials, which must NOT be committed), then test end-to-end.

## What's already wired (committed)
- `ProductDetail.arLensId` + `arReady` (from `GET /catalog/products/{id}`).
- `features/ar/ar_tryon_service.dart` — opens Camera Kit with a product's lens.
- Product detail **"AR Try-On"** button appears when `p.arReady` and opens Camera Kit.
- `pubspec.yaml` — `camerakit_flutter` + `permission_handler`.
- One app-level lens group id (`kCameraKitGroupId`, default `fdac5175-…`), override
  with `--dart-define=CK_GROUP_ID=…`.

## 1. Get deps
```bash
cd shoear-mobile/customer
flutter pub get
```

## 2. Android config (local only — do NOT commit these)
**`android/app/src/main/AndroidManifest.xml`**
- Add `xmlns:tools="http://schemas.android.com/tools"` to the `<manifest>` tag.
- Above `<application>`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.INTERNET" />

  <!-- Camera Kit's media-picker module pulls these in; remove them so the
       "access photos and videos" prompt never appears during AR try-on.
       (Profile/order photos use image_picker's system Photo Picker, which
       needs no permission, so this is safe.) -->
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" tools:node="remove" />
  ```
- Inside `<application …>` (paste YOUR values):
  ```xml
  <meta-data android:name="com.snap.camerakit.app.id" android:value="YOUR_APP_ID" />
  <meta-data android:name="com.snap.camerakit.api.token" android:value="YOUR_STAGING_TOKEN" />
  ```
- Give `<application>` an AppCompat theme: add `android:theme="@style/NormalTheme"`.

**`android/app/src/main/res/values/styles.xml`** — make `NormalTheme` AppCompat:
```xml
<style name="NormalTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="android:windowBackground">?android:colorBackground</item>
</style>
```

**`android/app/build.gradle.kts`**
- `minSdk = 23` (>= 21).
- Force a Camera Kit SDK new enough for Lens Studio 5.22 lenses (the plugin ships
  an old 1.40.0). Add at the **top level** (outside `android { }`):
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

*(iOS, when needed: `Info.plist` → `SCCameraKitClientID`, `SCCameraKitAPIToken`,
`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`; Podfile iOS 13+.)*

## 3. End-to-end test
1. **Admin (web):** Inventory → open a product that has a **3D model** → in the
   **"AR try-on lens (Camera Kit)"** field paste the product's **lens id** → Save.
   *(That lens must be in the app's Camera Kit lens group — the `fdac5175…` group,
   or whatever `CK_GROUP_ID` you build with.)*
2. **Customer (app):**
   ```bash
   flutter run   # add --dart-define=CK_GROUP_ID=<group> if not using the default
   ```
   Open that product → tap **AR Try-On** → point the rear camera at your foot.

The button only appears once the admin has set the lens id (`arReady`), so when it
shows, it always works.

## Notes
- App ID + token authenticate at the app level (not per package id), so the same
  credentials from the spike work here.
- Staging token adds a "Camera Kit / Snapchat" watermark — fine for the FYP.
- The old `shoear-mobile/ar-deepar/` scaffold is obsolete (DeepAR dropped SDK shoe
  try-on) and can be deleted.
