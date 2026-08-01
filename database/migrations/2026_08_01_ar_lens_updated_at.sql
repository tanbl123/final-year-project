-- AR Try-On: record WHEN the admin last saved a product's Camera Kit lens.
--
-- Camera Kit caches lens content on-device keyed by lens id, so re-publishing
-- NEW content under the SAME lens id would otherwise stay stale on phones that
-- already cached that id. We turn the admin's "save lens" action into a version
-- signal: this timestamp is bumped every time the lens is saved (even to the same
-- id). The customer app keys its cache-clear on (arLensId + arLensUpdatedAt), so
-- any save forces exactly one fresh fetch — while repeat try-ons stay fast.
ALTER TABLE product_model
  ADD COLUMN arLensUpdatedAt TIMESTAMP NULL AFTER arLensId;
