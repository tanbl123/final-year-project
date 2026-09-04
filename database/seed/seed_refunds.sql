-- ─────────────────────────────────────────────────────────────
-- ShoeAR — sample REFUND requests, so the admin refund-processing page and the
-- supplier order/refund view have data before the customer mobile app (which
-- creates refund requests) is built.
--
-- Import AFTER schema.sql + seed.sql + seed_sales.sql (needs ORD000x + PAY000x).
-- Safe to re-run (INSERT IGNORE).
-- ─────────────────────────────────────────────────────────────

INSERT IGNORE INTO refund
  (refundId, orderId, customerId, refundReason, refundAmount, refundStatus, requestDate, refundProof)
VALUES
  ('REF0001', 'ORD0003', 'CUS0001', 'Wrong size delivered.',              459.00, 'Pending',   '2026-05-06 10:00:00', 'https://example.com/proof/ref0001.jpg'),
  ('REF0002', 'ORD0001', 'CUS0001', 'One shoe arrived defective.',        459.00, 'Approved',  '2026-04-12 09:30:00', 'https://example.com/proof/ref0002.jpg'),
  ('REF0003', 'ORD0002', 'CUS0001', 'Changed my mind about the order.',   529.00, 'Rejected',  '2026-04-20 16:45:00', NULL),
  ('REF0004', 'ORD0004', 'CUS0001', 'Item damaged on arrival.',           399.00, 'Completed', '2026-05-25 11:10:00', 'https://example.com/proof/ref0004.jpg');

-- A Completed refund means the money was returned — keep the payment consistent.
UPDATE payment SET paymentStatus = 'Refunded' WHERE orderId = 'ORD0004';
