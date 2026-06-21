-- ─────────────────────────────────────────────────────────────
-- ShoeAR — demo/seed data for testing.
-- Import AFTER schema.sql (phpMyAdmin → shoear database → Import).
--
-- Demo login (Supplier portal):
--   email:    supplier@shoear.com
--   password: password123
-- The password column stores a bcrypt HASH of "password123" (never plain text).
-- ─────────────────────────────────────────────────────────────

-- 1) A demo supplier account (status Active so it can log in immediately)
INSERT INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0001', 'demosupplier',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'supplier@shoear.com', 'Demo Supplier', '0123456789', 'Supplier', 'Active');

INSERT INTO supplier
  (supplierId, userId, companyName, companyAddress, operationalAddress,
   businessRegNo, businessLicenseUrl, taxNumber)
VALUES
  ('SUP0001', 'USR0001', 'Demo Shoe Co.', '12 Jalan Sukan, Kuala Lumpur',
   '12 Jalan Sukan, Kuala Lumpur',
   '202301000123', 'https://example.com/licenses/demo.pdf', 'W10-1234-56789012');

-- 2) An admin account (status Active). Password is also "password123".
--    Log in at the supplier portal with these credentials to reach the
--    admin approvals dashboard.
--      email:    admin@shoear.com
--      password: password123
INSERT INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0002', 'admin',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'admin@shoear.com', 'Administrator', '0100000000', 'Admin', 'Active');

INSERT INTO admin (adminId, userId)
VALUES ('ADM0001', 'USR0002');

-- 3) Categories for products
INSERT INTO category (categoryId, categoryName)
VALUES
  ('CAT0001', 'Running'),
  ('CAT0002', 'Basketball'),
  ('CAT0003', 'Lifestyle'),
  ('CAT0004', 'Training'),
  ('CAT0005', 'Football');
