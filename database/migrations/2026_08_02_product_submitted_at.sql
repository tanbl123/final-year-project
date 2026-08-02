-- Product review clock: WHEN a product was (re)submitted for admin review.
--
-- A product enters review the instant it's created (status defaults to Pending).
-- If it is later Rejected and the supplier edits + resubmits, it returns to
-- Pending — a fresh submission. created_at can't capture that (it never changes
-- after INSERT), and updated_at is the wrong signal (it bumps on ANY edit, e.g.
-- a typo fix, which would wrongly restart the wait). So we keep a dedicated
-- timestamp that is stamped ONLY when the status transitions INTO Pending:
-- set to now() on insert (via the column default) and re-stamped by the resubmit
-- path in ProductController. The AR queue measures "waiting" from this column.
--
-- Note: no ON UPDATE clause — an ordinary edit must NOT move it.
ALTER TABLE product
  ADD COLUMN submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER updated_at;

-- Backfill existing rows: their submission time is their original creation time
-- (ADD COLUMN would otherwise set them all to the migration's run time).
UPDATE product SET submittedAt = created_at;
