-- Make the in-house courier fee admin-configurable (previously a fixed config /
-- env value, COURIER_FEE_PER_DELIVERY). One active fee at a time; changing it
-- keeps the old value as history (status Inactive) so past changes are auditable
-- — mirroring the commission-rate configuration. If no row exists, the backend
-- falls back to the config default, so this migration needs no seed row.
CREATE TABLE IF NOT EXISTS courier_fee (
    courierFeeId  VARCHAR(10)   NOT NULL,               -- CFE0001
    adminId       VARCHAR(10)   NOT NULL,
    feeValue      DECIMAL(10,2) NOT NULL,               -- RM per in-house delivery
    effectiveDate DATETIME      NOT NULL,
    feeStatus     ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    PRIMARY KEY (courierFeeId),
    KEY idx_courierfee_admin (adminId),
    CONSTRAINT fk_courierfee_admin FOREIGN KEY (adminId) REFERENCES admin(adminId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_courierfee_value CHECK (feeValue >= 0)
) ENGINE=InnoDB;
