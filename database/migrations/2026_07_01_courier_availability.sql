-- Courier online/offline (on-duty) availability.
-- Real delivery platforms (Grab, foodpanda, Lalamove) let couriers flip
-- themselves online when they want jobs and offline when they don't (asleep,
-- off-shift, weekend). Dispatch only considers ONLINE couriers, so working
-- hours are the courier's choice — the platform never hard-codes "no midnight"
-- or "no weekends". Orders with no online courier wait in the queue and are
-- auto-assigned by the re-dispatch sweep the moment one comes online.
--
-- Defaults to 1 (online) so existing approved couriers keep receiving orders;
-- they can toggle themselves offline from the app.
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE delivery_personnel
  ADD COLUMN isAvailable TINYINT(1) NOT NULL DEFAULT 1   -- 1 = online/on-duty, 0 = offline
  AFTER coverageZones;
