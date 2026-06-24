<?php
// Supplier order views. An order can contain items from several suppliers, so
// every query is scoped to the caller: a supplier only ever sees THEIR own line
// items and their own subtotal for an order — never another supplier's.

// GET /supplier/orders  — orders that contain at least one of this supplier's
// products. Optional ?status= filter. Returns one summary row per order with
// the supplier's item count and subtotal (their share only).
function handleListSupplierOrders(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $status     = trim($_GET['status'] ?? '');
  $allowed    = ['Placed', 'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed', 'Cancelled'];

  $where  = ['p.supplierId = :sid'];
  // separate placeholder for the correlated subquery (emulation is off, so a
  // named param can't be reused across the statement)
  $params = ['sid' => $supplierId, 'dsid' => $supplierId];
  if ($status !== '' && in_array($status, $allowed, true)) {
    $where[] = 'o.orderStatus = :st';
    $params['st'] = $status;
  }

  $sql =
    "SELECT o.orderId, o.orderDate, o.orderStatus,
            buyer.fullName AS customerName,
            COUNT(oi.orderItemId)  AS itemCount,
            SUM(oi.orderSubtotal)  AS supplierSubtotal,
            (SELECT d.deliveryStatus FROM delivery d
              WHERE d.orderId = o.orderId AND d.supplierId = :dsid LIMIT 1) AS myDeliveryStatus,
            (SELECT rf.refundStatus FROM refund rf
              WHERE rf.orderId = o.orderId ORDER BY rf.requestDate DESC LIMIT 1) AS refundStatus
       FROM `order` o
       JOIN order_item oi      ON oi.orderId = o.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
       JOIN customer c         ON c.customerId = o.customerId
       JOIN `user` buyer       ON buyer.userId = c.userId
      WHERE " . implode(' AND ', $where) . "
      GROUP BY o.orderId, o.orderDate, o.orderStatus, buyer.fullName
      ORDER BY o.orderDate DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['itemCount']        = (int) $r['itemCount'];
    $r['supplierSubtotal'] = (float) $r['supplierSubtotal'];
  }
  unset($r);
  sendJson(200, true, ['orders' => $rows]);
}

// GET /supplier/orders/{orderId}  — one order in detail, limited to this
// supplier's items. 404 if the order has none of their products.
function handleGetSupplierOrder(PDO $pdo, array $auth, string $orderId): void {
  $supplierId = requireSupplierId($pdo, $auth);

  // the supplier's line items for this order (price/size from the snapshots)
  $it = $pdo->prepare(
    "SELECT oi.orderItemId, p.productId, p.productName, p.productBrand AS brand,
            oi.orderSize AS size, oi.orderQuantity AS qty,
            oi.orderUnitPrice AS unitPrice, oi.orderSubtotal AS subtotal
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :oid AND p.supplierId = :sid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $orderId, 'sid' => $supplierId]);
  $items = $it->fetchAll();
  if (count($items) === 0) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  foreach ($items as &$x) {
    $x['qty']       = (int) $x['qty'];
    $x['unitPrice'] = (float) $x['unitPrice'];
    $x['subtotal']  = (float) $x['subtotal'];
  }
  unset($x);

  // order header + customer name + payment status. Per PDPA data minimisation,
  // the supplier does NOT receive the customer's delivery address or contact —
  // they don't deliver (delivery personnel do); they only fulfil their items.
  $h = $pdo->prepare(
    "SELECT o.orderId, o.orderDate, o.orderStatus,
            buyer.fullName AS customerName,
            pay.paymentStatus
       FROM `order` o
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE o.orderId = :oid"
  );
  $h->execute(['oid' => $orderId]);
  $order = $h->fetch();

  $order['items']            = $items;
  $order['itemCount']        = count($items);
  $order['supplierSubtotal'] = array_sum(array_column($items, 'subtotal'));

  // refund requests on this order (per-order, so the supplier sees them here).
  // No customer PII beyond the name already shown above.
  $rf = $pdo->prepare(
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate
       FROM refund WHERE orderId = :oid ORDER BY requestDate DESC"
  );
  $rf->execute(['oid' => $orderId]);
  $refunds = $rf->fetchAll();
  foreach ($refunds as &$x) { $x['refundAmount'] = (float) $x['refundAmount']; }
  unset($x);
  $order['refunds'] = $refunds;

  // the supplier's OWN parcel for this order (split fulfilment): its delivery
  // status, the courier collecting from them, and the ETA. Null until the order
  // is paid and dispatched. The customer's address/contact is still withheld.
  $dl = $pdo->prepare(
    "SELECT d.deliveryStatus, d.estimatedDeliveryTime, cu.fullName AS courierName
       FROM delivery d
       LEFT JOIN delivery_personnel dp ON dp.deliveryPersonnelId = d.deliveryPersonnelId
       LEFT JOIN `user` cu ON cu.userId = dp.userId
      WHERE d.orderId = :oid AND d.supplierId = :sid LIMIT 1"
  );
  $dl->execute(['oid' => $orderId, 'sid' => $supplierId]);
  $order['myDelivery'] = $dl->fetch() ?: null;

  sendJson(200, true, $order);
}

// ── Admin order oversight (sees everything — all suppliers, full detail) ──────

// GET /admin/orders — every order. Filters: ?status= ?search= (order id / customer).
function handleListAdminOrders(PDO $pdo): void {
  $status  = trim($_GET['status'] ?? '');
  $search  = trim($_GET['search'] ?? '');
  $allowed = ['Placed', 'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed', 'Cancelled'];

  $where  = [];
  $params = [];
  if (in_array($status, $allowed, true)) { $where[] = 'o.orderStatus = :st'; $params['st'] = $status; }
  if ($search !== '') {
    $where[] = '(o.orderId LIKE :q1 OR buyer.fullName LIKE :q2)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
  }

  $sql =
    "SELECT o.orderId, o.orderDate, o.orderStatus, o.orderTotalAmount,
            buyer.fullName AS customerName,
            (SELECT COUNT(*) FROM order_item oi WHERE oi.orderId = o.orderId) AS itemCount,
            pay.paymentStatus,
            (SELECT d.deliveryStatus FROM delivery d WHERE d.orderId = o.orderId
               ORDER BY FIELD(d.deliveryStatus,'Pending','Assigned','PickedUp','OutForDelivery','Delivered','Failed')
               LIMIT 1) AS deliveryStatus
       FROM `order` o
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
       LEFT JOIN payment pay ON pay.orderId = o.orderId";
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' ORDER BY o.orderDate DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['orderTotalAmount'] = (float) $r['orderTotalAmount'];
    $r['itemCount']        = (int) $r['itemCount'];
  }
  unset($r);
  sendJson(200, true, ['orders' => $rows]);
}

// GET /admin/orders/{orderId} — full detail: customer, payment, all items
// (every supplier), delivery and refunds. Admins see full info for dispute handling.
function handleGetAdminOrder(PDO $pdo, string $orderId): void {
  $h = $pdo->prepare(
    "SELECT o.orderId, o.orderDate, o.orderStatus, o.orderTotalAmount, o.orderDeliveryAddress,
            buyer.fullName AS customerName, buyer.email AS customerEmail, buyer.phoneNumber AS customerPhone,
            pay.paymentMethod, pay.transactionId, pay.paymentAmount, pay.paymentStatus, pay.paymentDate
       FROM `order` o
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE o.orderId = :oid"
  );
  $h->execute(['oid' => $orderId]);
  $order = $h->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  $order['orderTotalAmount'] = (float) $order['orderTotalAmount'];
  if ($order['paymentAmount'] !== null) { $order['paymentAmount'] = (float) $order['paymentAmount']; }

  $it = $pdo->prepare(
    "SELECT oi.orderItemId, p.productName, p.productBrand AS brand, s.companyName AS supplierName,
            oi.orderSize AS size, oi.orderQuantity AS qty,
            oi.orderUnitPrice AS unitPrice, oi.orderSubtotal AS subtotal
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
       JOIN supplier s         ON s.supplierId = p.supplierId
      WHERE oi.orderId = :oid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $orderId]);
  $items = $it->fetchAll();
  foreach ($items as &$x) {
    $x['qty']       = (int) $x['qty'];
    $x['unitPrice'] = (float) $x['unitPrice'];
    $x['subtotal']  = (float) $x['subtotal'];
  }
  unset($x);
  $order['items'] = $items;

  // one parcel per supplier — return them all so the admin sees each leg
  $dl = $pdo->prepare(
    "SELECT d.deliveryId, d.deliveryStatus, d.supplierId,
            s.companyName AS supplierName, s.operationalAddress AS pickupAddress,
            d.estimatedDeliveryTime, d.proofOfDelivery,
            cu.fullName AS courierName
       FROM delivery d
       JOIN supplier s ON s.supplierId = d.supplierId
       LEFT JOIN delivery_personnel dp ON dp.deliveryPersonnelId = d.deliveryPersonnelId
       LEFT JOIN `user` cu ON cu.userId = dp.userId
      WHERE d.orderId = :oid
      ORDER BY d.deliveryId"
  );
  $dl->execute(['oid' => $orderId]);
  $order['deliveries'] = $dl->fetchAll();

  $rf = $pdo->prepare(
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate
       FROM refund WHERE orderId = :oid ORDER BY requestDate DESC"
  );
  $rf->execute(['oid' => $orderId]);
  $refunds = $rf->fetchAll();
  foreach ($refunds as &$x) { $x['refundAmount'] = (float) $x['refundAmount']; }
  unset($x);
  $order['refunds'] = $refunds;

  sendJson(200, true, $order);
}

// ── Customer checkout + order tracking (Customer token) ──────────────────────

// POST /orders — turn the customer's cart into an order. Model A: the order is
// created as `Placed` and the cart is cleared, but STOCK IS NOT TOUCHED here —
// it's decremented atomically at payment success (see HANDOFF/NOTES). Body:
// { deliveryAddress? } (falls back to the customer's saved shipping address).
function handleCheckout(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body    = getJsonBody();
  $address = trim($body['deliveryAddress'] ?? '');
  if ($address === '') {
    $a = $pdo->prepare('SELECT shippingAddress FROM customer WHERE customerId = :cid');
    $a->execute(['cid' => $customerId]);
    $address = trim((string) ($a->fetchColumn() ?: ''));
  }
  if ($address === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A delivery address is required.']);
  }

  $cartId = getOrCreateCartId($pdo, $customerId);
  $stmt = $pdo->prepare(
    "SELECT ci.cartItemQuantity AS qty, pv.productVariantId AS variantId, pv.size,
            pv.stockQuantity AS stock, p.productName, p.productPrice AS price, p.productStatus AS status
       FROM cart_item ci
       JOIN product_variant pv ON pv.productVariantId = ci.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE ci.cartId = :cid"
  );
  $stmt->execute(['cid' => $cartId]);
  $items = $stmt->fetchAll();
  if (count($items) === 0) {
    sendJson(400, false, null, ['code' => 'EMPTY_CART', 'message' => 'Your cart is empty.']);
  }

  // sanity-check availability (the real guard is the atomic decrement at payment)
  foreach ($items as $it) {
    if ($it['status'] !== 'Approved') {
      sendJson(409, false, null, ['code' => 'UNAVAILABLE', 'message' => "\"{$it['productName']}\" is no longer available."]);
    }
    if ((int) $it['qty'] > (int) $it['stock']) {
      sendJson(409, false, null, ['code' => 'OUT_OF_STOCK', 'message' => "Only {$it['stock']} left of \"{$it['productName']}\" ({$it['size']})."]);
    }
  }

  $total = 0.0;
  foreach ($items as $it) { $total += round((float) $it['price'] * (int) $it['qty'], 2); }
  $total = round($total, 2);

  try {
    $pdo->beginTransaction();
    $orderId = nextId($pdo, 'order', 'orderId', 'ORD');
    $pdo->prepare(
      "INSERT INTO `order` (orderId, customerId, orderDate, orderStatus, orderTotalAmount, orderDeliveryAddress)
       VALUES (:id, :cid, NOW(), 'Placed', :total, :addr)"
    )->execute(['id' => $orderId, 'cid' => $customerId, 'total' => $total, 'addr' => $address]);

    foreach ($items as $it) {
      $sub  = round((float) $it['price'] * (int) $it['qty'], 2);
      $oiId = nextId($pdo, 'order_item', 'orderItemId', 'OIT');
      $pdo->prepare(
        "INSERT INTO order_item (orderItemId, orderId, productVariantId, orderSize, orderQuantity, orderUnitPrice, orderSubtotal)
         VALUES (:oi, :oid, :var, :size, :qty, :price, :sub)"
      )->execute([
        'oi' => $oiId, 'oid' => $orderId, 'var' => $it['variantId'], 'size' => $it['size'],
        'qty' => (int) $it['qty'], 'price' => (float) $it['price'], 'sub' => $sub,
      ]);
    }

    $pdo->prepare('DELETE FROM cart_item WHERE cartId = :cid')->execute(['cid' => $cartId]);

    // Remember this delivery address as the customer's default so it pre-fills
    // their next checkout (matches Amazon/Shopee: last-used address is the default).
    $pdo->prepare('UPDATE customer SET shippingAddress = :addr WHERE customerId = :cid')
        ->execute(['addr' => $address, 'cid' => $customerId]);

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not place the order.']);
  }

  sendJson(201, true, [
    'orderId'         => $orderId,
    'status'          => 'Placed',
    'total'           => $total,
    'deliveryAddress' => $address,
    'itemCount'       => count($items),
  ]);
}

// GET /orders — the customer's own orders (newest first).
function handleListCustomerOrders(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT o.orderId, o.orderDate, o.orderStatus, o.orderTotalAmount,
            (SELECT COUNT(*) FROM order_item oi WHERE oi.orderId = o.orderId) AS itemCount,
            pay.paymentStatus,
            (SELECT d.deliveryStatus FROM delivery d WHERE d.orderId = o.orderId
               ORDER BY FIELD(d.deliveryStatus,'Pending','Assigned','PickedUp','OutForDelivery','Delivered','Failed')
               LIMIT 1) AS deliveryStatus
       FROM `order` o
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE o.customerId = :cid
      ORDER BY o.orderDate DESC"
  );
  $stmt->execute(['cid' => $customerId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['orderTotalAmount'] = (float) $r['orderTotalAmount'];
    $r['itemCount']        = (int) $r['itemCount'];
  }
  unset($r);
  sendJson(200, true, ['orders' => $rows]);
}

// GET /orders/{orderId} — one of the customer's own orders, in full (items,
// payment, delivery tracking, refunds).
function handleGetCustomerOrder(PDO $pdo, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $h = $pdo->prepare(
    "SELECT o.orderId, o.orderDate, o.orderStatus, o.orderTotalAmount, o.orderDeliveryAddress,
            pay.paymentMethod, pay.paymentStatus, pay.paymentDate
       FROM `order` o
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE o.orderId = :oid AND o.customerId = :cid"
  );
  $h->execute(['oid' => $orderId, 'cid' => $customerId]);
  $order = $h->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  $order['orderTotalAmount'] = (float) $order['orderTotalAmount'];

  $it = $pdo->prepare(
    "SELECT oi.orderItemId, p.productId, p.productName, p.productBrand AS brand,
            oi.orderSize AS size, oi.orderQuantity AS qty,
            oi.orderUnitPrice AS unitPrice, oi.orderSubtotal AS subtotal,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :oid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $orderId]);
  $items = $it->fetchAll();
  foreach ($items as &$x) {
    $x['qty']       = (int) $x['qty'];
    $x['unitPrice'] = (float) $x['unitPrice'];
    $x['subtotal']  = (float) $x['subtotal'];
  }
  unset($x);
  $order['items'] = $items;

  // one parcel per supplier — each has its OWN status and OTP (the customer
  // confirms each parcel separately, mirroring Shopee/Lazada multi-seller orders)
  $dl = $pdo->prepare(
    "SELECT d.deliveryId, d.deliveryStatus, d.estimatedDeliveryTime, d.otpCode, d.proofOfDelivery,
            s.companyName AS supplierName
       FROM delivery d
       JOIN supplier s ON s.supplierId = d.supplierId
      WHERE d.orderId = :oid
      ORDER BY d.deliveryId"
  );
  $dl->execute(['oid' => $orderId]);
  $order['deliveries'] = $dl->fetchAll();

  $rf = $pdo->prepare(
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate
       FROM refund WHERE orderId = :oid ORDER BY requestDate DESC"
  );
  $rf->execute(['oid' => $orderId]);
  $refunds = $rf->fetchAll();
  foreach ($refunds as &$x) { $x['refundAmount'] = (float) $x['refundAmount']; }
  unset($x);
  $order['refunds'] = $refunds;

  sendJson(200, true, $order);
}
