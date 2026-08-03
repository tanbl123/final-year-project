-- Admin's decision note for a refund (the "why" shown to the customer).
-- Required by the app when rejecting; optional when approving.
ALTER TABLE refund
  ADD COLUMN adminNote VARCHAR(500) NULL AFTER refundProof;
