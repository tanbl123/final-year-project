-- Supplier store display name (the customer-facing shop brand).
-- Real marketplaces (Shopee, Lazada, Etsy, Amazon) separate the customer-facing
-- STORE NAME from the verified LEGAL business name: the display name is
-- self-editable (throttled by a cooldown to deter impersonation) while the legal
-- company name stays locked behind admin re-verification. Customers browse by the
-- display name; invoices/admin use the legal companyName.
--
-- Backfilled to the current companyName so nothing changes visually until a
-- supplier chooses a different store name.
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE supplier
  ADD COLUMN displayName          VARCHAR(150) NOT NULL DEFAULT '' AFTER companyName,
  ADD COLUMN displayNameUpdatedAt DATETIME     NULL             AFTER displayName;

-- Backfill existing suppliers: store name starts as their legal company name.
UPDATE supplier SET displayName = companyName WHERE displayName = '';
