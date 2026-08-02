-- Track the last automated "ship this parcel" reminder sent to a supplier for a
-- Standard (3PL) delivery, so the reminder sweep can nudge overdue parcels and
-- re-arm at an interval without spamming (mirrors cart.cartReminderSentAt).
ALTER TABLE delivery
  ADD COLUMN shipReminderSentAt TIMESTAMP NULL AFTER proofOfDelivery;
