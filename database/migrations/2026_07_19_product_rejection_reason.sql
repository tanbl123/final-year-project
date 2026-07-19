-- Store the admin's reason when a product is rejected, so the supplier can see
-- why (in-app + email) and fix it before resubmitting.
ALTER TABLE product
  ADD COLUMN rejectionReason VARCHAR(255) NULL AFTER productStatus;
