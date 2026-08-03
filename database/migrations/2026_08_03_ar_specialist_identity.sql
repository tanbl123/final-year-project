-- Identity field for AR-specialist staff accounts, so an admin-provisioned
-- account clearly represents a real, accountable person: the IC/NRIC number.
-- (Phone is collected into the existing user.phoneNumber.)
--
-- Written for MariaDB (XAMPP); IF NOT EXISTS makes it safe to re-run.
-- Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE ar_specialist
  ADD COLUMN IF NOT EXISTS icNumber VARCHAR(20) NULL AFTER userId;
