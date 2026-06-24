-- Google Sign-In support for the customer mobile app.
-- 1. password becomes nullable  — Google-only accounts have no password hash.
-- 2. phoneNumber becomes nullable — collected lazily at first checkout for Google users.
-- 3. googleId added              — stores the Google `sub` claim; UNIQUE so one Google
--    account can only be linked to one ShoeAR account.

ALTER TABLE `user`
  MODIFY COLUMN password     VARCHAR(255) NULL    COMMENT 'NULL for Google Sign-In-only accounts',
  MODIFY COLUMN phoneNumber  VARCHAR(20)  NULL    COMMENT 'NULL for Google users until collected at checkout',
  ADD    COLUMN googleId     VARCHAR(255) NULL UNIQUE AFTER password
         COMMENT 'Google sub claim; NULL for email/password accounts';
