-- Supplier-declared metadata for a product's 3D model (the "submission spec").
-- These are the facts geometry can't reliably infer, so the supplier declares
-- them once at upload and the AR auto-fit treats them as authoritative:
--   shoeCount     1 = single shoe (mirrored to the other foot), 2 = a pair
--   modelSide     for a single shoe, which foot it is ('left'/'right')
--   modelLengthCm the real shoe length, for accurate AR scaling
ALTER TABLE product_model
  ADD COLUMN shoeCount     TINYINT      NULL AFTER productModelUrl,
  ADD COLUMN modelSide     VARCHAR(5)   NULL AFTER shoeCount,
  ADD COLUMN modelLengthCm DECIMAL(4,1) NULL AFTER modelSide;
