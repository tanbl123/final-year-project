-- Supplier company logo (square), admin-moderated. The supplier uploads a logo
-- that lands as 'Pending'; an admin approves it (→ companyPhotoUrl goes live) or
-- rejects it (with a note). Only an Approved logo is ever shown.
--
-- MariaDB (XAMPP); IF NOT EXISTS makes it safe to re-run.
-- Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE supplier
  ADD COLUMN IF NOT EXISTS companyPhotoUrl        VARCHAR(255) NULL AFTER displayNameUpdatedAt,
  ADD COLUMN IF NOT EXISTS companyPhotoPendingUrl VARCHAR(255) NULL AFTER companyPhotoUrl,
  ADD COLUMN IF NOT EXISTS companyPhotoStatus     ENUM('None','Pending','Approved','Rejected') NOT NULL DEFAULT 'None' AFTER companyPhotoPendingUrl,
  ADD COLUMN IF NOT EXISTS companyPhotoNote       VARCHAR(255) NULL AFTER companyPhotoStatus;
