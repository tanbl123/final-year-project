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
cd mobile/customer
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
