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
