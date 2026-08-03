-- Supplier ledger (Phase 3 of the supplier payout build — see
-- docs/supplier-payout-plan.md). Signed adjustments to a supplier's payable
-- balance for cases the per-order payable set can't express — chiefly a refund
-- that lands on an order the supplier was ALREADY paid for (records a negative
-- 'RefundClawback' that nets against their next payout, or stands as owed).
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

CREATE TABLE IF NOT EXISTS supplier_ledger (
    ledgerId          VARCHAR(12)   NOT NULL,             -- SLG00000001
    supplierId        VARCHAR(10)   NOT NULL,
    orderId           VARCHAR(10)   NULL,
    entryType         ENUM('RefundClawback','Adjustment') NOT NULL,
    amount            DECIMAL(10,2) NOT NULL,             -- signed: negative reduces the payout
    note              VARCHAR(255)  NULL,
    settledByPayoutId VARCHAR(10)   NULL,
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ledgerId),
    KEY idx_ledger_supplier (supplierId),
    KEY idx_ledger_settled (settledByPayoutId),
    CONSTRAINT fk_ledger_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;
