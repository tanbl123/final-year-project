-- Richer courier KYC documents on delivery_personnel:
--   • IC front + back (icPhotoUrl already exists as front; add icPhotoBackUrl)
--   • Physical driving licence front + back (licensePhotoUrl = front; add back)
--   • Digital e-licence (MyJPJ) as an alternative to the physical card:
--     licenseIsDigital flag + eLicenseUrl (image/PDF).
--
-- MariaDB (XAMPP); IF NOT EXISTS makes it safe to re-run.
-- Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE delivery_personnel
  ADD COLUMN IF NOT EXISTS licensePhotoBackUrl VARCHAR(255) NULL      AFTER licensePhotoUrl,
  ADD COLUMN IF NOT EXISTS licenseIsDigital    TINYINT(1)   NOT NULL DEFAULT 0 AFTER licensePhotoBackUrl,
  ADD COLUMN IF NOT EXISTS eLicenseUrl         VARCHAR(255) NULL      AFTER licenseIsDigital,
  ADD COLUMN IF NOT EXISTS icPhotoBackUrl      VARCHAR(255) NULL      AFTER icPhotoUrl;
