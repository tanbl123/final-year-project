-- Supplier payout scheduling + settlement support (Phase 1 of the supplier
-- payout build — see docs/supplier-payout-plan.md).
--
-- 1. Record whether a payout was a manual "Pay now" or an automatic sweep, and
--    when the transfer actually succeeded.
-- 2. Relax the netAmount >= 0 CHECK: once a parcel has shipped, a mostly-refunded
--    order can net negative for the supplier (delivery + refund exceed the sale).
--    We still record it truthfully; it nets against the supplier's other orders.
--
-- Written for MariaDB (XAMPP). IF [NOT] EXISTS makes it safe to re-run.
-- Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE supplier_payout
  ADD COLUMN IF NOT EXISTS isAuto TINYINT(1) NOT NULL DEFAULT 0 AFTER payoutStatus,
  ADD COLUMN IF NOT EXISTS paidAt DATETIME NULL AFTER isAuto;

-- MariaDB enforces named CHECK constraints. Drop the old amounts check (which
-- forbade a negative netAmount) and re-add it without that clause.
ALTER TABLE supplier_payout DROP CONSTRAINT IF EXISTS chk_payout_amounts;

ALTER TABLE supplier_payout
  ADD CONSTRAINT chk_payout_amounts CHECK (grossAmount >= 0 AND commissionAmount >= 0);
