-- Track how much of a payment has been refunded so far, to support PARTIAL
-- refunds. A partial refund accumulates here while the payment stays
-- 'Successful'; only once refundedAmount reaches paymentAmount does the status
-- flip to 'Refunded' (a full refund). Reports use this to reverse commission/SST
-- on the refunded portion of an otherwise-successful sale.
ALTER TABLE payment
  ADD COLUMN refundedAmount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER paymentStatus;
