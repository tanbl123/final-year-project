# Supplier Payout / Settlement — Implementation Plan

## Goal
Turn a supplier's "net earnings" from a *reported* figure into *settled money*: the
platform transfers each supplier their net via Stripe Connect, either on an admin
"Pay now" action or an automatic scheduled sweep, and only once the funds are safe
from refund.

Supplier Stripe onboarding already exists (`StripeController` →
`/supplier/stripe/onboard|dashboard|status`), the `supplier_payout` ledger table
already exists, and `CourierPayoutController` is a complete working template. So
most of this is adapting the courier flow to suppliers plus adding the hold rule.

## Core design decision — the "payable" rule
A supplier's share of an order becomes **payable** only when **all** hold:
1. That supplier's parcel for the order is **`Delivered`**.
2. The **refund window has closed** — `deliveryDate + REFUND_WINDOW_DAYS < now`
   (default 7 days). This is what removes the refund-clawback problem: we only ever
   pay out money that can no longer be refunded.
3. Payment is **`Successful`** (not fully `Refunded`); any partial refund is netted
   via `payment.refundedAmount`.
4. No existing **`Paid`** `supplier_payout` row for this `(supplierId, orderId)`.

Payable net per (supplier, order), using the same maths as the Sales report:
`net = (supplierGross − refundShare) − commission − SST − thatParcel'sDeliveryCost`
where `refundShare = refundedAmount × (supplierGross / orderItemsSubtotal)`.

A supplier's **balance** = the sum of payable nets. Because an already-shipped but
mostly-refunded order can net *negative* (delivery + refund exceed the sale), the
balance nets negatives against positives. Unpaid payable rows simply persist until a
payout stamps them, so a temporary negative naturally carries forward with no extra
ledger table — the unpaid payable set *is* the ledger for the common cases.

## Manual vs automatic
Both share one core function `payOutSupplierBalance(pdo, config, supplier, isAuto)`:
- **Manual** — admin clicks "Pay now" on the Supplier Payouts page (`isAuto = false`).
- **Automatic** — a monthly `sweepSupplierPayouts()` registered in `runAllSweeps()`
  pays every connected supplier their balance once per period (`isAuto = true`),
  gated by a `supplier_auto_payout` config flag.

## Phasing

### Phase 1 (this build) — data model + payable rule + manual "Pay now"
- **Data model:** add `paidAt` + `isAuto` to `supplier_payout`; relax the
  `netAmount >= 0` CHECK so a genuinely negative per-order net can be recorded
  (gross/commission stay `>= 0`). Migration + `schema.sql`.
- **Backend `SupplierPayoutController.php`:**
  - `supplierPayableRows(pdo, supplierId?)` — payable (supplier, order) rows + net.
  - `supplierBalance(pdo, supplierId)` — sum of payable nets + order count.
  - `payOutSupplierBalance(pdo, config, supplier, isAuto)` — one Stripe transfer of
    the balance, then a `supplier_payout` row per covered order (mirrors
    `payOutCourierBalance`, incl. the record-`Failed`-then-throw safety).
  - Handlers: `handleListSupplierBalances` (admin overview), `handlePaySupplier`
    (admin manual pay), `handleSupplierPayoutHistory`, `handleSupplierEarnings`
    (supplier's own balance + in-hold + history).
- **Routes:** `GET /supplier/earnings`, `GET /admin/supplier-payouts`,
  `GET /admin/suppliers/{id}/payouts`, `POST /admin/suppliers/{id}/payout`.
- **Frontend:** admin **Supplier Payouts** page (mirrors the courier one) + a
  supplier **Earnings** panel in the Profile payouts card.

### Phase 2 — automatic sweep + reminders
- `sweepSupplierPayouts()` in `runAllSweeps()` behind `supplier_auto_payout`.
- Email reminder for suppliers who haven't connected Stripe (suppliers have no
  in-app inbox on web, so this is email via `mail.php`).

### Phase 3 — hardening (optional / real-world)
- A formal `supplier_ledger` (signed entries) for standing negative balances when a
  supplier is refunded after payout and never sells again (collections).
- Stripe idempotency keys + row locking for concurrent-payout safety.
- Minimum-payout threshold (`supplier_min_payout`) to avoid tiny transfers.

## Edge cases
- Supplier not Stripe-connected → accrues, cannot be paid; admin sees the status.
- Stripe transfer succeeds but DB write fails → `Failed`-row-then-throw pattern.
- Multi-supplier order → per (supplier, order), so each supplier settles alone.
- Balance ≤ 0 → nothing paid, carries forward.

## Rollout
- Apply the migration; `schema.sql` already carries it for fresh installs.
- Ship with the auto sweep OFF; admins use manual "Pay now" until verified.
