<?php
// Overview dashboards — the post-login landing for the admin (platform-wide)
// and the supplier (their own shop). Each returns KPI totals, "needs action"
// counts, recent orders and a 14-day sales trend in a single call, so the
// front-end home page is one fetch. All money figures come from PAID orders
// (a Successful payment), consistent with the reports.

const DASHBOARD_TREND_DAYS = 14;
const DASHBOARD_LOW_STOCK   = 5;   // a variant at/under this is "low stock"

// Daily gross (paid) for the last N days. Returns rows present in the data;
// the front-end fills any missing days with zero. $supplierId scopes to one shop.
function dashboardTrend(PDO $pdo, ?string $supplierId): array {
  $sql =
    "SELECT DATE(pay.paymentDate) AS day, COALESCE(SUM(oi.orderSubtotal), 0) AS gross
       FROM payment pay
       JOIN `order` o      ON o.orderId = pay.orderId
       JOIN order_item oi  ON oi.orderId = o.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p      ON p.productId = pv.productId
      WHERE pay.paymentStatus = 'Successful'
        AND pay.paymentDate >= (CURDATE() - INTERVAL " . (DASHBOARD_TREND_DAYS - 1) . " DAY)";
  $params = [];
  if ($supplierId !== null) { $sql .= ' AND p.supplierId = :sid'; $params['sid'] = $supplierId; }
  $sql .= ' GROUP BY DATE(pay.paymentDate) ORDER BY day';
  $st = $pdo->prepare($sql);
  $st->execute($params);
  $out = [];
  foreach ($st->fetchAll() as $r) {
    $out[] = ['date' => $r['day'], 'gross' => round((float) $r['gross'], 2)];
  }
  return $out;
}

// GET /admin/dashboard — platform overview.
function handleAdminDashboard(PDO $pdo): void {
  $rate = activeCommissionRate($pdo);

  // GMV + paid order count (gross = sum of line subtotals on paid orders)
  $g = $pdo->query(
    "SELECT COALESCE(SUM(oi.orderSubtotal), 0) AS gross, COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'"
  )->fetch();
  $gross = (float) $g['gross'];

  $suppliers = (int) $pdo->query("SELECT COUNT(*) FROM `user` WHERE role = 'Supplier' AND status = 'Active'")->fetchColumn();
  $couriers  = (int) $pdo->query("SELECT COUNT(*) FROM `user` WHERE role = 'DeliveryPersonnel' AND status = 'Active'")->fetchColumn();

  $recent = $pdo->query(
    "SELECT o.orderId, o.orderTotalAmount AS total, o.orderStatus AS status, o.orderDate AS date,
            u.fullName AS customerName
       FROM `order` o
       JOIN customer c ON c.customerId = o.customerId
       JOIN `user` u   ON u.userId = c.userId
      ORDER BY o.orderDate DESC LIMIT 5"
  )->fetchAll();
  foreach ($recent as &$r) { $r['total'] = (float) $r['total']; }
  unset($r);

  sendJson(200, true, [
    'kpis' => [
      'gmv'        => round($gross, 2),
      'orders'     => (int) $g['orders'],
      'commission' => round($gross * $rate / 100, 2),
      'suppliers'  => $suppliers,
      'couriers'   => $couriers,
    ],
    'actions'      => adminBadgeCounts($pdo),   // pending approval/ops queues
    'recentOrders' => $recent,
    'trend'        => dashboardTrend($pdo, null),
  ]);
}

// GET /supplier/dashboard — the signed-in supplier's own overview.
function handleSupplierDashboard(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $rate = activeCommissionRate($pdo);

  $g = $pdo->prepare(
    "SELECT COALESCE(SUM(oi.orderSubtotal), 0) AS gross,
            COALESCE(SUM(oi.orderQuantity), 0) AS units,
            COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p   ON p.productId = pv.productId
      WHERE p.supplierId = :sid"
  );
  $g->execute(['sid' => $supplierId]);
  $row = $g->fetch();
  $gross = (float) $row['gross'];
  $commission = round($gross * $rate / 100, 2);

  // needs-action counts
  $toShip = $pdo->prepare("SELECT COUNT(*) FROM delivery WHERE supplierId = :sid AND deliveryStatus IN ('Pending','Assigned')");
  $toShip->execute(['sid' => $supplierId]);
  $lowStock = $pdo->prepare(
    "SELECT COUNT(*) FROM product_variant pv
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = :sid AND p.productStatus = 'Approved' AND pv.stockQuantity <= " . DASHBOARD_LOW_STOCK
  );
  $lowStock->execute(['sid' => $supplierId]);
  $pending = $pdo->prepare("SELECT COUNT(*) FROM product WHERE supplierId = :sid AND productStatus = 'Pending'");
  $pending->execute(['sid' => $supplierId]);

  // recent orders that include this supplier's items (their subtotal share; no
  // customer PII — suppliers don't see buyer identity, PDPA)
  $recent = $pdo->prepare(
    "SELECT o.orderId, o.orderStatus AS status, o.orderDate AS date,
            SUM(oi.orderSubtotal) AS total
       FROM order_item oi
       JOIN `order` o ON o.orderId = oi.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = :sid
      GROUP BY o.orderId, o.orderStatus, o.orderDate
      ORDER BY o.orderDate DESC LIMIT 5"
  );
  $recent->execute(['sid' => $supplierId]);
  $recentRows = $recent->fetchAll();
  foreach ($recentRows as &$r) { $r['total'] = (float) $r['total']; }
  unset($r);

  sendJson(200, true, [
    'kpis' => [
      'grossSales'  => round($gross, 2),
      'netEarnings' => round($gross - $commission, 2),
      'orders'      => (int) $row['orders'],
      'unitsSold'   => (int) $row['units'],
    ],
    'actions' => [
      'ordersToShip'    => (int) $toShip->fetchColumn(),
      'lowStock'        => (int) $lowStock->fetchColumn(),
      'pendingProducts' => (int) $pending->fetchColumn(),
    ],
    'recentOrders' => $recentRows,
    'trend'        => dashboardTrend($pdo, $supplierId),
  ]);
}
