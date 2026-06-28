<?php
// Overview dashboards — the post-login landing for the admin (platform-wide)
// and the supplier (their own shop). Each returns KPI totals, "needs action"
// counts, recent orders and a sales trend in a single call, so the front-end
// home page is one fetch. All money figures come from PAID orders (a Successful
// payment), consistent with the reports.
//
// Both accept an optional ?from&to reporting period (reportRange() / previousRange()
// / grossInWindow() are shared with ReportController). KPIs are scoped to the
// period, with a "vs previous period" growth %; the trend spans the period
// (or the last 14 days when no period is given).

const DASHBOARD_TREND_DAYS = 14;
const DASHBOARD_LOW_STOCK   = 5;    // a variant at/under this is "low stock"
const DASHBOARD_TREND_CAP   = 366;  // safety cap on trend bars for huge ranges

// Daily gross (paid), zero-filled, for the selected window — or the last 14 days
// when no range is given. $supplierId scopes to one shop. Returns an ordered
// [{date, gross}] series the chart renders as-is.
function dashboardTrend(PDO $pdo, ?string $supplierId, ?string $fromDt, ?string $toDt): array {
  if ($fromDt === null) {
    $start = new DateTime('today');
    $start->modify('-' . (DASHBOARD_TREND_DAYS - 1) . ' days');
    $end = new DateTime('today');
  } else {
    $start = new DateTime(substr($fromDt, 0, 10));
    $end   = new DateTime(substr($toDt, 0, 10));
  }
  // keep the bar count sane for very long custom ranges
  $span = (int) $start->diff($end)->days;
  if ($span > DASHBOARD_TREND_CAP) {
    $start = (clone $end)->modify('-' . DASHBOARD_TREND_CAP . ' days');
  }

  $sql =
    "SELECT DATE(pay.paymentDate) AS day, COALESCE(SUM(oi.orderSubtotal), 0) AS gross
       FROM payment pay
       JOIN `order` o      ON o.orderId = pay.orderId
       JOIN order_item oi  ON oi.orderId = o.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p      ON p.productId = pv.productId
      WHERE pay.paymentStatus = 'Successful'
        AND DATE(pay.paymentDate) BETWEEN :s AND :e";
  $params = ['s' => $start->format('Y-m-d'), 'e' => $end->format('Y-m-d')];
  if ($supplierId !== null) { $sql .= ' AND p.supplierId = :sid'; $params['sid'] = $supplierId; }
  $sql .= ' GROUP BY DATE(pay.paymentDate)';
  $st = $pdo->prepare($sql);
  $st->execute($params);

  $map = [];
  foreach ($st->fetchAll() as $r) { $map[$r['day']] = (float) $r['gross']; }

  $out = [];
  $cur = clone $start;
  while ($cur <= $end) {
    $k = $cur->format('Y-m-d');
    $out[] = ['date' => $k, 'gross' => round($map[$k] ?? 0, 2)];
    $cur->modify('+1 day');
  }
  return $out;
}

// Period block (echoed range + growth % vs the equal-length prior window).
function dashboardPeriod(?string $fromDt, ?string $toDt, ?float $growthPct): array {
  return [
    'from'      => $fromDt !== null ? substr($fromDt, 0, 10) : null,
    'to'        => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    'growthPct' => $growthPct,
  ];
}

// growth % of $currentGross vs the equal-length window before [$fromDt,$toDt],
// or null (no range / no prior sales).
function dashboardGrowth(PDO $pdo, ?string $supplierId, ?string $fromDt, ?string $toDt, float $currentGross): ?float {
  if ($fromDt === null) return null;
  [$pf, $pt] = previousRange($fromDt, $toDt);
  $prev = grossInWindow($pdo, $supplierId, $pf, $pt);
  return $prev > 0 ? round(($currentGross - $prev) / $prev * 100, 1) : null;
}

// GET /admin/dashboard — platform overview.
function handleAdminDashboard(PDO $pdo): void {
  $rate = activeCommissionRate($pdo);
  [$fromDt, $toDt] = reportRange();

  // GMV + paid order count (gross = sum of line subtotals on paid orders)
  $sql =
    "SELECT COALESCE(SUM(oi.orderSubtotal), 0) AS gross, COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'";
  $params = [];
  if ($fromDt !== null) { $sql .= ' WHERE pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $g = $pdo->prepare($sql);
  $g->execute($params);
  $row = $g->fetch();
  $gross = (float) $row['gross'];

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
      'orders'     => (int) $row['orders'],
      'commission' => round($gross * $rate / 100, 2),
      'suppliers'  => $suppliers,
      'couriers'   => $couriers,
    ],
    'actions'      => adminBadgeCounts($pdo),   // pending approval/ops queues
    'recentOrders' => $recent,
    'trend'        => dashboardTrend($pdo, null, $fromDt, $toDt),
    'period'       => dashboardPeriod($fromDt, $toDt, dashboardGrowth($pdo, null, $fromDt, $toDt, $gross)),
  ]);
}

// GET /supplier/dashboard — the signed-in supplier's own overview.
function handleSupplierDashboard(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $rate = activeCommissionRate($pdo);
  [$fromDt, $toDt] = reportRange();

  $sql =
    "SELECT COALESCE(SUM(oi.orderSubtotal), 0) AS gross,
            COALESCE(SUM(oi.orderQuantity), 0) AS units,
            COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p   ON p.productId = pv.productId
      WHERE p.supplierId = :sid";
  $params = ['sid' => $supplierId];
  if ($fromDt !== null) { $sql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $g = $pdo->prepare($sql);
  $g->execute($params);
  $row = $g->fetch();
  $gross = (float) $row['gross'];
  $commission = round($gross * $rate / 100, 2);

  // needs-action counts (current state, not period-bound)
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
    'trend'        => dashboardTrend($pdo, $supplierId, $fromDt, $toDt),
    'period'       => dashboardPeriod($fromDt, $toDt, dashboardGrowth($pdo, $supplierId, $fromDt, $toDt, $gross)),
  ]);
}
