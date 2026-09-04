-- ─────────────────────────────────────────────────────────────
-- ShoeAR — MULTI-SUPPLIER demo catalog.
-- Adds two more suppliers (SUP0002, SUP0003) each with their own products,
-- so the Sales/Commission reports — and the Stripe payout demo — show money
-- split across SEVERAL suppliers, not just one.
--
-- Import order (phpMyAdmin → shoear database → Import):
--   1) schema.sql
--   2) seed.sql            (creates SUP0001 + admin + categories)
--   3) seed_sales.sql      (gives SUP0001 some products/sales — optional)
--   4) seed_multi_supplier.sql   (THIS FILE — adds SUP0002 + SUP0003)
--
-- Every statement uses INSERT IGNORE so this file is safe to re-run and does
-- not clash with rows that seed.sql / seed_sales.sql may already have created.
-- After this, run the payout demo:  php backend/scripts/stripe_payout_demo.php
-- ─────────────────────────────────────────────────────────────

-- Make sure an active commission rate exists (seed_sales.sql also adds this;
-- IGNORE keeps whichever is already there). 10% to the platform/admin.
INSERT IGNORE INTO commission (commissionId, adminId, commissionRateValue, effectiveDate, commissionStatus)
VALUES ('COM0001', 'ADM0001', 10.00, '2026-01-01 00:00:00', 'Active');

-- Make sure a demo customer exists to "buy" in the demo (seed_sales.sql also
-- creates this exact customer; IGNORE keeps it if already present).
INSERT IGNORE INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0003', 'democustomer',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'customer@shoear.com', 'Demo Customer', '0177778888', 'Customer', 'Active');

INSERT IGNORE INTO customer (customerId, userId, shippingAddress)
VALUES ('CUS0001', 'USR0003', '88 Jalan Beli, Petaling Jaya');

-- ── Supplier 2 ───────────────────────────────────────────────
INSERT IGNORE INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0004', 'supplier2',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'supplier2@shoear.com', 'Aiman Sports', '0192223333', 'Supplier', 'Active');

INSERT IGNORE INTO supplier
  (supplierId, userId, companyName, companyAddress, operationalAddress, businessRegNo, businessLicenseUrl, taxNumber)
VALUES
  ('SUP0002', 'USR0004', 'Aiman Sports Sdn Bhd', '45 Jalan Ampang, Kuala Lumpur',
   'Lot 7, Shah Alam Warehouse Park, Selangor',
   '202301000456', 'https://example.com/licenses/sup0002.pdf', 'W10-2222-33334444');

INSERT IGNORE INTO product
  (productId, supplierId, categoryId, productName, productBrand, productDescription, productPrice, productStatus, virtualTryOnEnable)
VALUES
  ('PRD0004', 'SUP0002', 'CAT0001', 'Ultraboost Light', 'Adidas', 'Responsive daily runner', 649.00, 'Approved', 1),
  ('PRD0005', 'SUP0002', 'CAT0004', 'Metcon 9',         'Nike',   'Cross-training shoe',     579.00, 'Approved', 0);

INSERT IGNORE INTO product_variant (productVariantId, productId, size, stockQuantity)
VALUES
  ('VAR0005', 'PRD0004', 'UK8', 18),
  ('VAR0006', 'PRD0004', 'UK9', 12),
  ('VAR0007', 'PRD0005', 'UK9', 16);

-- ── Supplier 3 ───────────────────────────────────────────────
INSERT IGNORE INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0005', 'supplier3',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'supplier3@shoear.com', 'Mei Footwear', '0184445555', 'Supplier', 'Active');

INSERT IGNORE INTO supplier
  (supplierId, userId, companyName, companyAddress, operationalAddress, businessRegNo, businessLicenseUrl, taxNumber)
VALUES
  ('SUP0003', 'USR0005', 'Mei Footwear Trading', '9 Jalan Bukit Bintang, Kuala Lumpur',
   '9 Jalan Bukit Bintang, Kuala Lumpur',
   '202301000789', 'https://example.com/licenses/sup0003.pdf', 'W10-5555-66667777');

INSERT IGNORE INTO product
  (productId, supplierId, categoryId, productName, productBrand, productDescription, productPrice, productStatus, virtualTryOnEnable)
VALUES
  ('PRD0006', 'SUP0003', 'CAT0003', 'Classic Leather', 'Reebok', 'Everyday lifestyle sneaker', 359.00, 'Approved', 1),
  ('PRD0007', 'SUP0003', 'CAT0005', 'Predator Elite',  'Adidas', 'Firm-ground football boot',  749.00, 'Approved', 0);

INSERT IGNORE INTO product_variant (productVariantId, productId, size, stockQuantity)
VALUES
  ('VAR0008', 'PRD0006', 'UK8', 22),
  ('VAR0009', 'PRD0006', 'UK10', 14),
  ('VAR0010', 'PRD0007', 'UK9', 9);
