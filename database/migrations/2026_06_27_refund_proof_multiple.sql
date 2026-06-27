-- Support multiple refund evidence photos.
-- refundProof now holds either a single URL (legacy) or a JSON array of URLs,
-- so widen it from VARCHAR(255) to TEXT.
ALTER TABLE refund MODIFY refundProof TEXT NULL;
