-- Couriers should start OFFLINE and go online themselves once their payout
-- account is set up, so they never receive orders by accident before they're
-- ready. Previously isAvailable defaulted to 1, which also bypassed the
-- "can't go online until payouts are enabled" gate for brand-new couriers.
--
-- Apply on your local XAMPP DB:  mysql -u root shoear < this file

-- New couriers default to offline.
ALTER TABLE delivery_personnel
  ALTER COLUMN isAvailable SET DEFAULT 0;

-- Take any courier who can't legitimately be online (payouts not enabled yet)
-- offline now, closing the old default. Couriers already set up and online are
-- left as-is so no active rider is knocked offline mid-shift.
UPDATE delivery_personnel SET isAvailable = 0 WHERE payoutsEnabled = 0;
