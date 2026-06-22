# ShoeAR — Customer app (Flutter)

The customer-facing mobile app. Consumes the same PHP REST API as the web
portal (`../../backend/`, contract in `../../docs/API_ENDPOINTS.md`).

> **Status — Increment 1:** project scaffold + API client + customer login
> (JWT, persisted) + **browse catalog** (search, product grid, product detail).
> Cart, checkout, reviews, refunds and **AR try-on** come in later increments.

This folder holds only the app source (`lib/` + `pubspec.yaml`). The
platform folders (`android/`, `ios/`, …) are generated locally and gitignored.

---

## 0. Install Flutter (one-time)

You don't have Flutter yet, so start here:

1. Install the **Flutter SDK**: https://docs.flutter.dev/get-started/install
   (pick your OS; on Windows, unzip it and add `flutter\bin` to your PATH).
2. Install **Android Studio** (gives you the Android SDK + an emulator), then
   in Android Studio: *More Actions → Virtual Device Manager → Create Device*
   to make an emulator. (Or use a real phone — see step 4.)
3. Verify your setup:
   ```bash
   flutter doctor
   ```
   Fix anything it flags with a ✗ (especially "Android toolchain" and
   "Android licenses" — run `flutter doctor --android-licenses`).

## 1. Generate the platform folders

From inside this folder, let Flutter create the `android/` `ios/` etc. wrappers
around the existing `lib/` + `pubspec.yaml`:

```bash
cd shoear-mobile/customer
flutter create .
flutter pub get
```

`flutter create .` adds the native project folders without touching `lib/` or
`pubspec.yaml`.

## 2. Point the app at your API

Edit **`lib/config.dart`** and set `apiBaseUrl` for where you run the app:

| Running on | Use |
|------------|-----|
| Android emulator | `http://10.0.2.2/shoear/api/v1` (the default) |
| iOS simulator | `http://localhost/shoear/api/v1` |
| Physical phone | `http://<your-PC-LAN-IP>/shoear/api/v1` (same Wi-Fi; XAMPP Apache must allow LAN access) |

`10.0.2.2` is a special alias the Android emulator uses to reach your PC's
`localhost` — that's where XAMPP serves the API.

## 3. Run

Make sure **XAMPP (Apache + MySQL) is running**, then:

```bash
flutter run
```

(Or press Run in VS Code / Android Studio with an emulator or device selected.)

### 4. Using a physical phone instead of an emulator
- Enable **Developer options → USB debugging**, plug in via USB, accept the prompt.
- `flutter devices` should list it; `flutter run` will use it.
- Set `apiBaseUrl` to your PC's LAN IP (e.g. `http://192.168.1.5/shoear/api/v1`),
  and make sure your firewall/XAMPP allows the connection.

## Stripe checkout (card payments)

Card checkout uses **Stripe test mode** via the `flutter_stripe` PaymentSheet.
PayPal stays simulated. After `flutter pub get`, do the one-time native setup
(these folders are generated locally, so they aren't in the repo):

**1. Backend keys** — in `backend/config.local.php`:
```php
'stripe_secret'      => 'sk_test_...',   // Stripe → Developers → API keys
'stripe_publishable' => 'pk_test_...',
```

**2. Android** (`android/`):
- `android/app/build.gradle.kts` → `minSdk = 21` (or higher).
- `MainActivity.kt` → extend `FlutterFragmentActivity` (not `FlutterActivity`):
  ```kotlin
  import io.flutter.embedding.android.FlutterFragmentActivity
  class MainActivity : FlutterFragmentActivity()
  ```
- `res/values/styles.xml` **and** `res/values-night/styles.xml` → the `NormalTheme`
  parent must be an AppCompat/MaterialComponents theme, e.g.
  `Theme.MaterialComponents.DayNight.NoActionBar`.

**3. iOS** (`ios/`): set the platform to 13+ in `ios/Podfile`:
```ruby
platform :ios, '13.0'
```

**4. Test card:** `4242 4242 4242 4242`, any future expiry, any CVC/postcode.

> The backend creates a PaymentIntent (`POST /orders/{id}/payment-intent`), the
> app collects the card via PaymentSheet, then the server **verifies the
> PaymentIntent** before marking the order Paid. With no Stripe key configured,
> the server returns `STRIPE_NOT_CONFIGURED` (PayPal still works, simulated).

## Notifications

The app has an **in-app notification centre** (the 🔔 bell on the Home screen):
the backend writes a notification whenever an order or refund changes status
(payment received, shipped, out for delivery, delivered, refund approved /
rejected / completed) and the app lists them with an unread badge. This works
out of the box — **no Firebase needed** — over the same REST API
(`GET /notifications`, `PATCH /notifications/{id}/read`, `POST /notifications/read-all`).

### Real background push (FCM) — client is wired, just add the Firebase files

The client is implemented (`PushService` + token registration on login + the
backend FCM sender). It's **graceful**: with no Firebase config the app runs
normally and push is simply off. To turn it on:

**1. Backend** — one Firebase service-account key powers both Storage and push
(see "Cloud storage" below). In `backend/config.local.php`:
```php
'firebase_service_account' => '/absolute/path/to/serviceAccount.json',
```
The backend then pushes to every registered device whenever it creates a
notification.

**2. App native config** (the generated `android/` `ios/` folders aren't in git):
- `flutter pub get` (pulls `firebase_core` + `firebase_messaging`).
- Easiest: from this folder run `flutterfire configure` (select your project and
  the **android** platform). This drops `android/app/google-services.json`,
  generates `lib/firebase_options.dart`, and wires the Gradle plugin for you.
- Otherwise, manually: add the Android app in the Firebase console, download
  **`google-services.json`** into `android/app/`, add the classpath
  `com.google.gms:google-services` in `android/build.gradle(.kts)` and apply the
  `com.google.gms.google-services` plugin in `android/app/build.gradle(.kts)`
  (and `minSdk >= 21`).
- **Fix the app display name** (used by the notification-permission dialog). The
  `android/` folder is regenerated by `flutter create .`, which sets the label to
  the project name (`customer`) — so the prompt reads "Allow **customer** to send
  you notifications?". In `android/app/src/main/AndroidManifest.xml` change
  `android:label="customer"` to `android:label="ShoeAR"` (re-apply after any
  `flutter create .`).
- iOS: add the app, drop `GoogleService-Info.plist` into `ios/Runner/`, and
  enable Push Notifications + an APNs key in Firebase. (Set the display name via
  `CFBundleDisplayName` in `ios/Runner/Info.plist`.)

That's it — `PushService.init()` runs at startup, and the device token is
registered (`POST /notifications/device`) on login. Backgrounded pushes show in
the tray automatically; foregrounded ones refresh the 🔔 bell.

## Cloud storage (images + 3D models)

Uploads (product images, `.glb` models, avatars, proof/issue photos) go through
one swap seam (`backend/lib/storage.php`). With Firebase configured they upload
to **Firebase Storage** and return a public download URL; otherwise they save to
`backend/uploads/` locally. In `backend/config.local.php`:
```php
'firebase_service_account' => '/absolute/path/to/serviceAccount.json',
'firebase_storage_bucket'  => 'your-project-id.appspot.com',
```
(Same service-account key as push.)

## Test login

Browsing works without logging in (the catalog is public). To test sign-in, use
the seeded demo customer:

- **Email:** `customer@shoear.com`  (or username `democustomer`)
- **Password:** `password123`

Only **Customer** accounts can sign in here.

## Project layout

```
lib/
├── config.dart                 API base URL
├── main.dart                   app entry + providers + theme
├── api/api_client.dart         HTTP wrapper, unwraps {success,data,error}
├── models/                     product.dart, user_session.dart
├── services/                   auth_service.dart, catalog_service.dart
├── state/auth_provider.dart    session (login/logout, persisted JWT)
└── screens/                    catalog, product_detail, login
```
