-- Supplier payout scheduling + settlement support (Phase 1 of the supplier
-- payout build — see docs/supplier-payout-plan.md).
--
-- 1. Record whether a payout was a manual "Pay now" or an automatic sweep, and
--    when the transfer actually succeeded.
-- 2. Relax the netAmount >= 0 CHECK: once a parcel has shipped, a mostly-refunded
--    order can net negative for the supplier (delivery + refund exceed the sale).
--    We still record it truthfully; it nets against the supplier's other orders.
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE supplier_payout
  ADD COLUMN isAuto TINYINT(1) NOT NULL DEFAULT 0 AFTER payoutStatus,
  ADD COLUMN paidAt DATETIME NULL AFTER isAuto;

-- MySQL 8.0 enforces CHECKs (5.7 ignores them). Drop the old amounts check and
-- re-add it without the netAmount >= 0 clause. The DROP is wrapped so it doesn't
-- fail on installs where the constraint was never created.
SET @drop := IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payout'
             AND CONSTRAINT_NAME = 'chk_payout_amounts'),
  'ALTER TABLE supplier_payout DROP CHECK chk_payout_amounts',
  'DO 0');
PREPARE s FROM @drop; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE supplier_payout
  ADD CONSTRAINT chk_payout_amounts CHECK (grossAmount >= 0 AND commissionAmount >= 0);
