<?php
// Sales & commission reporting. Data is aggregated from paid orders:
//   order_item → product_variant → product (→ supplier)
//   joined to a Successful payment.
// Commission is DERIVED from the active rate in the `commission` table
// (a rate config), not stored per order.

// The commission rate (%) currently in effect, or 0.0 if none configured.
function activeCommissionRate(PDO $pdo): float {
  $stmt = $pdo->query(
    "SELECT commissionRateValue FROM commission
      WHERE commissionStatus = 'Active' AND effectiveDate <= NOW()
      ORDER BY effectiveDate DESC LIMIT 1"
  );
  $rate = $stmt->fetchColumn();
  return $rate === false ? 0.0 : (float) $rate;
}

// Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD into inclusive datetime bounds, or
// [null, null] for an all-time report (no range given / invalid).
function reportRange(): array {
  $from = trim($_GET['from'] ?? '');
  $to   = trim($_GET['to'] ?? '');
  if ($from === '' || $to === '') return [null, null];
  $f = DateTime::createFromFormat('Y-m-d', $from);
  $t = DateTime::createFromFormat('Y-m-d', $to);
  if (!$f || !$t || $f > $t) return [null, null];
  return [$from . ' 00:00:00', $to . ' 23:59:59'];
}

// The equal-length window immediately before [$fromDt, $toDt], used for the
// "vs previous period" comparison.
function previousRange(string $fromDt, string $toDt): array {
  $fromTs = strtotime($fromDt);
  $len    = strtotime($toDt) - $fromTs;     // seconds in the current window
  $prevTo = $fromTs - 1;                     // 1s before the current window
  return [date('Y-m-d H:i:s', $prevTo - $len), date('Y-m-d H:i:s', $prevTo)];
}

// Total gross (paid orders) over an optional payment-date window. Pass a
// supplierId to scope to one supplier, or null for the whole platform.
function grossInWindow(PDO $pdo, ?string $supplierId, ?string $fromDt, ?string $toDt): float {
  $sql = "SELECT COALESCE(SUM(oi.orderSubtotal), 0)
            FROM order_item oi
            JOIN `order` o      ON o.orderId = oi.orderId
            JOIN payment pay    ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
            JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
            JOIN product p      ON p.productId = pv.productId";
  $where = [];
  $params = [];
  if ($supplierId !== null) { $where[] = 'p.supplierId = :sid'; $params['sid'] = $supplierId; }
  if ($fromDt !== null)     { $where[] = 'pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $st = $pdo->prepare($sql);
  $st->execute($params);
  return (float) $st->fetchColumn();
}

// Build the period block (echoed range + previous gross + growth %) that both
// reports return. growthPct is null when there's no range or no prior sales.
function periodBlock(PDO $pdo, ?string $supplierId, ?string $fromDt, ?string $toDt, float $currentGross): array {
  $block = [
    'from'         => $fromDt !== null ? substr($fromDt, 0, 10) : null,
    'to'           => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    'previousGross' => null,
    'growthPct'    => null,
  ];
  if ($fromDt === null) return $block;        // all-time → no comparison
  [$pf, $pt] = previousRange($fromDt, $toDt);
  $prev = grossInWindow($pdo, $supplierId, $pf, $pt);
  $block['previousGross'] = round($prev, 2);
  if ($prev > 0) {
    $block['growthPct'] = round(($currentGross - $prev) / $prev * 100, 1);
  }
  return $block;
}

// GET /reports/sales — the signed-in supplier's own sales summary + per-product
// breakdown (paid orders only). Commission is what the platform takes; net is
// what the supplier keeps.
function handleSupplierSalesReport(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $rate = activeCommissionRate($pdo);
  [$fromDt, $toDt] = reportRange();

  $sql =
    "SELECT p.productId, p.productName,
            SUM(oi.orderQuantity) AS units,
            SUM(oi.orderSubtotal) AS gross
       FROM order_item oi
       JOIN `order` o      ON o.orderId = oi.orderId
       JOIN payment pay    ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p      ON p.productId = pv.productId
      WHERE p.supplierId = :sid";
  $params = ['sid' => $supplierId];
  if ($fromDt !== null) { $sql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $sql .= ' GROUP BY p.productId, p.productName ORDER BY gross DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $gross = 0.0; $units = 0;
  $byProduct = [];
  foreach ($rows as $r) {
    $g = (float) $r['gross'];
    $gross += $g;
    $units += (int) $r['units'];
    $byProduct[] = [
      'productId'   => $r['productId'],
      'productName' => $r['productName'],
      'units'       => (int) $r['units'],
      'gross'       => round($g, 2),
    ];
  }
  $commission = round($gross * $rate / 100, 2);

  sendJson(200, true, [
    'commissionRate' => $rate,
    'summary' => [
      'grossSales'  => round($gross, 2),
      'commission'  => $commission,
      'netEarnings' => round($gross - $commission, 2),
      'unitsSold'   => $units,
      'products'    => count($byProduct),
    ],
    'byProduct' => $byProduct,
    'period' => periodBlock($pdo, $supplierId, $fromDt, $toDt, $gross),
  ]);
}

// Stock at or below this (but > 0) counts as "low stock" in the inventory report.
const REPORT_LOW_STOCK = 10;

// GET /reports/products — product performance: every approved product with its
// units sold + gross over the period (INCLUDING products with zero sales, so
// the supplier can spot non-moving "dead stock"). Ranked best → worst.
function handleSupplierProductReport(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  [$fromDt, $toDt] = reportRange();

  $win = '';
  $params = ['sid' => $supplierId];
  if ($fromDt !== null) {
    $win = ' AND pay.paymentDate BETWEEN :from AND :to';
    $params['from'] = $fromDt; $params['to'] = $toDt;
  }
  $sql =
    "SELECT p.productId, p.productName, p.productPrice,
            COALESCE(s.units, 0) AS units, COALESCE(s.gross, 0) AS gross
       FROM product p
       LEFT JOIN (
         SELECT pv.productId AS pid,
                SUM(oi.orderQuantity) AS units,
                SUM(oi.orderSubtotal) AS gross
           FROM order_item oi
           JOIN `order` o   ON o.orderId = oi.orderId
           JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
           JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
          WHERE 1 = 1{$win}
          GROUP BY pv.productId
       ) s ON s.pid = p.productId
      WHERE p.supplierId = :sid AND p.productStatus = 'Approved'
      ORDER BY units DESC, gross DESC, p.productName ASC";
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $totalUnits = 0; $totalGross = 0.0; $withSales = 0; $noSales = 0;
  $byProduct = [];
  foreach ($rows as $r) {
    $u = (int) $r['units']; $g = (float) $r['gross'];
    $totalUnits += $u; $totalGross += $g;
    if ($u > 0) { $withSales++; } else { $noSales++; }
    $byProduct[] = [
      'productId'   => $r['productId'],
      'productName' => $r['productName'],
      'price'       => round((float) $r['productPrice'], 2),
      'units'       => $u,
      'gross'       => round($g, 2),
    ];
  }

  sendJson(200, true, [
    'summary' => [
      'products'   => count($byProduct),
      'withSales'  => $withSales,
      'noSales'    => $noSales,
      'unitsSold'  => $totalUnits,
      'grossSales' => round($totalGross, 2),
    ],
    'byProduct' => $byProduct,   // already ranked best → worst
    'period' => periodBlock($pdo, $supplierId, $fromDt, $toDt, $totalGross),
  ]);
}

// GET /reports/inventory — current stock snapshot + valuation (no date range).
// Per product: total units on hand and stock value (units × price), flagging
// low-stock and out-of-stock. Complements the operational Inventory page with an
// exportable management/valuation view.
function handleSupplierInventoryReport(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $stmt = $pdo->prepare(
    "SELECT p.productId, p.productName, p.productPrice,
            COALESCE(SUM(pv.stockQuantity), 0) AS stock,
            COUNT(pv.productVariantId) AS variants
       FROM product p
       LEFT JOIN product_variant pv ON pv.productId = p.productId
      WHERE p.supplierId = :sid AND p.productStatus = 'Approved'
      GROUP BY p.productId, p.productName, p.productPrice
      ORDER BY stock ASC, p.productName ASC"
  );
  $stmt->execute(['sid' => $supplierId]);
  $rows = $stmt->fetchAll();

  $totalUnits = 0; $totalValue = 0.0; $low = 0; $out = 0;
  $products = [];
  foreach ($rows as $r) {
    $stock = (int) $r['stock'];
    $price = (float) $r['productPrice'];
    $value = $stock * $price;
    $totalUnits += $stock; $totalValue += $value;
    $status = 'ok';
    if ($stock === 0)                    { $out++; $status = 'out'; }
    elseif ($stock <= REPORT_LOW_STOCK)  { $low++; $status = 'low'; }
    $products[] = [
      'productId'   => $r['productId'],
      'productName' => $r['productName'],
      'variants'    => (int) $r['variants'],
      'stock'       => $stock,
      'price'       => round($price, 2),
      'value'       => round($value, 2),
      'status'      => $status,   // ok | low | out
    ];
  }

  sendJson(200, true, [
    'lowStockThreshold' => REPORT_LOW_STOCK,
    'summary' => [
      'products'   => count($products),
      'unitsOnHand' => $totalUnits,
      'stockValue' => round($totalValue, 2),
      'lowStock'   => $low,
      'outOfStock' => $out,
    ],
    'products' => $products,   // ordered lowest stock first (restock priority)
  ]);
}

// GET /reports/orders — order & fulfilment: this supplier's parcels (deliveries)
// broken down by status, plus the on-time delivery rate. Scoped by order date.
function handleSupplierFulfilmentReport(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  [$fromDt, $toDt] = reportRange();

  $sql =
    "SELECT d.deliveryStatus, d.deliveryMethod, d.deliveryDate, d.estimatedDeliveryTime
       FROM delivery d
       JOIN `order` o ON o.orderId = d.orderId
      WHERE d.supplierId = :sid";
  $params = ['sid' => $supplierId];
  if ($fromDt !== null) { $sql .= ' AND o.orderDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $statuses = ['Pending' => 0, 'Assigned' => 0, 'PickedUp' => 0, 'OutForDelivery' => 0, 'Delivered' => 0, 'Failed' => 0];
  $inHouse = 0; $standard = 0;
  $delivered = 0; $onTime = 0; $ratedForOnTime = 0;
  foreach ($rows as $r) {
    $s = $r['deliveryStatus'];
    if (isset($statuses[$s])) { $statuses[$s]++; }
    if ($r['deliveryMethod'] === 'InHouse') { $inHouse++; } else { $standard++; }
    if ($s === 'Delivered') {
      $delivered++;
      if (!empty($r['deliveryDate']) && !empty($r['estimatedDeliveryTime'])) {
        $ratedForOnTime++;
        if (strtotime($r['deliveryDate']) <= strtotime($r['estimatedDeliveryTime'])) { $onTime++; }
      }
    }
  }
  $total = count($rows);
  $onTimeRate = $ratedForOnTime > 0 ? round($onTime / $ratedForOnTime * 100, 1) : null;

  sendJson(200, true, [
    'summary' => [
      'totalDeliveries' => $total,
      'delivered'       => $delivered,
      'failed'          => $statuses['Failed'],
      'inProgress'      => $total - $delivered - $statuses['Failed'],
      'onTime'          => $onTime,
      'onTimeRate'      => $onTimeRate,   // % of delivered parcels on/before ETA (null if none rated)
      'inHouse'         => $inHouse,
      'standard'        => $standard,
    ],
    'byStatus' => $statuses,
    'period' => [
      'from' => $fromDt !== null ? substr($fromDt, 0, 10) : null,
      'to'   => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    ],
  ]);
}

// GET /reports/refunds — refunds raised on orders that contain this supplier's
// products, with totals and refund rate (refunds ÷ this supplier's paid orders).
function handleSupplierRefundReport(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  [$fromDt, $toDt] = reportRange();

  $sql =
    "SELECT DISTINCT r.refundId, r.orderId, r.refundReason, r.refundAmount, r.refundStatus, r.requestDate
       FROM refund r
       JOIN order_item oi ON oi.orderId = r.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = :sid";
  $params = ['sid' => $supplierId];
  if ($fromDt !== null) { $sql .= ' AND r.requestDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $sql .= ' ORDER BY r.requestDate DESC';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $byStatus = ['Pending' => 0, 'Approved' => 0, 'Rejected' => 0, 'Completed' => 0];
  $totalRefunded = 0.0;   // amount actually refunded (Approved/Completed)
  $refunds = [];
  foreach ($rows as $r) {
    $st = $r['refundStatus'];
    if (isset($byStatus[$st])) { $byStatus[$st]++; }
    $amt = (float) $r['refundAmount'];
    if ($st === 'Approved' || $st === 'Completed') { $totalRefunded += $amt; }
    $refunds[] = [
      'refundId'   => $r['refundId'],
      'orderId'    => $r['orderId'],
      'reason'     => $r['refundReason'],
      'amount'     => round($amt, 2),
      'status'     => $st,
      'requestDate' => substr((string) $r['requestDate'], 0, 10),
    ];
  }

  // paid orders for this supplier (for the refund rate), same window
  $paidSql =
    "SELECT COUNT(DISTINCT o.orderId)
       FROM `order` o
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN order_item oi ON oi.orderId = o.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = :sid";
  $paidParams = ['sid' => $supplierId];
  if ($fromDt !== null) { $paidSql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $paidParams['from'] = $fromDt; $paidParams['to'] = $toDt; }
  $paidStmt = $pdo->prepare($paidSql);
  $paidStmt->execute($paidParams);
  $paidOrders = (int) $paidStmt->fetchColumn();

  $refundRate = $paidOrders > 0 ? round(count($refunds) / $paidOrders * 100, 1) : null;

  sendJson(200, true, [
    'summary' => [
      'refunds'       => count($refunds),
      'totalRefunded' => round($totalRefunded, 2),
      'paidOrders'    => $paidOrders,
      'refundRate'    => $refundRate,   // % of paid orders that had a refund (null if no paid orders)
    ],
    'byStatus' => $byStatus,
    'refunds' => $refunds,
    'period' => [
      'from' => $fromDt !== null ? substr($fromDt, 0, 10) : null,
      'to'   => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    ],
  ]);
}

// GET /admin/reports/commission — platform commission across all suppliers
// (paid orders only), broken down per supplier.
function handleAdminCommissionReport(PDO $pdo): void {
  $rate = activeCommissionRate($pdo);
  [$fromDt, $toDt] = reportRange();

  $sql =
    "SELECT s.supplierId, s.companyName,
            SUM(oi.orderQuantity) AS units,
            SUM(oi.orderSubtotal) AS gross
       FROM order_item oi
       JOIN `order` o      ON o.orderId = oi.orderId
       JOIN payment pay    ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p      ON p.productId = pv.productId
       JOIN supplier s     ON s.supplierId = p.supplierId";
  $params = [];
  if ($fromDt !== null) { $sql .= ' WHERE pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $sql .= ' GROUP BY s.supplierId, s.companyName ORDER BY gross DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $totalGross = 0.0; $totalCommission = 0.0;
  $bySupplier = [];
  foreach ($rows as $r) {
    $g = (float) $r['gross'];
    $c = round($g * $rate / 100, 2);
    $totalGross += $g;
    $totalCommission += $c;
    $bySupplier[] = [
      'supplierId'  => $r['supplierId'],
      'companyName' => $r['companyName'],
      'units'       => (int) $r['units'],
      'gross'       => round($g, 2),
      'commission'  => $c,
    ];
  }

  sendJson(200, true, [
    'commissionRate' => $rate,
    'summary' => [
      'grossSales'      => round($totalGross, 2),
      'totalCommission' => round($totalCommission, 2),
      'suppliers'       => count($bySupplier),
    ],
    'bySupplier' => $bySupplier,
    'period' => periodBlock($pdo, null, $fromDt, $toDt, $totalGross),
  ]);
}
