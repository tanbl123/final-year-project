-- Standing "auto-ship" preference: when on, the platform auto-books & ships every
-- new Standard (3PL) parcel for this supplier via EasyParcel (a background sweep),
-- so they don't have to book each order by hand.
ALTER TABLE supplier
  ADD COLUMN autoShipStandard TINYINT(1) NOT NULL DEFAULT 0 AFTER payoutsEnabled;
