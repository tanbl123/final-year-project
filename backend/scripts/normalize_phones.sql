-- One-time migration: normalise existing phone numbers to E.164 (+60...).
-- Safe to run once after deploying the phone-normalisation change. Idempotent:
-- numbers already in +60... form are left untouched.
--
-- Run in phpMyAdmin (SQL tab) or:  mysql -u root shoear < normalize_phones.sql

-- 1) Strip spaces and dashes from any stored numbers.
UPDATE `user`
SET phoneNumber = REPLACE(REPLACE(phoneNumber, ' ', ''), '-', '')
WHERE phoneNumber IS NOT NULL AND phoneNumber <> '';

-- 2) Local format (0XX...) -> +60XX...  (drop the leading 0, add +60)
UPDATE `user`
SET phoneNumber = CONCAT('+60', SUBSTRING(phoneNumber, 2))
WHERE phoneNumber LIKE '0%';

-- 3) Bare international (60...) -> +60...  (add the leading +)
UPDATE `user`
SET phoneNumber = CONCAT('+', phoneNumber)
WHERE phoneNumber LIKE '60%';

-- Numbers already starting with +60 match none of the above and stay as-is.
