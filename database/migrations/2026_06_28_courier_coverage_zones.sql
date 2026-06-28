-- Zone-based dispatch: a courier declares the states they deliver to (comma-
-- separated, e.g. 'Selangor,Kuala Lumpur'). Auto-assignment matches the order's
-- deliveryState against this list, then picks the least-loaded covering courier.
ALTER TABLE delivery_personnel
  ADD COLUMN coverageZones VARCHAR(255) NOT NULL DEFAULT '' AFTER termsAcceptedAt;
