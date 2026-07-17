-- AR Try-On: store the Snapchat Camera Kit LENS ID for a product's 3D model.
--
-- Workflow: the supplier uploads a .glb (product_model.productModelUrl); an admin
-- builds a foot-tracking lens from it in Lens Studio, publishes it to the Camera
-- Kit lens group, and records the resulting lens ID here. When arLensId is set,
-- the customer app opens Camera Kit with this lens so the shoe tracks the foot.
-- The Camera Kit lens GROUP id is a single app-level constant (not per product),
-- so only the per-product lens id is stored.
ALTER TABLE product_model
  ADD COLUMN arLensId VARCHAR(64) NULL AFTER productModelUrl;
