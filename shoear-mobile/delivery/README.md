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
