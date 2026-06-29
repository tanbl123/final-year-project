-- Drop the unused "address line 2" columns.
--
-- The address forms (customer checkout + supplier pickup) keep the whole street
-- address in line 1, so line 2 was always empty. Remove it from all three places
-- it was added: the customer's saved address, the order's delivery address, and
-- the supplier's operational (pickup) address.
--
-- Safe: every line-2 column is always NULL and no code path reads it any more.
-- DROP COLUMN is irreversible — back up first if you want to keep the (empty) data.
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE customer  DROP COLUMN addressLine2;
ALTER TABLE `order`   DROP COLUMN deliveryLine2;
ALTER TABLE supplier  DROP COLUMN operationalLine2;
