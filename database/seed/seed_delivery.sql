-- ─────────────────────────────────────────────────────────────
-- ShoeAR — DELIVERY PERSONNEL (couriers) + sample deliveries.
-- Gives the admin "Deliveries" page something to dispatch, and provides
-- couriers for the auto-assign demo (see backend/lib/delivery.php and the
-- Stripe payout demo, which auto-assigns a courier on payment success).
--
-- Import order (phpMyAdmin → shoear database → Import):
--   1) schema.sql
--   2) seed.sql              (admin + SUP0001 + categories)
--   3) seed_sales.sql        (demo customer + products + paid orders)
--   4) seed_multi_supplier.sql  (SUP0002/3 — uses USR0004/USR0005)
--   5) seed_delivery.sql     (THIS FILE — couriers start at USR0006)
--
-- Every statement uses INSERT IGNORE so this file is safe to re-run.
-- All accounts share the demo password "password123" (bcrypt hash below).
-- ─────────────────────────────────────────────────────────────

-- ── Three Active couriers (USR0006–USR0008 → DEL0001–DEL0003) ──
INSERT IGNORE INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0006', 'rider_ali',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'ali.rider@shoear.com', 'Ali Rahman', '0181112222', 'DeliveryPersonnel', 'Active'),
  ('USR0007', 'rider_siti',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'siti.rider@shoear.com', 'Siti Nurhaliza', '0182223333', 'DeliveryPersonnel', 'Active'),
  ('USR0008', 'rider_chong',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'chong.rider@shoear.com', 'Chong Wei', '0183334444', 'DeliveryPersonnel', 'Active');

INSERT IGNORE INTO delivery_personnel (deliveryPersonnelId, userId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate)
VALUES
  ('DEL0001', 'USR0006', 'Motorcycle', 'Honda',   'EX5',    'VFV 1234'),
  ('DEL0002', 'USR0007', 'Motorcycle', 'Yamaha',  'LC135',  'WXY 5678'),
  ('DEL0003', 'USR0008', 'Car',        'Perodua', 'Bezza',  'BLM 9012');

-- ── Two fresh PAID orders to populate the dispatch page ──
-- These IDs sit after seed_sales.sql's ORD0001–ORD0005 / PAY0001–PAY0005.
-- The Stripe payout demo computes the next ORD id dynamically, so it will not
-- clash with these.
INSERT IGNORE INTO `order`
  (orderId, customerId, orderDate, orderStatus, orderTotalAmount, orderDeliveryAddress)
VALUES
  ('ORD0006', 'CUS0001', '2026-06-15 09:30:00', 'Paid',  459.00, '88 Jalan Beli, Petaling Jaya'),
  ('ORD0007', 'CUS0001', '2026-06-16 13:00:00', 'Paid',  529.00, '88 Jalan Beli, Petaling Jaya');

INSERT IGNORE INTO order_item
  (orderItemId, orderId, productVariantId, orderSize, orderQuantity, orderUnitPrice, orderSubtotal)
VALUES
  ('OIT0008', 'ORD0006', 'VAR0001', 'UK8', 1, 459.00, 459.00),
  ('OIT0009', 'ORD0007', 'VAR0003', 'UK9', 1, 529.00, 529.00);

INSERT IGNORE INTO payment
  (paymentId, orderId, transactionId, paymentMethod, paymentAmount, paymentDate, paymentStatus)
VALUES
  ('PAY0006', 'ORD0006', 'pi_demo_0006', 'Stripe', 459.00, '2026-06-15 09:31:00', 'Successful'),
  ('PAY0007', 'ORD0007', 'pi_demo_0007', 'Stripe', 529.00, '2026-06-16 13:01:00', 'Successful');

-- One delivery already in progress (gives DEL0001 a load of 1), and one left
-- UNASSIGNED so it shows up in the admin "needs assignment" queue. With this
-- state, the next auto-assign would pick DEL0002 or DEL0003 (load 0) over
-- DEL0001 (load 1) — demonstrating the load-based scoring.
-- Both seed orders are single-supplier (SUP0001), so each is one parcel.
INSERT IGNORE INTO delivery
  (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryStatus, estimatedDeliveryTime)
VALUES
  ('DLV0001', 'ORD0007', 'SUP0001', 'DEL0001', 'OutForDelivery', '2026-06-16 18:00:00'),
  ('DLV0002', 'ORD0006', 'SUP0001', NULL,      'Pending',        NULL);
