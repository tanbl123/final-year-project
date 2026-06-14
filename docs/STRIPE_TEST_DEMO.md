# Stripe multi-supplier payout demo (test mode)

This shows the **whole money flow** for the marketplace, using only **fake
Stripe test data** — no real money ever moves:

1. Each supplier gets a Stripe **test connected account** with a **fake test
   bank account** (Stripe generates these).
2. A demo customer buys one item **from each supplier** in a single order.
3. The customer pays the **platform** once (a test card charge).
4. The platform **keeps the commission** and sends each supplier their **net**
   as a Stripe **Transfer** → *each supplier receives money*.
5. Order / payment / payout rows are written to MySQL, so the **Sales report**
   (per supplier) and the **Commission report** (admin) show real numbers.

```
                          ┌─────────────── platform (admin) ───────────────┐
 customer ── pays once ──►│  charge (test card)                            │
                          │      ├── keeps commission (10%)  ── admin       │
                          │      ├── transfer net ──► Supplier 1 (test acct)│
                          │      ├── transfer net ──► Supplier 2 (test acct)│
                          │      └── transfer net ──► Supplier 3 (test acct)│
                          └────────────────────────────────────────────────┘
```

This uses Stripe's standard **separate charges & transfers** marketplace
pattern. The commission is exactly the amount the platform does **not**
transfer out.

---

## One-time setup

1. **Get a Stripe test key.** Stripe Dashboard → Developers → API keys →
   *Reveal test key* (starts with `sk_test_`).

2. **Enable Connect in test mode.** Stripe Dashboard → **Connect** → *Get
   started*. (Without this, creating connected accounts fails.)

3. **Add the key locally — never commit it.** Create `backend/config.local.php`
   (it's gitignored):

   ```php
   <?php
   return ['stripe_secret' => 'sk_test_your_key_here'];
   ```

4. **Set up the database** (phpMyAdmin → *shoear* → Import, in this order):
   - `database/schema.sql`
   - `database/seed.sql`
   - `database/seed_sales.sql` *(optional — gives Supplier 1 some history)*
   - `database/seed_multi_supplier.sql`  ← adds Supplier 2 & 3
   - Apply `database/migrations/2026_06_14_supplier_payout.sql`
     (only needed if your DB predates the `supplier_payout` table; a fresh
     `schema.sql` already includes it).

---

## Run it

From the project root, with MySQL running:

```bash
php backend/scripts/stripe_payout_demo.php
```

**First run** provisions a connected account (with a fake bank) for each
supplier. In test mode they're usually verified instantly. If Stripe still
wants a detail for an account, the script prints a **hosted onboarding link** —
open it, click through Stripe's **test** pages (use the autofill / "skip" test
options), then **run the script again** to complete the purchase.

When it finishes you'll see a summary like:

```
  Customer paid (platform) : MYR 1657.00
  Admin commission kept    : MYR 165.70
  Paid out to suppliers    : MYR 1491.30
```

---

## Verify the result

- **Stripe Dashboard → Connect → Accounts** — each supplier has a balance.
- **Stripe Dashboard → Payments** — the customer charge.
- **Admin commission report:** `GET /admin/reports/commission` (admin token).
- **Each supplier's sales report:** `GET /reports/sales` (that supplier's token).
- **Database:**
  ```sql
  SELECT * FROM supplier_payout WHERE orderId = 'ORDxxxx';
  ```

Run the script several times to accumulate more orders across the suppliers and
watch the reports grow.

---

## Notes & troubleshooting

- **Test only.** The script refuses any key that isn't `sk_test_…`.
- **Network.** It needs outbound access to `api.stripe.com`. If you're in a
  restricted environment, run it on your own machine.
- **Country/currency** are taken from your platform account automatically; the
  connected accounts and the charge use those.
- **Bank rejected?** If Stripe won't accept the built-in fake bank for your
  country, set `demo_bank` in `config.local.php` (see
  `config.local.example.php`) using a value from Stripe's *test bank account
  numbers* docs — or just finish that account via the onboarding link.
- **This is separate from the real supplier flow.** Real suppliers still
  onboard through the Express hosted flow on the Payouts page; this script is a
  self-contained tester that creates throwaway test suppliers/accounts.
