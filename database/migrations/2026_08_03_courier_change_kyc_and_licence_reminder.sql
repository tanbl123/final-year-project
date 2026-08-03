-- Bring the courier vehicle/licence CHANGE REQUEST up to parity with the richer
-- registration KYC (IC front+back, and either a physical licence front+back or a
-- digital e-licence file), and add the bookkeeping columns the licence-expiry
-- reminder sweep uses to avoid re-notifying the same courier for the same stage.
--
-- Apply on your local XAMPP DB:  mysql -u root shoear < this file
-- (schema.sql already reflects these columns for a fresh install.)

-- 1) Change-request now carries the full doc set the courier can re-submit.
ALTER TABLE courier_change_request
  ADD COLUMN licensePhotoBackUrl VARCHAR(255) NULL AFTER licensePhotoUrl,
  ADD COLUMN licenseIsDigital    TINYINT(1)   NOT NULL DEFAULT 0 AFTER licensePhotoBackUrl,
  ADD COLUMN eLicenseUrl         VARCHAR(255) NULL AFTER licenseIsDigital,
  ADD COLUMN icPhotoUrl          VARCHAR(255) NULL AFTER eLicenseUrl,
  ADD COLUMN icPhotoBackUrl      VARCHAR(255) NULL AFTER icPhotoUrl;

-- 2) Licence-expiry reminder bookkeeping on the live courier row.
--    licenceReminderStage = the most-urgent threshold already notified for the
--    CURRENT expiry (30, 7, 1 days, or 0 = lapsed); licenceReminderFor = the
--    licenseExpiry value that stage was about, so renewing the licence (a new
--    expiry date) automatically re-arms the reminders.
ALTER TABLE delivery_personnel
  ADD COLUMN licenceReminderStage TINYINT NULL AFTER payoutsEnabled,
  ADD COLUMN licenceReminderFor   DATE    NULL AFTER licenceReminderStage;
