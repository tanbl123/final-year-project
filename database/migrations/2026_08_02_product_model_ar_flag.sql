-- AR specialist "report model issue" flag. When a reviewer finds a 3D model that
-- can't be used for AR (e.g. lying on its side, upside-down), they flag it with a
-- reason instead of setting a lens. The flag + note surface on the admin's product
-- approvals page so the admin can reject the product with that reason; the supplier
-- then fixes the model and resubmits (which clears the flag and re-queues it).
ALTER TABLE product_model
  ADD COLUMN arFlaggedAt TIMESTAMP    NULL AFTER arReadyBy,
  ADD COLUMN arFlagNote  VARCHAR(255) NULL AFTER arFlaggedAt,
  ADD COLUMN arFlaggedBy VARCHAR(10)  NULL AFTER arFlagNote;
