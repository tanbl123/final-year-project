-- Record the EasyParcel label cost the platform paid when auto-booking a Standard
-- (3PL) parcel, so it can be recovered from the supplier's payout (net = gross −
-- commission − SST − shipping). 0 for parcels the supplier ships on their own
-- courier account (the platform pays nothing there).
ALTER TABLE delivery
  ADD COLUMN shippingCost DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER shipReminderSentAt;
