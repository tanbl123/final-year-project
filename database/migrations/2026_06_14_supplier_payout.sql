-- Supplier payouts ledger (Stripe Connect separate charges & transfers).
-- The customer pays the platform once (one `payment` row). The platform keeps
-- the commission and sends each supplier their net as a Stripe Transfer. Each
-- transfer is recorded here — one row per supplier per order — so the
-- "each supplier received money" flow is verifiable in the database as well as
-- in the Stripe dashboard.
--
-- Apply to an existing database that was built before this table existed:
--   phpMyAdmin → shoear database → SQL → paste → Go

CREATE TABLE IF NOT EXISTS supplier_payout (
    payoutId         VARCHAR(10)   NOT NULL,             -- PYT0001
    supplierId       VARCHAR(10)   NOT NULL,
    orderId          VARCHAR(10)   NOT NULL,
    stripeTransferId VARCHAR(60)   NULL,                 -- tr_... returned by Stripe
    grossAmount      DECIMAL(10,2) NOT NULL,             -- supplier's share of the order
    commissionAmount DECIMAL(10,2) NOT NULL,             -- platform commission on that share
    netAmount        DECIMAL(10,2) NOT NULL,             -- amount transferred to the supplier
    currency         CHAR(3)       NOT NULL DEFAULT 'myr',
    payoutStatus     ENUM('Pending','Paid','Failed') NOT NULL DEFAULT 'Pending',
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payoutId),
    KEY idx_payout_supplier (supplierId),
    KEY idx_payout_order (orderId),
    CONSTRAINT fk_payout_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_payout_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_payout_amounts CHECK (grossAmount >= 0 AND commissionAmount >= 0 AND netAmount >= 0)
) ENGINE=InnoDB;
