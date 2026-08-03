-- A second deep-link target for notifications: a product (e.g. tapping a
-- "seller replied to your review" notification opens that product). Existing
-- orderId stays for order deep-links.
--
-- MariaDB (XAMPP). Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE notification
  ADD COLUMN IF NOT EXISTS productId VARCHAR(10) NULL AFTER orderId;
