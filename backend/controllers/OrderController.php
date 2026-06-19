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
  $params = ['sid' => $supplierId];
  if ($status !== '' && in_array($status, $allowed, true)) {
    $where[] = 'o.orderStatus = :st';
    $params['st'] = $status;
  }

  $sql =
    "SELECT o.orderId, o.orderDate, o.orderStatus,
            buyer.fullName AS customerName,
            COUNT(oi.orderItemId)  AS itemCount,
            SUM(oi.orderSubtotal)  AS supplierSubtotal
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

  sendJson(200, true, $order);
}
