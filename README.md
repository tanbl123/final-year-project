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
│   ├── scripts/    Stripe payout demo (test mode)
│   └── config.php / config.local.php (secrets — gitignored)
├── database/       schema.sql, seed*.sql, migrations/, NOTES.md
├── docs/           API_ENDPOINTS.md (the API contract), STRIPE_TEST_DEMO.md
├── shoear-web/     React admin + supplier web portal (Vite)
├── mobile/         Flutter apps (customer + delivery) — see mobile/README.md
└── ml/             (planned) Python/Flask recommender service
```

## Apps & who uses them

| App | Tech | Users | Status |
|-----|------|-------|--------|
| Admin + Supplier portal | React (`shoear-web/`) | Admin, Supplier | ✅ built |
| PHP REST API | PHP (`backend/`) | all apps | ✅ built (web + customer + delivery) |
| Customer app | Flutter (`mobile/customer/`) | Customer | ⏳ planned |
| Delivery app | Flutter (`mobile/delivery/`) | Delivery personnel | ⏳ planned |
| ML recommender | Python (`ml/`) | (serves the customer app) | ⏳ planned |

---

## How to run (local dev)

You run **two** things: the React frontend (Vite) and the PHP backend (XAMPP).

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
3. In **phpMyAdmin**, create the `shoear` database and import, in order:
   `database/schema.sql` → `seed.sql` → `seed_sales.sql` →
   `seed_multi_supplier.sql` → `seed_delivery.sql` → `seed_reviews.sql` →
   `seed_refunds.sql`, then apply everything in `database/migrations/`.
4. Put your Stripe **test** key in `backend/config.local.php` (optional, for the
   payout demo): `<?php return ['stripe_secret' => 'sk_test_...'];`
5. Verify: open `http://localhost/shoear/api/v1/ping` → should return `pong` JSON.

### 2. Frontend — React portal
```bash
cd shoear-web
npm install      # first time only
npm run dev      # → http://localhost:5173
```

### Demo logins (password: `password123`)
- **Admin:** `admin@shoear.com` (login at `/admin/login`)
- **Supplier:** `supplier@shoear.com`
- **Customer (data only):** `customer@shoear.com`

> If the web page loads but shows **"Failed to fetch"**, the backend isn't
> reachable — re-check XAMPP and the `http://localhost/shoear/api/v1/ping` step.

---

## Docs
- **`docs/API_ENDPOINTS.md`** — the full API contract (every endpoint, marked
  *(Implemented)*).
- **`database/NOTES.md`** — schema rationale + key design decisions.
- **`HANDOFF.md`** — project context + next steps (read this to resume work).
