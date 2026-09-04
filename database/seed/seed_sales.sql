-- ─────────────────────────────────────────────────────────────
-- ShoeAR — sample SALES data, so the Sales/Commission reports have
-- something to show before the customer mobile app is wired up.
-- Import AFTER schema.sql + seed.sql.
--   (phpMyAdmin → shoear database → Import)
-- Everything here belongs to the demo supplier SUP0001.
-- ─────────────────────────────────────────────────────────────

-- Active commission rate (10%) configured by the demo admin.
INSERT INTO commission (commissionId, adminId, commissionRateValue, effectiveDate, commissionStatus)
VALUES ('COM0001', 'ADM0001', 10.00, '2026-01-01 00:00:00', 'Active');

-- A demo customer (password is "password123", same hash as the others).
INSERT INTO `user`
  (userId, username, password, email, fullName, phoneNumber, role, status)
VALUES
  ('USR0003', 'democustomer',
   '$2y$12$vmauRgZFXPo8McWGHLFdIOGkZiPPnRReu5ChzCouUQdVohlUAhghS',
   'customer@shoear.com', 'Demo Customer', '0177778888', 'Customer', 'Active');

INSERT INTO customer (customerId, userId, shippingAddress)
VALUES ('CUS0001', 'USR0003', '88 Jalan Beli, Petaling Jaya');

-- Three approved products for SUP0001.
INSERT INTO product
  (productId, supplierId, categoryId, productName, productBrand, productDescription, productPrice, productStatus, virtualTryOnEnable)
VALUES
  ('PRD0001', 'SUP0001', 'CAT0001', 'Air Zoom Pegasus 40', 'Nike', 'Everyday running trainer', 459.00, 'Approved', 0),
  ('PRD0002', 'SUP0001', 'CAT0002', 'LeBron Witness 8',     'Nike', 'Basketball performance shoe', 529.00, 'Approved', 0),
  ('PRD0003', 'SUP0001', 'CAT0003', 'Air Force 1',          'Nike', 'Lifestyle classic', 399.00, 'Approved', 0);

INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
VALUES
  ('VAR0001', 'PRD0001', 'UK8', 20),
  ('VAR0002', 'PRD0001', 'UK9', 15),
  ('VAR0003', 'PRD0002', 'UK9', 10),
  ('VAR0004', 'PRD0003', 'UK8', 25);

-- Five paid orders spread across Apr–Jun 2026.
INSERT INTO `order` (orderId, customerId, orderDate, orderStatus, orderTotalAmount, orderDeliveryAddress)
VALUES
  ('ORD0001', 'CUS0001', '2026-04-05 10:00:00', 'Completed',  918.00, '88 Jalan Beli, Petaling Jaya'),
  ('ORD0002', 'CUS0001', '2026-04-18 14:30:00', 'Completed',  928.00, '88 Jalan Beli, Petaling Jaya'),
  ('ORD0003', 'CUS0001', '2026-05-02 09:15:00', 'Completed',  459.00, '88 Jalan Beli, Petaling Jaya'),
  ('ORD0004', 'CUS0001', '2026-05-22 16:45:00', 'Completed', 1197.00, '88 Jalan Beli, Petaling Jaya'),
  ('ORD0005', 'CUS0001', '2026-06-10 11:20:00', 'Completed', 1517.00, '88 Jalan Beli, Petaling Jaya');

INSERT INTO order_item (orderItemId, orderId, productVariantId, orderSize, orderQuantity, orderUnitPrice, orderSubtotal)
VALUES
  ('OIT0001', 'ORD0001', 'VAR0001', 'UK8', 2, 459.00,  918.00),
  ('OIT0002', 'ORD0002', 'VAR0003', 'UK9', 1, 529.00,  529.00),
  ('OIT0003', 'ORD0002', 'VAR0004', 'UK8', 1, 399.00,  399.00),
  ('OIT0004', 'ORD0003', 'VAR0002', 'UK9', 1, 459.00,  459.00),
  ('OIT0005', 'ORD0004', 'VAR0004', 'UK8', 3, 399.00, 1197.00),
  ('OIT0006', 'ORD0005', 'VAR0001', 'UK8', 1, 459.00,  459.00),
  ('OIT0007', 'ORD0005', 'VAR0003', 'UK9', 2, 529.00, 1058.00);

INSERT INTO payment (paymentId, orderId, transactionId, paymentMethod, paymentAmount, paymentDate, paymentStatus)
VALUES
  ('PAY0001', 'ORD0001', 'pi_demo_0001', 'Stripe',  918.00, '2026-04-05 10:01:00', 'Successful'),
  ('PAY0002', 'ORD0002', 'pi_demo_0002', 'Stripe',  928.00, '2026-04-18 14:31:00', 'Successful'),
  ('PAY0003', 'ORD0003', 'pi_demo_0003', 'Stripe',  459.00, '2026-05-02 09:16:00', 'Successful'),
  ('PAY0004', 'ORD0004', 'pi_demo_0004', 'Stripe', 1197.00, '2026-05-22 16:46:00', 'Successful'),
  ('PAY0005', 'ORD0005', 'pi_demo_0005', 'Stripe', 1517.00, '2026-06-10 11:21:00', 'Successful');
