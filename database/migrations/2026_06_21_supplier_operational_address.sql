-- Supplier operational (pickup) address.
-- Splits the single supplier address into two roles:
--   * companyAddress     — the registered business address (matches the SSM doc)
--   * operationalAddress — where couriers collect orders (ship-from / pickup)
-- For existing suppliers the two are the same, so backfill the new column from
-- companyAddress (the SME case: they ship from their registered address).

ALTER TABLE supplier
  ADD COLUMN operationalAddress VARCHAR(255) NOT NULL DEFAULT '' AFTER companyAddress;

-- Backfill: existing suppliers pick up from their registered address.
UPDATE supplier SET operationalAddress = companyAddress WHERE operationalAddress = '';

-- Drop the temporary default now that existing rows are populated (new rows must
-- supply it explicitly, matching schema.sql).
ALTER TABLE supplier
  ALTER COLUMN operationalAddress DROP DEFAULT;
