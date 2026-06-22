# Firebase setup — exact manual steps

This turns on the two cloud features whose **code is already implemented**:

1. **Cloud file storage** (product images, 3D `.glb` models, avatars, proof/issue photos) → Firebase Storage
2. **Real background push notifications** → Firebase Cloud Messaging (FCM)

One Firebase project + **one service-account key** powers both. Until you do
this, the app keeps working on local storage with in-app-only notifications.

---

## PART A — Create the Firebase project (once, ~3 min)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it e.g. `shoear` → Continue. (Google Analytics is optional — you can disable it.)
3. Wait for it to finish, then **Continue** to the project dashboard.

---

## PART B — Backend: Storage + push (no app changes)

### B1. Enable Storage and get the bucket name
1. Left menu → **Build → Storage** → **Get started**.
2. Choose **production** or **test** mode (either is fine — our backend uploads
   with an admin service account and serves files via token URLs, so the rules
   don't block it). Pick a location → **Done**.
3. At the top of the Storage page, copy the bucket name. It looks like
   **`shoear-xxxx.appspot.com`** (or `...firebasestorage.app`). Save it.

### B2. Generate the service-account key
1. Click the **⚙️ gear** (top-left) → **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**. A `.json` file downloads.
3. Move that file somewhere your XAMPP PHP can read, e.g.
   `C:\xampp\htdocs\shoear\backend\firebase-service-account.json`.
   > ⚠️ Keep this file secret — never commit it. (It's already outside git.)

### B3. Point the backend at it
Open (or create) **`backend/config.local.php`** and add these keys to the
returned array (copy `backend/config.local.example.php` if you don't have it yet):
```php
return [
  // ...your existing keys (stripe_secret, smtp, etc.)...

  'firebase_service_account' => 'C:/xampp/htdocs/shoear/backend/firebase-service-account.json',
  'firebase_storage_bucket'  => 'shoear-xxxx.appspot.com',   // from B1
];
```
> Use forward slashes `/` in the path even on Windows.

### B4. Test the backend (storage + that the key works)
- Restart Apache (XAMPP) so PHP re-reads the config.
- In the **supplier web portal**, add/edit a product and upload an image, or in
  the **customer app** change your profile photo.
- The returned image URL should now start with
  `https://firebasestorage.googleapis.com/...` (instead of `http://localhost/...`),
  and the image should appear. ✅ Storage works.
- Check the **Storage** tab in the console — you'll see `images/…`, `models/…`
  folders filling up.

That's storage **and** the push backend done (push just needs the app side next).

---

## PART C — Customer app: enable FCM push (Android)

The push **client code is already wired** (`PushService`); it just needs the
Firebase config files. Easiest path is the FlutterFire CLI.

### C1. One-time tooling
```bash
dart pub global activate flutterfire_cli
npm install -g firebase-tools     # if you don't have the Firebase CLI
firebase login
```

### C2. Generate the config
From **`shoear-mobile/customer`**:
```bash
flutter pub get
flutterfire configure
```
- Pick your **shoear** project from the list.
- Select platforms: at least **android** (and **ios** if you'll run on iPhone).
- This downloads `android/app/google-services.json`, generates
  `lib/firebase_options.dart`, and adds the Google-Services Gradle plugin for you.

### C3. Make sure Android can build with Firebase
`flutterfire configure` usually does this, but verify in
**`android/app/build.gradle.kts`**:
- `minSdk` is **21 or higher** (you already set this for Stripe).
- the plugins block includes `id("com.google.gms.google-services")`.

If `flutterfire configure` did **not** add the plugin, add it manually:
- `android/settings.gradle.kts` → in the top `plugins { … }` block:
  ```kotlin
  id("com.google.gms.google-services") version "4.4.2" apply false
  ```
- `android/app/build.gradle.kts` → in its `plugins { … }` block:
  ```kotlin
  id("com.google.gms.google-services")
  ```

### C3b. Fix the app display name
`flutter create .` sets the Android app label to the project name (`customer`),
so the notification-permission dialog reads "Allow **customer** to send you
notifications?". Open **`android/app/src/main/AndroidManifest.xml`** and change:
```xml
android:label="customer"   →   android:label="ShoeAR"
```
Re-apply this after any future `flutter create .` (the `android/` folder is
gitignored, so it's regenerated locally).

### C4. Run and test push
1. `flutter run` on a real device or emulator (with the XAMPP backend reachable —
   `10.0.2.2` for the emulator).
2. Log in as the demo customer. On first launch it asks for notification
   permission → **Allow**.
3. The app silently registers its FCM token (`POST /notifications/device`).
4. Trigger a real notification: place + pay an order, or have the courier app
   advance a delivery / report an issue. You should get:
   - a **tray notification** if the app is backgrounded, and
   - the 🔔 **bell badge** updating in-app.

Quick manual test without an order: Firebase console → **Messaging** →
**Create your first campaign → Firebase Notification messages → Send test
message**, paste the device's FCM token (you can log it from `getToken()`), Send.

---

## PART D — iOS (only if you'll run on iPhone)

1. In `flutterfire configure` include **ios** (drops `GoogleService-Info.plist`
   into `ios/Runner/`).
2. Apple Developer account → enable **Push Notifications** capability and create
   an **APNs Auth Key**; upload it in Firebase console → Project settings →
   **Cloud Messaging → Apple app configuration**.
3. `cd ios && pod install`. Set the iOS platform to **13+** in `ios/Podfile`.
4. Push only works on a **physical iPhone**, not the simulator.

---

## Quick reference — what goes where

| Thing | Where you put it |
|-------|------------------|
| Service-account `.json` | on the PHP server; path in `backend/config.local.php` |
| `firebase_storage_bucket` | `backend/config.local.php` |
| `google-services.json` | `shoear-mobile/customer/android/app/` (via `flutterfire configure`) |
| `GoogleService-Info.plist` | `shoear-mobile/customer/ios/Runner/` (iOS only) |
| APNs key | Firebase console (iOS only) |

## Verify checklist
- [ ] Uploaded image URL starts with `firebasestorage.googleapis.com` → **Storage on**
- [ ] Files show under the console **Storage** tab
- [ ] App asked for notification permission on first launch
- [ ] A test message / real order event shows a tray notification → **Push on**

## Notes
- The **courier app** can get push too — it already has the token endpoint; the
  same `PushService` just needs to be added there (ask and I'll wire it).
- Everything is **reversible/optional**: remove the two `firebase_*` keys from
  `config.local.php` and the backend falls straight back to local storage +
  in-app-only notifications.
