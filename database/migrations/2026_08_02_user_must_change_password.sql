-- Force-change-on-first-login flag.
--
-- Used when an admin provisions an AR Specialist: the account's temporary
-- password is the specialist's own phone number (something they already know),
-- which the admin necessarily sees. To keep that safe, the account is flagged
-- mustChangePassword=1 — on first login the app forces them to set their own
-- password, after which the admin-known temporary value no longer works.
-- Cleared (set to 0) by /auth/change-password.

ALTER TABLE `user`
  ADD COLUMN mustChangePassword TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
