<?php
// Supplier order views. An order can contain items from several suppliers, so
// every query is scoped to the caller: a supplier only ever sees THEIR own line
// items and their own subtotal for an order — never another supplier's.

// How long a 'Placed' (unpaid) order may wait for payment before it is
// auto-cancelled (Shopee's "Pay within …" model). Stock is never decremented
// for unpaid orders, so cancelling is purely a status change.
const ORDER_PAYMENT_WINDOW_MINUTES = 60;

// How many days after delivery a customer may request a refund.
const REFUND_WINDOW_DAYS = 7;

// Order is awaiting payment and not yet handed to fulfilment.
function _orderHasActiveRefund(PDO $pdo, string $orderId): bool {
  $s = $pdo->prepare("SELECT 1 FROM refund WHERE orderId = :oid
                       AND refundStatus IN ('Pending','Approved','Completed') LIMIT 1");
  $s->execute(['oid' => $orderId]);
  return (bool) $s->fetch();
}

// Most recent delivery completion for an order, or null if not delivered.
function _orderDeliveredAt(PDO $pdo, string $orderId): ?string {
  $s = $pdo->prepare("SELECT MAX(deliveryDate) FROM delivery WHERE orderId = :oid");
  $s->execute(['oid' => $orderId]);
  $v = $s->fetchColumn();
  return $v ?: null;
}

// Cancel any 'Placed' orders left unpaid past the payment window. Pass a
// customerId to limit the sweep to one customer, or null to sweep all. Called
// lazily before listing orders and before any payment attempt, so no cron is
// strictly required (a scheduled run is still nice for housekeeping).
function cancelExpiredUnpaidOrders(PDO $pdo, ?string $customerId = null): int {
  // Find the expired unpaid orders first, so we can notify each buyer after
  // cancelling (a bulk UPDATE alone can't tell us which orders it touched).
  $find = "SELECT o.orderId FROM `order` o
            WHERE o.orderStatus = 'Placed'
              AND o.orderDate < (NOW() - INTERVAL " . ORDER_PAYMENT_WINDOW_MINUTES . " MINUTE)
              AND NOT EXISTS (
                    SELECT 1 FROM payment p
                     WHERE p.orderId = o.orderId AND p.paymentStatus = 'Successful')";
  if ($customerId !== null) $find .= " AND o.customerId = :cid";
  $sel = $pdo->prepare($find);
  $sel->execute($customerId !== null ? ['cid' => $customerId] : []);
  $orderIds = $sel->fetchAll(PDO::FETCH_COLUMN);
  if (!$orderIds) { return 0; }

  $upd = $pdo->prepare("UPDATE `order` SET orderStatus = 'Cancelled' WHERE orderId = :oid AND orderStatus = 'Placed'");
  $cancelled = 0;
  foreach ($orderIds as $oid) {
    $upd->execute(['oid' => $oid]);
    if ($upd->rowCount() > 0) {
      $cancelled++;
      if (function_exists('notifyOrderAutoCancelled')) {
        notifyOrderAutoCancelled($pdo, $oid);
      }
    }
  }
  return $cancelled;
}

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
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate, refundProof
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
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate, refundProof
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

// The 16 Malaysian states and federal territories (MY_STATES) are defined once
// in lib/address.php, which is required before every controller.

// Validate the structured address parts. Returns an error message string, or
// null when everything is valid.
function _validateAddressParts(array $a): ?string {
  if ($a['line1'] === '')                          return 'Address line 1 is required.';
  if (mb_strlen($a['line1']) > 255)                return 'Address line 1 is too long.';
  if (mb_strlen($a['line2']) > 255)                return 'Address line 2 is too long.';
  if (!preg_match('/^\d{5}$/', $a['postcode']))    return 'Postcode must be 5 digits.';
  if ($a['city'] === '')                           return 'City is required.';
  if (mb_strlen($a['city']) > 100)                 return 'City is too long.';
  if (!in_array($a['state'], MY_STATES, true))     return 'Please select a valid state.';
  return null;
}

// Build the combined single-line address string kept in the legacy column for
// all the display screens (admin, delivery, courier).
//   "12, Jalan SS2/24, Taman Bahagia, 47300 Petaling Jaya, Selangor"
function _formatAddress(array $a): string {
  $parts = [$a['line1']];
  if ($a['line2'] !== '') $parts[] = $a['line2'];
  $parts[] = trim($a['postcode'] . ' ' . $a['city']);
  $parts[] = $a['state'];
  return implode(', ', array_filter($parts, fn($p) => $p !== ''));
}

// POST /orders — turn the customer's cart into an order. Model A: the order is
// created as `Placed` and the cart is cleared, but STOCK IS NOT TOUCHED here —
// it's decremented atomically at payment success (see HANDOFF/NOTES). Body:
// the structured address { addressLine1, addressLine2?, postcode, city, state },
// or a legacy { deliveryAddress } string, or neither (falls back to the
// customer's saved address).
function handleCheckout(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body    = getJsonBody();

  // Structured address parts (the new client always sends these).
  $parts = [
    'line1'    => trim($body['addressLine1'] ?? ''),
    'line2'    => trim($body['addressLine2'] ?? ''),
    'postcode' => trim($body['postcode'] ?? ''),
    'city'     => trim($body['city'] ?? ''),
    'state'    => trim($body['state'] ?? ''),
  ];
  $hasStructured = $parts['line1'] !== '' || $parts['postcode'] !== ''
                   || $parts['city'] !== '' || $parts['state'] !== '';

  if ($hasStructured) {
    $err = _validateAddressParts($parts);
    if ($err !== null) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $err]);
    }
    $address = _formatAddress($parts);
  } else {
    // Legacy clients: a single combined string, or fall back to the saved one.
    $address = trim($body['deliveryAddress'] ?? '');
    if ($address === '') {
      $a = $pdo->prepare('SELECT shippingAddress FROM customer WHERE customerId = :cid');
      $a->execute(['cid' => $customerId]);
      $address = trim((string) ($a->fetchColumn() ?: ''));
    }
    if ($address === '') {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A delivery address is required.']);
    }
  }

  // Optional partial checkout: only the cart items the customer ticked. Absent
  // (or empty) → check out the whole cart (backward compatible).
  $selected = $body['selectedCartItemIds'] ?? null;
  $selectedIds = is_array($selected)
      ? array_values(array_filter(array_map(fn($x) => trim((string) $x), $selected)))
      : [];

  $cartId = getOrCreateCartId($pdo, $customerId);
  $sql =
    "SELECT ci.cartItemId, ci.cartItemQuantity AS qty, pv.productVariantId AS variantId, pv.size,
            pv.stockQuantity AS stock, p.productName, p.productPrice AS price, p.productStatus AS status
       FROM cart_item ci
       JOIN product_variant pv ON pv.productVariantId = ci.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE ci.cartId = :cid";
  $params = ['cid' => $cartId];
  if ($selectedIds) {
    $in = [];
    foreach ($selectedIds as $i => $id) { $k = ":ci$i"; $in[] = $k; $params[$k] = $id; }
    $sql .= ' AND ci.cartItemId IN (' . implode(',', $in) . ')';
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $items = $stmt->fetchAll();
  if (count($items) === 0) {
    sendJson(400, false, null, ['code' => 'EMPTY_CART', 'message' => 'No items selected for checkout.']);
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
      "INSERT INTO `order` (orderId, customerId, orderDate, orderStatus, orderTotalAmount,
                            orderDeliveryAddress, deliveryLine1, deliveryLine2,
                            deliveryPostcode, deliveryCity, deliveryState)
       VALUES (:id, :cid, NOW(), 'Placed', :total, :addr, :l1, :l2, :pc, :ct, :st)"
    )->execute([
      'id' => $orderId, 'cid' => $customerId, 'total' => $total, 'addr' => $address,
      'l1' => $hasStructured ? $parts['line1'] : null,
      'l2' => $hasStructured && $parts['line2'] !== '' ? $parts['line2'] : null,
      'pc' => $hasStructured ? $parts['postcode'] : null,
      'ct' => $hasStructured ? $parts['city'] : null,
      'st' => $hasStructured ? $parts['state'] : null,
    ]);

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

    // remove only the items that were ordered (others stay in the cart)
    $orderedIds = array_column($items, 'cartItemId');
    $delIn = [];
    $delParams = ['cid' => $cartId];
    foreach ($orderedIds as $i => $id) { $k = ":d$i"; $delIn[] = $k; $delParams[$k] = $id; }
    $pdo->prepare('DELETE FROM cart_item WHERE cartId = :cid AND cartItemId IN (' . implode(',', $delIn) . ')')
        ->execute($delParams);

    // Remember this delivery address as the customer's default so it pre-fills
    // their next checkout (matches Amazon/Shopee: last-used address is the default).
    if ($hasStructured) {
      $pdo->prepare(
        'UPDATE customer SET shippingAddress = :addr, addressLine1 = :l1, addressLine2 = :l2,
                             postcode = :pc, city = :ct, state = :st
           WHERE customerId = :cid'
      )->execute([
        'addr' => $address,
        'l1'   => $parts['line1'],
        'l2'   => $parts['line2'] !== '' ? $parts['line2'] : null,
        'pc'   => $parts['postcode'],
        'ct'   => $parts['city'],
        'st'   => $parts['state'],
        'cid'  => $customerId,
      ]);
    } else {
      $pdo->prepare('UPDATE customer SET shippingAddress = :addr WHERE customerId = :cid')
          ->execute(['addr' => $address, 'cid' => $customerId]);
    }

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
  cancelExpiredUnpaidOrders($pdo, $customerId); // tidy stale unpaid orders first

  // Optional status-group filter (matches the app's order tabs) + pagination.
  $groups = [
    'topay'     => ['Placed'],
    'paid'      => ['Paid', 'Processing', 'Shipped', 'OutForDelivery'],
    'completed' => ['Delivered', 'Completed'],
    'cancelled' => ['Cancelled'],
  ];
  $group = strtolower(trim($_GET['status'] ?? ''));
  $statuses = $groups[$group] ?? null;
  $page  = max(1, (int) ($_GET['page'] ?? 1));
  $limit = min(50, max(1, (int) ($_GET['limit'] ?? 15)));
  $offset = ($page - 1) * $limit;

  $where = 'o.customerId = :cid';
  $params = ['cid' => $customerId];
  if ($statuses !== null) {
    $in = [];
    foreach ($statuses as $i => $s) { $k = ":st$i"; $in[] = $k; $params[$k] = $s; }
    $where .= ' AND o.orderStatus IN (' . implode(',', $in) . ')';
  }

  // total (for the app to know whether more pages exist)
  $cnt = $pdo->prepare("SELECT COUNT(*) FROM `order` o WHERE $where");
  $cnt->execute($params);
  $total = (int) $cnt->fetchColumn();

  $stmt = $pdo->prepare(
    "SELECT o.orderId, o.orderDate, o.orderStatus, o.orderTotalAmount,
            (SELECT COUNT(*) FROM order_item oi WHERE oi.orderId = o.orderId) AS itemCount,
            pay.paymentStatus,
            CASE WHEN o.orderStatus = 'Placed'
                 THEN DATE_ADD(o.orderDate, INTERVAL " . ORDER_PAYMENT_WINDOW_MINUTES . " MINUTE)
                 ELSE NULL END AS payBy,
            -- seconds left to pay (relative → immune to client timezone/clock)
            CASE WHEN o.orderStatus = 'Placed'
                 THEN GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(),
                        DATE_ADD(o.orderDate, INTERVAL " . ORDER_PAYMENT_WINDOW_MINUTES . " MINUTE)))
                 ELSE NULL END AS payBySeconds,
            (SELECT d.deliveryStatus FROM delivery d WHERE d.orderId = o.orderId
               ORDER BY FIELD(d.deliveryStatus,'Pending','Assigned','PickedUp','OutForDelivery','Delivered','Failed')
               LIMIT 1) AS deliveryStatus,
            -- first item preview, so the list shows WHAT was ordered at a glance
            (SELECT p.productName FROM order_item oi
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p ON p.productId = pv.productId
              WHERE oi.orderId = o.orderId ORDER BY oi.orderItemId LIMIT 1) AS previewName,
            (SELECT p.productBrand FROM order_item oi
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p ON p.productId = pv.productId
              WHERE oi.orderId = o.orderId ORDER BY oi.orderItemId LIMIT 1) AS previewBrand,
            (SELECT (SELECT pi.productImageUrl FROM product_image pi
                       WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1)
               FROM order_item oi
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p ON p.productId = pv.productId
              WHERE oi.orderId = o.orderId ORDER BY oi.orderItemId LIMIT 1) AS previewImage
       FROM `order` o
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE $where
      ORDER BY o.orderDate DESC
      LIMIT :limit OFFSET :offset"
  );
  foreach ($params as $k => $v) { $stmt->bindValue($k, $v); }
  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
  $stmt->execute();
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['orderTotalAmount'] = (float) $r['orderTotalAmount'];
    $r['itemCount']        = (int) $r['itemCount'];
    $r['payBySeconds']     = $r['payBySeconds'] === null ? null : (int) $r['payBySeconds'];
  }
  unset($r);
  sendJson(200, true, ['orders' => $rows, 'page' => $page, 'limit' => $limit, 'total' => $total]);
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
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl,
            EXISTS (SELECT 1 FROM review r
                     WHERE r.productId = p.productId AND r.customerId = :cid) AS reviewed
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :oid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $orderId, 'cid' => $customerId]);
  $items = $it->fetchAll();
  foreach ($items as &$x) {
    $x['qty']       = (int) $x['qty'];
    $x['unitPrice'] = (float) $x['unitPrice'];
    $x['subtotal']  = (float) $x['subtotal'];
    $x['reviewed']  = (bool) $x['reviewed'];
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
    "SELECT refundId, refundReason, refundAmount, refundStatus, requestDate, refundProof
       FROM refund WHERE orderId = :oid ORDER BY requestDate DESC"
  );
  $rf->execute(['oid' => $orderId]);
  $refunds = $rf->fetchAll();
  foreach ($refunds as &$x) { $x['refundAmount'] = (float) $x['refundAmount']; }
  unset($x);
  $order['refunds'] = $refunds;

  // ── Action eligibility ───────────────────────────────────────────────────
  // Fulfilment is tracked on the parcels (deliveryStatus), not orderStatus
  // (which stays 'Paid'). So derive cancel/refund eligibility from the parcels.
  $hasActiveRefund = _orderHasActiveRefund($pdo, $orderId);
  $paid = $order['orderStatus'] === 'Paid';
  $dstat = array_column($order['deliveries'], 'deliveryStatus');
  $shippedStates = ['PickedUp', 'OutForDelivery', 'Delivered'];
  $anyShipped = count(array_intersect($dstat, $shippedStates)) > 0;
  $allDelivered = count($dstat) > 0
      && count(array_filter($dstat, fn($s) => $s === 'Delivered')) === count($dstat);

  // Cancel: paid order, nothing shipped yet, no refund in progress.
  $order['canCancel'] = $paid && !$anyShipped && !$hasActiveRefund;

  // Refund: paid, every parcel delivered, within the window, no active refund.
  $canRefund = false;
  if ($paid && $allDelivered && !$hasActiveRefund) {
    $ref = _orderDeliveredAt($pdo, $orderId) ?? $order['orderDate'];
    $canRefund = time() <= strtotime($ref) + REFUND_WINDOW_DAYS * 86400;
  }
  $order['canRefund'] = $canRefund;
  $order['refundWindowDays'] = REFUND_WINDOW_DAYS;

  // Review: only after every parcel is delivered (real-world — you rate what
  // you've actually received). The per-item 'reviewed' flag drives Rate vs Rated.
  $order['canReview'] = $allDelivered;

  sendJson(200, true, $order);
}

// POST /orders/{orderId}/cancel — customer cancels a paid order that hasn't
// shipped yet (Paid/Processing). Full refund: the payment is marked Refunded
// (which removes the supplier's earnings + platform commission) and stock is
// restored since nothing was shipped.
function handleCancelOrder(PDO $pdo, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $o = $pdo->prepare("SELECT orderStatus FROM `order` WHERE orderId = :oid AND customerId = :cid");
  $o->execute(['oid' => $orderId, 'cid' => $customerId]);
  $order = $o->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  if (!in_array($order['orderStatus'], ['Paid', 'Processing'], true)) {
    sendJson(409, false, null, ['code' => 'NOT_CANCELLABLE',
      'message' => 'This order can no longer be cancelled. If it has been delivered, request a refund instead.']);
  }
  if (_orderHasActiveRefund($pdo, $orderId)) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'A refund is already in progress for this order.']);
  }
  try {
    $pdo->beginTransaction();
    // restore stock for each line (items never shipped)
    $items = $pdo->prepare('SELECT productVariantId, orderQuantity FROM order_item WHERE orderId = :oid');
    $items->execute(['oid' => $orderId]);
    $inc = $pdo->prepare('UPDATE product_variant SET stockQuantity = stockQuantity + :q WHERE productVariantId = :v');
    foreach ($items->fetchAll() as $ln) {
      $inc->execute(['q' => (int) $ln['orderQuantity'], 'v' => $ln['productVariantId']]);
    }
    $pdo->prepare("UPDATE `order` SET orderStatus = 'Cancelled' WHERE orderId = :oid")
        ->execute(['oid' => $orderId]);
    $pdo->prepare("UPDATE payment SET paymentStatus = 'Refunded' WHERE orderId = :oid")
        ->execute(['oid' => $orderId]);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not cancel the order.']);
  }
  // tell the buyer their cancellation went through (best-effort, after commit)
  if (function_exists('notifyOrderStatusChange')) {
    notifyOrderStatusChange($pdo, $orderId, 'Cancelled');
  }
  sendJson(200, true, ['orderId' => $orderId, 'status' => 'Cancelled']);
}
