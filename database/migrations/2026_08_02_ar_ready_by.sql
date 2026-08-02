-- Records WHICH staff member made a product AR-ready (set the Camera Kit lens),
-- for the AR Specialist's "Completed" history / audit trail. References
-- user.userId; NULL until the lens is set, cleared again if the lens is removed.
ALTER TABLE product_model
  ADD COLUMN arReadyBy VARCHAR(10) NULL;
