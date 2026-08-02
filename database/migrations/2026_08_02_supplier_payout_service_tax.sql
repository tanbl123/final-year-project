-- SST service tax (Model A): record the 8% service tax charged on the platform's
-- COMMISSION in each supplier payout, so the split is auditable.
--
-- Malaysia's SST service tax (6% → 8% on 1 March 2024) applies to the platform's
-- taxable service to sellers — i.e. the commission — NOT to the buyer's goods.
-- The supplier bears it; the platform collects and remits it to the government.
-- netAmount is therefore gross - commissionAmount - serviceTaxAmount.
ALTER TABLE supplier_payout
  ADD COLUMN serviceTaxAmount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER commissionAmount;
