# ShoeAR — AR Sport-Shoe Virtual Try-On Marketplace

Final-year project. An e-commerce platform for sport shoes with **AR virtual
try-on** and an **ML recommender**, built three-tier: many client apps → one
PHP REST API → one MySQL database.

## Repository layout (monorepo)

```
final-year-project/
├── backend/        PHP REST API (the single source the apps talk to)
│   ├── api/v1/     front controller (index.php) + .htaccess router
│   ├── controllers/ endpoint handlers (auth, catalog, cart, orders, …)
│   ├── lib/        db, auth/JWT, ids, response, stripe, delivery dispatch
│   ├── scripts/    maintenance + Stripe payout demo (test mode)
│   └── config.php / config.local.php (secrets — gitignored)
├── database/       shoear.sql (full export), schema.sql, seed*.sql, migrations/, NOTES.md
├── docs/           API_ENDPOINTS.md (the API contract), STRIPE_TEST_DEMO.md
├── shoear-web/     React admin + supplier + AR-specialist web portal (Vite)
├── shoear-mobile/  Flutter apps (customer + delivery) — see shoear-mobile/README.md
└── ml-service/     Python/Flask recommender + AR model auto-fit service
```

## Apps & who uses them

| App | Tech | Users | Status |
|-----|------|-------|--------|
| Admin + Supplier + AR-specialist portal | React (`shoear-web/`) | Admin, Supplier, AR Specialist | ✅ built |
| PHP REST API | PHP (`backend/`) | all apps | ✅ built |
| Customer app | Flutter (`shoear-mobile/customer/`) | Customer | ✅ built |
| Delivery app | Flutter (`shoear-mobile/delivery/`) | Delivery personnel | ✅ built |
| ML recommender + AR auto-fit | Python (`ml-service/`) | serves the customer app | ✅ built |

---

## How to run (local dev)

There are **four** parts: the PHP backend, the React web portal, the Python ML
service, and the Flutter mobile apps. The backend + database are required; the
others connect to it.

### 1. Backend — PHP API via XAMPP
1. Install **XAMPP**; start **Apache** + **MySQL**.
2. Serve the `backend/` folder at `http://localhost/shoear/` (the API base is
   hardcoded to `/shoear/api/v1`). Easiest is a **symlink** so edits are live
   (run cmd **as Administrator**, adjust the path to your clone):
   ```cmd
   mklink /D "C:\xampp\htdocs\shoear" "C:\path\to\final-year-project\backend"
   ```
   *(If you moved/renamed the project, delete the old `C:\xampp\htdocs\shoear`
   first: `rmdir "C:\xampp\htdocs\shoear"` — that removes only the link, not your
   code. A symlink also includes the hidden `.htaccess`, which a copy often
   misses.)*
3. In **phpMyAdmin**, create the `shoear` database and import
   **`database/shoear.sql`** — a full export that contains the schema and the
   demonstration data, including the accounts for all five roles.
   *(The individual `schema.sql` + `seed*.sql` files are also provided if you
   prefer to build the database from scratch, but they use different demo
   accounts.)*
4. Add your secret keys to `backend/config.local.php` (see
   `config.local.example.php`): the JWT secret, and the Stripe / EasyParcel /
   Firebase / Snapchat Camera Kit keys as needed.
5. Verify: open `http://localhost/shoear/api/v1/ping` → should return `pong` JSON.

### 2. Web portal — React (admin, supplier, AR specialist)
```bash
cd shoear-web
npm install      # first time only
npm run dev      # → http://localhost:5173
```

### 3. ML service — Python / Flask (recommender + AR auto-fit)
```bash
cd ml-service
python -m venv venv
venv\Scripts\activate            # Windows (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python app.py                     # → http://127.0.0.1:5001  (check /health)
```
If the service is not running, the backend falls back to a simple query, so the
app still works. See `ml-service/README.md` for details.

### 4. Mobile apps — Flutter (customer + delivery)
Each app needs `flutter create .` run once locally (the native `android/`,
`ios/` folders are generated and gitignored). Full steps, including setting
`apiBaseUrl` in `lib/config.dart`, are in `shoear-mobile/README.md` and
`shoear-mobile/customer/README.md`.
```bash
cd shoear-mobile/customer     # (or shoear-mobile/delivery)
flutter create .              # generates android/ios/etc around the existing lib/
flutter pub get
flutter run                   # emulator default apiBaseUrl: http://10.0.2.2/shoear/api/v1
```

### Demo logins
Accounts from the imported `shoear.sql`. The password is `Password?` for every
role **except the admin**, whose password is `Password123?`.
- **Admin:** `admin@shoear.com` — `Password123?`
- **Supplier:** `timbunleong2@gmail.com` — `Password?`
- **Customer:** `timbunleong5@gmail.com` — `Password?`
- **AR Specialist:** `timbunleong4@gmail.com` — `Password?`
- **Delivery:** `zzggb321@gmail.com` — `Password?`

> If the web page loads but shows **"Failed to fetch"**, the backend isn't
> reachable — re-check XAMPP and the `http://localhost/shoear/api/v1/ping` step.

---

## Docs
- **`docs/API_ENDPOINTS.md`** — the full API contract (every endpoint).
- **`docs/STRIPE_TEST_DEMO.md`** — Stripe test-mode payment + payout demo.
- **`database/NOTES.md`** — schema rationale + key design decisions.
- **`shoear-mobile/README.md`**, **`shoear-mobile/customer/README.md`** — mobile setup.
- **`ml-service/README.md`** — ML recommender + AR auto-fit setup.
