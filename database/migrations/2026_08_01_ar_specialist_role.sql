-- AR Specialist role — a new INTERNAL-STAFF role that prepares products for AR
-- (runs the auto-fit QC and records the Camera Kit lens id), separate from the
-- Admin who gives final listing approval. This keeps a clean separation of
-- duties: the person who PREPARES the AR asset is not the one who APPROVES the
-- listing. AR Specialists are provisioned by an admin (no public sign-up).
--
-- Three changes:
--   1. Add 'ArSpecialist' to the user.role enum.
--   2. A role-extension table `ar_specialist` (mirrors `admin`).
--   3. product_model.arReadyAt — the explicit "AR is prepared" marker, stamped
--      when the specialist saves a valid lens and cleared when the lens is
--      removed. The AR work queue lists try-on products where this is still NULL.

ALTER TABLE `user`
  MODIFY COLUMN role
    ENUM('Admin','Supplier','Customer','DeliveryPersonnel','ArSpecialist') NOT NULL;

CREATE TABLE ar_specialist (
    arSpecialistId VARCHAR(10) NOT NULL,                    -- ARS0001
    userId         VARCHAR(10) NOT NULL,
    PRIMARY KEY (arSpecialistId),
    UNIQUE KEY uq_ar_specialist_user (userId),
    CONSTRAINT fk_ar_specialist_user FOREIGN KEY (userId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE product_model
  ADD COLUMN arReadyAt TIMESTAMP NULL AFTER arLensUpdatedAt;

-- Backfill: any product that ALREADY has a lens was prepared before this role
-- existed, so mark it AR-ready — otherwise those (often already-approved)
-- products would wrongly reappear in the new AR work queue. Use the lens's own
-- save time where known, else now.
UPDATE product_model
   SET arReadyAt = COALESCE(arLensUpdatedAt, CURRENT_TIMESTAMP)
 WHERE arLensId IS NOT NULL AND arReadyAt IS NULL;
