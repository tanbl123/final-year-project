-- Supplier KYC / payout fields (Stage 1).
-- Adds business identity, tax and bank payout columns to the supplier table.
-- Existing rows get placeholder values so the NOT NULL columns can be added;
-- update them (or re-seed) as appropriate.

ALTER TABLE supplier
  ADD COLUMN businessRegNo      VARCHAR(50)  NOT NULL DEFAULT '' AFTER companyAddress,
  ADD COLUMN businessLicenseUrl VARCHAR(255) NOT NULL DEFAULT '' AFTER businessRegNo,
  ADD COLUMN taxNumber          VARCHAR(50)  NULL          AFTER businessLicenseUrl,
  ADD COLUMN bankName           VARCHAR(100) NOT NULL DEFAULT '' AFTER taxNumber,
  ADD COLUMN bankAccountName    VARCHAR(150) NOT NULL DEFAULT '' AFTER bankName,
  ADD COLUMN bankAccountNo      VARCHAR(34)  NOT NULL DEFAULT '' AFTER bankAccountName;

-- Drop the temporary defaults now that the columns exist (new rows must supply
-- these explicitly, matching schema.sql).
ALTER TABLE supplier
  ALTER COLUMN businessRegNo      DROP DEFAULT,
  ALTER COLUMN businessLicenseUrl DROP DEFAULT,
  ALTER COLUMN bankName           DROP DEFAULT,
  ALTER COLUMN bankAccountName    DROP DEFAULT,
  ALTER COLUMN bankAccountNo      DROP DEFAULT;
