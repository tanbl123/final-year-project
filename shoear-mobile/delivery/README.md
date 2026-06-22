# ShoeAR — Delivery Personnel app (Flutter)

The courier app. Couriers sign in, see the parcels assigned to them, move each
through its delivery workflow, confirm hand-off with the customer's OTP, and
upload a proof-of-delivery photo. Consumes the same PHP REST API as the customer
app and web portal (`../../backend/`, contract in `../../docs/API_ENDPOINTS.md`).

> This folder holds only the app source (`lib/` + `pubspec.yaml`). The platform
> folders (`android/`, `ios/`, …) are generated locally and gitignored.

## 1. Generate the platform folders

```bash
cd shoear-mobile/delivery
flutter create .
flutter pub get
```

## 1b. Fix the app display name

`flutter create .` sets the Android app label to the project folder name
(`delivery`). Change it to **ShoeAR Express** in
`android/app/src/main/AndroidManifest.xml`:
```xml
android:label="ShoeAR Express"
```
Re-apply after any future `flutter create .` (the `android/` folder is gitignored).

## 1c. Firebase push notifications (optional)

The courier app supports real background push (FCM) using the same Firebase
project as the customer app. The client is already wired — to turn it on:

1. From this folder, run:
   ```bash
   dart pub global run flutterfire_cli:flutterfire configure
   ```
   Select the `shoear` Firebase project and the **android** platform.
   This generates `lib/firebase_options.dart` and `android/app/google-services.json`.

2. In `android/app/build.gradle.kts` verify `minSdk = 21` and the
   `com.google.gms.google-services` plugin is applied (flutterfire usually adds
   this automatically).

3. Restart Apache (XAMPP) and make sure `backend/config.local.php` has:
   ```php
   'firebase_service_account' => '/path/to/serviceAccount.json',
   ```

Without Firebase configured the app works normally — push is simply off.

## 2. Point the app at your API

Edit **`lib/config.dart`** and set `apiBaseUrl`:

| Running on | Use |
|------------|-----|
| Android emulator | `http://10.0.2.2/shoear/api/v1` (the default) |
| iOS simulator | `http://localhost/shoear/api/v1` |
| Physical phone | `http://<your-PC-LAN-IP>/shoear/api/v1` |

## 3. Run

Make sure **XAMPP (Apache + MySQL) is running**, then `flutter run`.

### Camera/gallery for proof photos
`image_picker` needs the usual permissions. `flutter create .` sets sane
defaults; for a physical device the OS will prompt on first use. The proof photo
is uploaded straight to `POST /deliveries/{id}/proof` (multipart) — couriers
don't use the supplier-only `/uploads` endpoint.

## Courier sign-up (self-apply + admin approval)

New couriers tap **"Apply to be a courier"** on the login screen and submit their
details (name, username, email, phone, vehicle details, password). This mirrors
how real platforms onboard drivers (Grab/Lalamove/Shopee SPX):

> **Vehicle brand & model** are picked from dropdowns populated live by the free
> [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) (no key needed): type →
> brand → model. If the API is unreachable, or the brand isn't listed (it's a
> US dataset, so some local brands like Perodua/Proton may be missing), each
> field falls back to free text so a courier is never blocked.


1. The app calls `POST /auth/register/courier` → the account is created as
   **`Pending`** (it cannot log in yet).
2. An admin reviews it in the web portal under **Couriers** (`/admin/couriers`)
   and **approves** (→ `Active`) or **rejects** (with a reason, optionally a
   permanent ban).
3. Once approved, the courier logs in normally. A rejected applicant sees the
   reason at login.

## Test login (seeded couriers)

From `database/seed_delivery.sql` — three Active delivery personnel, all with
password `password123`:

- `rider_ali`   (Ali Rahman — Honda EX5)
- `rider_siti`  (Siti Nurhaliza — Yamaha LC135)
- `rider_chong` (Chong Wei — Perodua Bezza)

Only **DeliveryPersonnel** accounts can sign in here. To see assignments, an
admin must assign deliveries to the courier (web portal → Deliveries), or pay an
order whose split parcels auto-assign to the least-loaded courier.

## Delivery workflow

```
Assigned ──"Mark as picked up"──▶ PickedUp ──"Start delivery"──▶ OutForDelivery
                                                                      │
                                          (a 4-digit OTP is generated │ for the customer)
                                                                      ▼
                            enter customer OTP + (optional) proof photo ──▶ Delivered
```
A courier can also mark an out-for-delivery parcel **Failed**. The parent order
status rolls up from all its parcels (least-progressed wins).

## Project layout

```
lib/
├── config.dart                 API base URL
├── main.dart                   app entry + providers + theme
├── core/api/api_client.dart    HTTP wrapper (+ multipart upload)
└── features/
    ├── auth/                   login (DeliveryPersonnel only), session
    ├── delivery/               models, service, list/history/detail screens
    └── shell/main_shell.dart   login gate + 2-tab nav
```
