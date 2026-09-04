-- ─────────────────────────────────────────────────────────────
-- Add an ADMIN account to an EXISTING shoear database.
-- Use this if you already imported seed.sql before the admin row existed
-- (so you don't have to wipe your test data). Safe to run once.
--
--   Login:  admin@shoear.com  /  password123
--
-- It picks the next free USR / ADM ids automatically so it won't collide
-- with suppliers you've already registered.
-- ─────────────────────────────────────────────────────────────

SET @uid = (
  SELECT CONCAT('USR', LPAD(COALESCE(MAX(CAST(SUBSTRING(userId, 4) AS UNSIGNED)), 0) + 1, 4, '0'))
  FROM `user`
);

INSERT INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  (@uid, 'admin',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'admin@shoear.com', 'Administrator', '0100000000', 'Admin', 'Active');

SET @aid = (
  SELECT CONCAT('ADM', LPAD(COALESCE(MAX(CAST(SUBSTRING(adminId, 4) AS UNSIGNED)), 0) + 1, 4, '0'))
  FROM admin
);

INSERT INTO admin (adminId, userId) VALUES (@aid, @uid);
