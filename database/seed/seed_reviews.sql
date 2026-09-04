-- ─────────────────────────────────────────────────────────────
-- ShoeAR — sample REVIEWS & RATINGS, so the supplier "Reviews" page and the
-- admin review-moderation page have data before the customer mobile app
-- (which creates reviews) is built.
--
-- Import AFTER schema.sql + seed.sql + seed_sales.sql + seed_multi_supplier.sql.
-- Safe to re-run (INSERT IGNORE). All accounts share the demo password.
-- ─────────────────────────────────────────────────────────────

-- Two more demo customers so products can have several reviews
-- (one review per customer per product is enforced by the schema).
INSERT IGNORE INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0009', 'customer2',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'customer2@shoear.com', 'Nadia Iskandar', '0166667777', 'Customer', 'Active'),
  ('USR0010', 'customer3',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'customer3@shoear.com', 'Daniel Lim', '0155558888', 'Customer', 'Active');

INSERT IGNORE INTO customer (customerId, userId, shippingAddress)
VALUES
  ('CUS0002', 'USR0009', '7 Jalan Kenanga, Shah Alam'),
  ('CUS0003', 'USR0010', '21 Lorong Maju, George Town');

-- Reviews across several products and suppliers, varied ratings.
-- One row is pre-Removed to demonstrate admin moderation.
INSERT IGNORE INTO review
  (reviewId, customerId, productId, ratingScore, reviewComment, reviewDate, reviewStatus)
VALUES
  ('REV0001', 'CUS0001', 'PRD0001', 5, 'Super comfortable for daily runs, great cushioning.', '2026-04-10 09:20:00', 'Published'),
  ('REV0002', 'CUS0002', 'PRD0001', 4, 'Good shoe but runs slightly small — size up.',        '2026-04-22 14:05:00', 'Published'),
  ('REV0003', 'CUS0003', 'PRD0001', 5, 'My new favourite trainer. Highly recommend.',          '2026-05-03 18:40:00', 'Published'),
  ('REV0004', 'CUS0001', 'PRD0002', 4, 'Excellent grip on the court.',                          '2026-04-25 20:10:00', 'Published'),
  ('REV0005', 'CUS0002', 'PRD0002', 5, 'Best basketball shoe I have owned.',                    '2026-05-12 11:30:00', 'Published'),
  ('REV0006', 'CUS0002', 'PRD0003', 3, 'Classic look but a little stiff at first.',             '2026-05-15 16:00:00', 'Published'),
  ('REV0007', 'CUS0003', 'PRD0004', 5, 'Very responsive, worth the price.',                     '2026-05-20 10:15:00', 'Published'),
  ('REV0008', 'CUS0001', 'PRD0006', 2, 'Not as durable as I expected for the price.',           '2026-06-01 13:25:00', 'Published'),
  ('REV0009', 'CUS0003', 'PRD0003', 1, 'Spam / inappropriate content example.',                 '2026-06-05 08:00:00', 'Removed');

-- Example supplier replies (needs the supplierReply columns — apply
-- migrations/2026_06_19_review_supplier_reply.sql first on existing databases).
UPDATE review SET supplierReply = 'Thank you for the kind words — glad you love them!',
                  supplierReplyDate = '2026-04-23 10:00:00'
 WHERE reviewId = 'REV0002';
UPDATE review SET supplierReply = 'Sorry to hear that. Please contact us so we can make it right.',
                  supplierReplyDate = '2026-06-02 09:30:00'
 WHERE reviewId = 'REV0008';
