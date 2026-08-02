-- One-time "set your password" token for admin-provisioned staff (AR Specialist).
--
-- The account is created with a random, unusable password; the staff member sets
-- their own via a one-time link emailed to them (no credential is ever emailed).
-- We store only the token's HASH plus an expiry; both are cleared once the
-- password is set. Kept on the user row (not password_reset) so this invite flow
-- is fully isolated from the forgot-password code flow.

ALTER TABLE `user`
  ADD COLUMN setPasswordToken   VARCHAR(255) NULL,
  ADD COLUMN setPasswordExpires DATETIME     NULL;
