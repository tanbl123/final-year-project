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

// Malaysian SST service-tax rate (%) applied to the platform's COMMISSION — the
// platform's taxable service to sellers (Model A: the standard treatment; the
// buyer is never charged SST on goods). Service tax rose from 6% to 8% on
// 1 March 2024. The supplier bears it; the platform collects and remits it to
// the government, so it is a pass-through, NOT platform revenue. Kept as a
// single constant; move to a config table later if it needs history like the
// commission rate.
function serviceTaxRate(): float {
  return 8.0;
}

// SST on a given commission amount, rounded to sen.
function serviceTaxOn(float $commission): float {
  return round($commission * serviceTaxRate() / 100, 2);
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

// Optional ?supplierId=... filter for the admin reports (scope a platform report
// to one company). Returns the trimmed id, or null for "all companies".
function reportSupplierId(): ?string {
  $sid = trim($_GET['supplierId'] ?? '');
  return $sid === '' ? null : $sid;
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
  $serviceTax = serviceTaxOn($commission);   // SST 8% on the commission

  // distinct paid orders containing this supplier's products → average order value
  $oSql =
    "SELECT COUNT(DISTINCT o.orderId)
       FROM `order` o
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN order_item oi ON oi.orderId = o.orderId
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = :sid";
  $oParams = ['sid' => $supplierId];
  if ($fromDt !== null) { $oSql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $oParams['from'] = $fromDt; $oParams['to'] = $toDt; }
  $oStmt = $pdo->prepare($oSql); $oStmt->execute($oParams);
  $orders = (int) $oStmt->fetchColumn();

  // delivery cost the supplier bears, over the same paid window — the platform-paid
  // 3PL label (shippingCost) OR the in-house courier's fee (courierFee), whichever
  // applies per parcel. Deducted from net earnings alongside commission + SST.
  // We include 'Refunded' payments here (but not in the gross/commission queries
  // above): once a parcel has physically shipped, the delivery cost was really
  // incurred, so the supplier still bears it even if the sale is later refunded.
  // A pre-shipment cancel deletes its delivery rows, so it contributes nothing.
  $shSql =
    "SELECT COALESCE(SUM(d.shippingCost + d.courierFee), 0)
       FROM delivery d
       JOIN `order` o   ON o.orderId = d.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus IN ('Successful', 'Refunded')
      WHERE d.supplierId = :sid";
  $shParams = ['sid' => $supplierId];
  if ($fromDt !== null) { $shSql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $shParams['from'] = $fromDt; $shParams['to'] = $toDt; }
  $shStmt = $pdo->prepare($shSql); $shStmt->execute($shParams);
  $deliveryCost = round((float) $shStmt->fetchColumn(), 2);

  sendJson(200, true, [
    'commissionRate' => $rate,
    'serviceTaxRate' => serviceTaxRate(),
    'summary' => [
      'grossSales'    => round($gross, 2),
      'commission'    => $commission,
      'serviceTax'    => $serviceTax,
      'deliveryCost'  => $deliveryCost,
      'netEarnings'   => round($gross - $commission - $serviceTax - $deliveryCost, 2),
      'unitsSold'     => $units,
      'orders'        => $orders,
      'avgOrderValue' => $orders > 0 ? round($gross / $orders, 2) : null,
      'products'      => count($byProduct),
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
  // Per product: window sales (units/gross/orders) + current stock on hand +
  // published-review rating. Stock and rating are current snapshots (not
  // date-bound) — they describe the product, not the period.
  $sql =
    "SELECT p.productId, p.productName, p.productPrice,
            COALESCE(s.units, 0) AS units, COALESCE(s.gross, 0) AS gross,
            COALESCE(s.orders, 0) AS orders,
            COALESCE(st.stock, 0) AS stock,
            rv.avgRating AS avgRating, COALESCE(rv.reviewCount, 0) AS reviewCount
       FROM product p
       LEFT JOIN (
         SELECT pv.productId AS pid,
                SUM(oi.orderQuantity) AS units,
                SUM(oi.orderSubtotal) AS gross,
                COUNT(DISTINCT oi.orderId) AS orders
           FROM order_item oi
           JOIN `order` o   ON o.orderId = oi.orderId
           JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
           JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
          WHERE 1 = 1{$win}
          GROUP BY pv.productId
       ) s ON s.pid = p.productId
       LEFT JOIN (
         SELECT productId AS pid, SUM(stockQuantity) AS stock
           FROM product_variant GROUP BY productId
       ) st ON st.pid = p.productId
       LEFT JOIN (
         SELECT productId AS pid, AVG(ratingScore) AS avgRating, COUNT(*) AS reviewCount
           FROM review WHERE reviewStatus = 'Published' GROUP BY productId
       ) rv ON rv.pid = p.productId
      WHERE p.supplierId = :sid AND p.productStatus = 'Approved'
      ORDER BY units DESC, gross DESC, p.productName ASC";
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $totalUnits = 0; $totalGross = 0.0; $totalStock = 0; $withSales = 0; $noSales = 0;
  $byProduct = [];
  foreach ($rows as $r) {
    $u = (int) $r['units']; $g = (float) $r['gross']; $stock = (int) $r['stock'];
    $totalUnits += $u; $totalGross += $g; $totalStock += $stock;
    if ($u > 0) { $withSales++; } else { $noSales++; }
    $byProduct[] = [
      'productId'   => $r['productId'],
      'productName' => $r['productName'],
      'price'       => round((float) $r['productPrice'], 2),
      'units'       => $u,
      'gross'       => round($g, 2),
      'orders'      => (int) $r['orders'],
      // realised average selling price (null when nothing sold)
      'avgPrice'    => $u > 0 ? round($g / $u, 2) : null,
      'stock'       => $stock,
      // units sold / (units sold + stock on hand) — how much of the supply moved
      'sellThrough' => ($u + $stock) > 0 ? round($u / ($u + $stock) * 100, 1) : null,
      'avgRating'   => $r['avgRating'] !== null ? round((float) $r['avgRating'], 1) : null,
      'reviewCount' => (int) $r['reviewCount'],
      'sharePct'    => 0.0,     // % of total gross — filled below
      'abcGrade'    => null,    // A/B/C Pareto grade — filled below
    ];
  }

  // Share of gross + ABC (Pareto) grade, computed over products ranked by gross:
  // A = products making up the first 80% of gross, B = next 15%, C = last 5%.
  // Zero-sales products aren't graded (null).
  if ($totalGross > 0) {
    $order = array_keys($byProduct);
    usort($order, fn($a, $b) => $byProduct[$b]['gross'] <=> $byProduct[$a]['gross']);
    $cum = 0.0;
    foreach ($order as $i) {
      $g = $byProduct[$i]['gross'];
      $byProduct[$i]['sharePct'] = round($g / $totalGross * 100, 1);
      if ($g > 0) {
        $cum += $g;
        $cumPct = $cum / $totalGross * 100;
        $byProduct[$i]['abcGrade'] = $cumPct <= 80 ? 'A' : ($cumPct <= 95 ? 'B' : 'C');
      }
    }
  }

  // Distinct orders across all of this supplier's products (not summable per row).
  $oStmt = $pdo->prepare(
    "SELECT COUNT(DISTINCT o.orderId)
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p   ON p.productId = pv.productId
      WHERE p.supplierId = :sid AND p.productStatus = 'Approved'{$win}"
  );
  $oStmt->execute($params);
  $totalOrders = (int) $oStmt->fetchColumn();

  sendJson(200, true, [
    'summary' => [
      'products'    => count($byProduct),
      'withSales'   => $withSales,
      'noSales'     => $noSales,
      'unitsSold'   => $totalUnits,
      'orders'      => $totalOrders,
      'grossSales'  => round($totalGross, 2),
      'avgPrice'    => $totalUnits > 0 ? round($totalGross / $totalUnits, 2) : null,
      'stockOnHand' => $totalStock,
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
    "SELECT d.orderId, d.deliveryStatus, d.deliveryMethod, d.trackingCarrier, d.trackingNumber,
            d.shippingCost, d.courierFee, d.deliveryDate, d.estimatedDeliveryTime, o.orderDate
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
  $shipDaysSum = 0.0; $shipDaysN = 0;   // order → delivered elapsed time
  $channels = [];                       // fulfilment performance per channel (in-house / each 3PL carrier)
  $byOrder = [];                        // per-parcel delivery cost, so the total deduction is auditable
  $shippingTotal = 0.0; $courierTotal = 0.0;
  foreach ($rows as $r) {
    $s = $r['deliveryStatus'];
    if (isset($statuses[$s])) { $statuses[$s]++; }
    if ($r['deliveryMethod'] === 'InHouse') { $inHouse++; } else { $standard++; }

    // channel label: in-house, or the 3PL carrier name (fall back to "Standard (3PL)")
    $channel = $r['deliveryMethod'] === 'InHouse'
      ? 'In-house'
      : (!empty($r['trackingCarrier']) ? $r['trackingCarrier'] : 'Standard (3PL)');

    // per-order delivery cost line — only parcels that actually carry a cost, so
    // the supplier can see exactly which orders make up their total delivery
    // deduction. 3PL labels charge shippingCost; in-house charges courierFee.
    $shipCost = round((float) $r['shippingCost'], 2);
    $courFee  = round((float) $r['courierFee'], 2);
    $lineCost = round($shipCost + $courFee, 2);
    $shippingTotal += $shipCost;
    $courierTotal  += $courFee;
    if ($lineCost > 0) {
      $byOrder[] = [
        'orderId'      => (int) $r['orderId'],
        'channel'      => $channel,
        'method'       => $r['deliveryMethod'] === 'InHouse' ? 'In-house courier' : '3PL label',
        'trackingNumber' => $r['trackingNumber'] ?: null,
        'status'       => $s,
        'cost'         => $lineCost,
      ];
    }
    if (!isset($channels[$channel])) {
      $channels[$channel] = ['channel' => $channel, 'parcels' => 0, 'delivered' => 0, 'failed' => 0,
                             'rated' => 0, 'onTime' => 0, 'shipSum' => 0.0, 'shipN' => 0];
    }
    $channels[$channel]['parcels']++;
    if ($s === 'Failed') { $channels[$channel]['failed']++; }

    if ($s === 'Delivered') {
      $delivered++;
      $channels[$channel]['delivered']++;
      if (!empty($r['deliveryDate']) && !empty($r['estimatedDeliveryTime'])) {
        $ratedForOnTime++;
        $channels[$channel]['rated']++;
        if (strtotime($r['deliveryDate']) <= strtotime($r['estimatedDeliveryTime'])) {
          $onTime++;
          $channels[$channel]['onTime']++;
        }
      }
      if (!empty($r['deliveryDate']) && !empty($r['orderDate'])) {
        $elapsed = (strtotime($r['deliveryDate']) - strtotime($r['orderDate'])) / 86400;
        $shipDaysSum += $elapsed; $shipDaysN++;
        $channels[$channel]['shipSum'] += $elapsed; $channels[$channel]['shipN']++;
      }
    }
  }
  $total = count($rows);
  $onTimeRate = $ratedForOnTime > 0 ? round($onTime / $ratedForOnTime * 100, 1) : null;
  $avgDeliveryDays = $shipDaysN > 0 ? round($shipDaysSum / $shipDaysN, 1) : null;

  // finalise per-channel rates, drop internal accumulators, order by parcel volume
  $byChannel = [];
  foreach ($channels as $c) {
    $byChannel[] = [
      'channel'         => $c['channel'],
      'parcels'         => $c['parcels'],
      'delivered'       => $c['delivered'],
      'failed'          => $c['failed'],
      'onTimeRate'      => $c['rated'] > 0 ? round($c['onTime'] / $c['rated'] * 100, 1) : null,
      'avgDeliveryDays' => $c['shipN'] > 0 ? round($c['shipSum'] / $c['shipN'], 1) : null,
    ];
  }
  usort($byChannel, fn($a, $b) => $b['parcels'] <=> $a['parcels']);

  // biggest cost first, so the orders driving the total surface at the top
  usort($byOrder, fn($a, $b) => $b['cost'] <=> $a['cost']);
  $deliveryCost = round($shippingTotal + $courierTotal, 2);

  sendJson(200, true, [
    'summary' => [
      'totalDeliveries' => $total,
      'delivered'       => $delivered,
      'failed'          => $statuses['Failed'],
      'inProgress'      => $total - $delivered - $statuses['Failed'],
      'onTime'          => $onTime,
      'onTimeRate'      => $onTimeRate,   // % of delivered parcels on/before ETA (null if none rated)
      'avgDeliveryDays' => $avgDeliveryDays,   // avg days from order to delivered
      'inHouse'         => $inHouse,
      'standard'        => $standard,
      'deliveryCost'    => $deliveryCost,     // total delivery cost the supplier bears (3PL + in-house)
      'shippingCost'    => round($shippingTotal, 2),   // 3PL label portion
      'courierFee'      => round($courierTotal, 2),     // in-house courier portion
    ],
    'byStatus' => $statuses,
    'byChannel' => $byChannel,   // fulfilment performance per delivery channel
    'byOrder' => $byOrder,       // per-order delivery cost making up the total deduction
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
  $byReason = [];         // reason → { count, amount } for the "top reasons" breakdown
  foreach ($rows as $r) {
    $st = $r['refundStatus'];
    if (isset($byStatus[$st])) { $byStatus[$st]++; }
    $amt = (float) $r['refundAmount'];
    if ($st === 'Approved' || $st === 'Completed') { $totalRefunded += $amt; }
    $reason = ($r['refundReason'] !== null && $r['refundReason'] !== '') ? $r['refundReason'] : 'Unspecified';
    if (!isset($byReason[$reason])) { $byReason[$reason] = ['reason' => $reason, 'count' => 0, 'amount' => 0.0]; }
    $byReason[$reason]['count']++;
    $byReason[$reason]['amount'] += $amt;
    $refunds[] = [
      'refundId'   => $r['refundId'],
      'orderId'    => $r['orderId'],
      'reason'     => $r['refundReason'],
      'amount'     => round($amt, 2),
      'status'     => $st,
      'requestDate' => substr((string) $r['requestDate'], 0, 10),
    ];
  }
  // most common reasons first
  $byReason = array_values($byReason);
  usort($byReason, fn($a, $b) => $b['count'] <=> $a['count']);
  foreach ($byReason as &$br) { $br['amount'] = round($br['amount'], 2); }
  unset($br);

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

  // refund value as a % of this supplier's gross sales in the same window
  $gross = grossInWindow($pdo, $supplierId, $fromDt, $toDt);
  $refundValuePct = $gross > 0 ? round($totalRefunded / $gross * 100, 1) : null;

  sendJson(200, true, [
    'summary' => [
      'refunds'        => count($refunds),
      'totalRefunded'  => round($totalRefunded, 2),
      'paidOrders'     => $paidOrders,
      'refundRate'     => $refundRate,   // % of paid orders that had a refund (null if no paid orders)
      'grossSales'     => round($gross, 2),
      'refundValuePct' => $refundValuePct,   // refunded RM as % of gross sales
    ],
    'byStatus' => $byStatus,
    'byReason' => $byReason,   // [{ reason, count, amount }], most common first
    'refunds' => $refunds,
    'period' => [
      'from' => $fromDt !== null ? substr($fromDt, 0, 10) : null,
      'to'   => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    ],
  ]);
}

// GET /admin/reports/suppliers — supplier performance leaderboard: every active
// supplier with gross sales + units (paid, over the period), active approved
// product count, and average product rating. Ranked by gross sales.
function handleAdminSupplierPerformanceReport(PDO $pdo): void {
  [$fromDt, $toDt] = reportRange();
  $commRate = activeCommissionRate($pdo);   // for commission generated per supplier

  // base: all active suppliers
  $suppliers = $pdo->query(
    "SELECT s.supplierId, s.companyName
       FROM supplier s JOIN `user` u ON u.userId = s.userId
      WHERE u.status = 'Active'"
  )->fetchAll(PDO::FETCH_ASSOC);

  // sales (paid) per supplier over the period
  $salesSql =
    "SELECT p.supplierId AS sid, SUM(oi.orderQuantity) AS units, SUM(oi.orderSubtotal) AS gross,
            COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o   ON o.orderId = oi.orderId
       JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p   ON p.productId = pv.productId";
  $params = [];
  if ($fromDt !== null) { $salesSql .= ' WHERE pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  $salesSql .= ' GROUP BY p.supplierId';
  $st = $pdo->prepare($salesSql); $st->execute($params);
  $sales = [];
  foreach ($st->fetchAll() as $r) { $sales[$r['sid']] = ['units' => (int) $r['units'], 'gross' => (float) $r['gross'], 'orders' => (int) $r['orders']]; }

  // active product count per supplier
  $prod = [];
  foreach ($pdo->query("SELECT supplierId, COUNT(*) AS c FROM product WHERE productStatus = 'Approved' GROUP BY supplierId")->fetchAll() as $r) {
    $prod[$r['supplierId']] = (int) $r['c'];
  }
  // average rating per supplier (published reviews on their products)
  $rate = [];
  foreach ($pdo->query(
    "SELECT p.supplierId AS sid, AVG(r.ratingScore) AS avg, COUNT(*) AS n
       FROM review r JOIN product p ON p.productId = r.productId
      WHERE r.reviewStatus = 'Published'
      GROUP BY p.supplierId")->fetchAll() as $r) {
    $rate[$r['sid']] = ['avg' => round((float) $r['avg'], 2), 'n' => (int) $r['n']];
  }

  $bySupplier = []; $totalGross = 0.0; $totalUnits = 0; $totalCommission = 0.0;
  foreach ($suppliers as $s) {
    $sid = $s['supplierId'];
    $g = $sales[$sid]['gross'] ?? 0.0; $u = $sales[$sid]['units'] ?? 0; $o = $sales[$sid]['orders'] ?? 0;
    $comm = round($g * $commRate / 100, 2);
    $totalGross += $g; $totalUnits += $u; $totalCommission += $comm;
    $bySupplier[] = [
      'supplierId'  => $sid,
      'companyName' => $s['companyName'],
      'units'       => $u,
      'orders'      => $o,
      'gross'       => round($g, 2),
      'commission'  => $comm,                                  // commission this supplier generated
      'avgOrderValue' => $o > 0 ? round($g / $o, 2) : null,    // AOV
      'products'    => $prod[$sid] ?? 0,
      'avgRating'   => $rate[$sid]['avg'] ?? null,
      'reviews'     => $rate[$sid]['n'] ?? 0,
      'sharePct'    => 0.0,    // % of platform GMV — filled below
      'abcGrade'    => null,   // A/B/C Pareto grade — filled below
    ];
  }
  usort($bySupplier, fn($a, $b) => $b['gross'] <=> $a['gross']);

  // contribution share + ABC (Pareto) grade over the gross ranking (same as the
  // product report): A = suppliers making the first 80% of GMV, B = next 15%, C = rest.
  if ($totalGross > 0) {
    $cum = 0.0;
    foreach ($bySupplier as $i => $s) {
      $g = $s['gross'];
      $bySupplier[$i]['sharePct'] = round($g / $totalGross * 100, 1);
      if ($g > 0) {
        $cum += $g;
        $cumPct = $cum / $totalGross * 100;
        $bySupplier[$i]['abcGrade'] = $cumPct <= 80 ? 'A' : ($cumPct <= 95 ? 'B' : 'C');
      }
    }
  }

  sendJson(200, true, [
    'commissionRate' => $commRate,
    'summary' => [
      'suppliers'       => count($bySupplier),
      'grossSales'      => round($totalGross, 2),
      'unitsSold'       => $totalUnits,
      'totalCommission' => round($totalCommission, 2),
    ],
    'bySupplier' => $bySupplier,
    'period' => periodBlock($pdo, null, $fromDt, $toDt, $totalGross),
  ]);
}

// GET /admin/reports/orders — platform-wide orders by status + overall on-time
// delivery rate across all couriers. Scoped by order date.
function handleAdminOrderReport(PDO $pdo): void {
  [$fromDt, $toDt] = reportRange();
  $supplierId = reportSupplierId();   // null → all companies

  if ($supplierId !== null) {
    // scope to orders that contain this supplier's products; the value shown is
    // this supplier's merchandise subtotal (not the whole multi-supplier order).
    $sql = "SELECT o.orderStatus,
                   COUNT(DISTINCT o.orderId) AS n,
                   COALESCE(SUM(oi.orderSubtotal), 0) AS amt
              FROM `order` o
              JOIN order_item oi ON oi.orderId = o.orderId
              JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
              JOIN product p ON p.productId = pv.productId
             WHERE p.supplierId = :sid";
    $params = ['sid' => $supplierId];
    if ($fromDt !== null) { $sql .= ' AND o.orderDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
    $sql .= ' GROUP BY o.orderStatus';
  } else {
    $sql = "SELECT orderStatus, COUNT(*) AS n, COALESCE(SUM(orderTotalAmount),0) AS amt FROM `order`";
    $params = [];
    if ($fromDt !== null) { $sql .= ' WHERE orderDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
    $sql .= ' GROUP BY orderStatus';
  }
  $st = $pdo->prepare($sql); $st->execute($params);

  $byStatus = ['Placed'=>0,'Paid'=>0,'Processing'=>0,'Shipped'=>0,'OutForDelivery'=>0,'Delivered'=>0,'Completed'=>0,'Cancelled'=>0];
  $totalOrders = 0; $totalValue = 0.0;
  foreach ($st->fetchAll() as $r) {
    if (isset($byStatus[$r['orderStatus']])) { $byStatus[$r['orderStatus']] = (int) $r['n']; }
    $totalOrders += (int) $r['n']; $totalValue += (float) $r['amt'];
  }

  // on-time delivery — platform-wide, or this supplier's own parcels
  $dSql = "SELECT d.deliveryStatus, d.deliveryDate, d.estimatedDeliveryTime, o.orderDate
             FROM delivery d JOIN `order` o ON o.orderId = d.orderId";
  $dWhere = []; $dParams = [];
  if ($supplierId !== null) { $dWhere[] = 'd.supplierId = :sid'; $dParams['sid'] = $supplierId; }
  if ($fromDt !== null)     { $dWhere[] = 'o.orderDate BETWEEN :from AND :to'; $dParams['from'] = $fromDt; $dParams['to'] = $toDt; }
  if ($dWhere) { $dSql .= ' WHERE ' . implode(' AND ', $dWhere); }
  $dst = $pdo->prepare($dSql); $dst->execute($dParams);
  $delivered = 0; $onTime = 0; $rated = 0; $shipDaysSum = 0.0; $shipDaysN = 0;
  foreach ($dst->fetchAll() as $r) {
    if ($r['deliveryStatus'] === 'Delivered') {
      $delivered++;
      if (!empty($r['deliveryDate']) && !empty($r['estimatedDeliveryTime'])) {
        $rated++;
        if (strtotime($r['deliveryDate']) <= strtotime($r['estimatedDeliveryTime'])) { $onTime++; }
      }
      if (!empty($r['deliveryDate']) && !empty($r['orderDate'])) {
        $shipDaysSum += (strtotime($r['deliveryDate']) - strtotime($r['orderDate'])) / 86400;
        $shipDaysN++;
      }
    }
  }

  // ── per-supplier fulfilment breakdown ──────────────────────────────────
  // order-level counts (orders + cancelled) per supplier
  $ocSql = "SELECT p.supplierId AS sid, s.companyName,
                   COUNT(DISTINCT o.orderId) AS orders,
                   COUNT(DISTINCT CASE WHEN o.orderStatus = 'Cancelled' THEN o.orderId END) AS cancelled
              FROM order_item oi
              JOIN `order` o ON o.orderId = oi.orderId
              JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
              JOIN product p ON p.productId = pv.productId
              JOIN supplier s ON s.supplierId = p.supplierId";
  $ocWhere = []; $ocParams = [];
  if ($supplierId !== null) { $ocWhere[] = 'p.supplierId = :sid'; $ocParams['sid'] = $supplierId; }
  if ($fromDt !== null)     { $ocWhere[] = 'o.orderDate BETWEEN :from AND :to'; $ocParams['from'] = $fromDt; $ocParams['to'] = $toDt; }
  if ($ocWhere) { $ocSql .= ' WHERE ' . implode(' AND ', $ocWhere); }
  $ocSql .= ' GROUP BY p.supplierId, s.companyName';
  $ocStmt = $pdo->prepare($ocSql); $ocStmt->execute($ocParams);

  $bySupplier = [];
  foreach ($ocStmt->fetchAll() as $r) {
    $o = (int) $r['orders']; $c = (int) $r['cancelled'];
    $bySupplier[$r['sid']] = [
      'supplierId'       => $r['sid'],
      'companyName'      => $r['companyName'],
      'orders'           => $o,
      'cancelled'        => $c,
      'cancellationRate' => $o > 0 ? round($c / $o * 100, 1) : null,
      'delivered'        => 0,
      'failed'           => 0,
      'onTimeRate'       => null,
      'avgDeliveryDays'  => null,
    ];
  }

  // delivery-level metrics per supplier (delivered/failed/on-time/ship time)
  $dmSql = "SELECT d.supplierId AS sid,
                   SUM(d.deliveryStatus = 'Delivered') AS delivered,
                   SUM(d.deliveryStatus = 'Failed') AS failed,
                   SUM(d.deliveryStatus = 'Delivered' AND d.deliveryDate IS NOT NULL AND d.estimatedDeliveryTime IS NOT NULL) AS rated,
                   SUM(d.deliveryStatus = 'Delivered' AND d.deliveryDate IS NOT NULL AND d.estimatedDeliveryTime IS NOT NULL AND d.deliveryDate <= d.estimatedDeliveryTime) AS onTime,
                   SUM(CASE WHEN d.deliveryStatus = 'Delivered' AND d.deliveryDate IS NOT NULL THEN TIMESTAMPDIFF(HOUR, o.orderDate, d.deliveryDate) END) AS shipHours,
                   SUM(CASE WHEN d.deliveryStatus = 'Delivered' AND d.deliveryDate IS NOT NULL THEN 1 ELSE 0 END) AS shipN
              FROM delivery d JOIN `order` o ON o.orderId = d.orderId";
  $dmWhere = []; $dmParams = [];
  if ($supplierId !== null) { $dmWhere[] = 'd.supplierId = :sid'; $dmParams['sid'] = $supplierId; }
  if ($fromDt !== null)     { $dmWhere[] = 'o.orderDate BETWEEN :from AND :to'; $dmParams['from'] = $fromDt; $dmParams['to'] = $toDt; }
  if ($dmWhere) { $dmSql .= ' WHERE ' . implode(' AND ', $dmWhere); }
  $dmSql .= ' GROUP BY d.supplierId';
  $dmStmt = $pdo->prepare($dmSql); $dmStmt->execute($dmParams);
  foreach ($dmStmt->fetchAll() as $r) {
    if (!isset($bySupplier[$r['sid']])) { continue; }
    $rated = (int) $r['rated']; $shipN = (int) $r['shipN'];
    $bySupplier[$r['sid']]['delivered']       = (int) $r['delivered'];
    $bySupplier[$r['sid']]['failed']          = (int) $r['failed'];
    $bySupplier[$r['sid']]['onTimeRate']      = $rated > 0 ? round($r['onTime'] / $rated * 100, 1) : null;
    $bySupplier[$r['sid']]['avgDeliveryDays'] = $shipN > 0 ? round(($r['shipHours'] / 24) / $shipN, 1) : null;
  }
  $bySupplier = array_values($bySupplier);
  usort($bySupplier, fn($a, $b) => $b['orders'] <=> $a['orders']);

  sendJson(200, true, [
    'summary' => [
      'totalOrders'     => $totalOrders,
      'totalValue'      => round($totalValue, 2),
      'cancelled'       => $byStatus['Cancelled'],
      'cancellationRate' => $totalOrders > 0 ? round($byStatus['Cancelled'] / $totalOrders * 100, 1) : null,
      'delivered'       => $delivered,
      'onTimeRate'      => $rated > 0 ? round($onTime / $rated * 100, 1) : null,
      'avgDeliveryDays' => $shipDaysN > 0 ? round($shipDaysSum / $shipDaysN, 1) : null,
    ],
    'byStatus' => $byStatus,
    'bySupplier' => $bySupplier,   // fulfilment performance per supplier
    'period' => [
      'from' => $fromDt !== null ? substr($fromDt, 0, 10) : null,
      'to'   => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    ],
  ]);
}

// GET /admin/reports/refunds — platform-wide refunds: counts + amount by status,
// and the platform refund rate (refunds ÷ paid orders). Scoped by request date.
function handleAdminRefundReport(PDO $pdo): void {
  [$fromDt, $toDt] = reportRange();
  $supplierId = reportSupplierId();   // null → all companies

  $byStatus = ['Pending'=>0,'Approved'=>0,'Rejected'=>0,'Completed'=>0];
  $totalRefunds = 0; $totalRefunded = 0.0;

  if ($supplierId !== null) {
    // refunds on orders that contain this supplier's products. A refund is
    // order-level, so fetch DISTINCT refunds then aggregate (the order_item join
    // would otherwise multiply the amount per matching line).
    $sql = "SELECT DISTINCT r.refundId, r.refundAmount, r.refundStatus
              FROM refund r
              JOIN order_item oi ON oi.orderId = r.orderId
              JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
              JOIN product p ON p.productId = pv.productId
             WHERE p.supplierId = :sid";
    $params = ['sid' => $supplierId];
    if ($fromDt !== null) { $sql .= ' AND r.requestDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
    $st = $pdo->prepare($sql); $st->execute($params);
    foreach ($st->fetchAll() as $r) {
      $s = $r['refundStatus'];
      if (isset($byStatus[$s])) { $byStatus[$s]++; }
      $totalRefunds++;
      if ($s === 'Approved' || $s === 'Completed') { $totalRefunded += (float) $r['refundAmount']; }
    }
  } else {
    $sql = "SELECT refundStatus, COUNT(*) AS n, COALESCE(SUM(refundAmount),0) AS amt FROM refund";
    $params = [];
    if ($fromDt !== null) { $sql .= ' WHERE requestDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
    $sql .= ' GROUP BY refundStatus';
    $st = $pdo->prepare($sql); $st->execute($params);
    foreach ($st->fetchAll() as $r) {
      if (isset($byStatus[$r['refundStatus']])) { $byStatus[$r['refundStatus']] = (int) $r['n']; }
      $totalRefunds += (int) $r['n'];
      if ($r['refundStatus'] === 'Approved' || $r['refundStatus'] === 'Completed') { $totalRefunded += (float) $r['amt']; }
    }
  }

  // paid orders (for the refund rate) — platform-wide, or this supplier's
  if ($supplierId !== null) {
    $paidSql = "SELECT COUNT(DISTINCT o.orderId) FROM `order` o
                  JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
                  JOIN order_item oi ON oi.orderId = o.orderId
                  JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
                  JOIN product p ON p.productId = pv.productId
                 WHERE p.supplierId = :sid";
    $paidParams = ['sid' => $supplierId];
    if ($fromDt !== null) { $paidSql .= ' AND pay.paymentDate BETWEEN :from AND :to'; $paidParams['from'] = $fromDt; $paidParams['to'] = $toDt; }
  } else {
    $paidSql = "SELECT COUNT(DISTINCT o.orderId) FROM `order` o
                  JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'";
    $paidParams = [];
    if ($fromDt !== null) { $paidSql .= ' WHERE pay.paymentDate BETWEEN :from AND :to'; $paidParams['from'] = $fromDt; $paidParams['to'] = $toDt; }
  }
  $pst = $pdo->prepare($paidSql); $pst->execute($paidParams);
  $paidOrders = (int) $pst->fetchColumn();

  // top refund reasons (platform-wide or scoped to one supplier's products)
  $reasonExpr = "COALESCE(NULLIF(TRIM(refundReason), ''), 'Unspecified')";
  if ($supplierId !== null) {
    $brSql = "SELECT reason, COUNT(*) AS n, COALESCE(SUM(amt), 0) AS amt FROM (
                SELECT DISTINCT r.refundId,
                       COALESCE(NULLIF(TRIM(r.refundReason), ''), 'Unspecified') AS reason,
                       r.refundAmount AS amt
                  FROM refund r
                  JOIN order_item oi ON oi.orderId = r.orderId
                  JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
                  JOIN product p ON p.productId = pv.productId
                 WHERE p.supplierId = :sid" . ($fromDt !== null ? ' AND r.requestDate BETWEEN :from AND :to' : '') . "
              ) t GROUP BY reason ORDER BY n DESC";
  } else {
    $brSql = "SELECT $reasonExpr AS reason, COUNT(*) AS n, COALESCE(SUM(refundAmount), 0) AS amt
                FROM refund" . ($fromDt !== null ? ' WHERE requestDate BETWEEN :from AND :to' : '') . "
               GROUP BY reason ORDER BY n DESC";
  }
  $brStmt = $pdo->prepare($brSql); $brStmt->execute($params);
  $byReason = array_map(fn($r) => [
    'reason' => $r['reason'], 'count' => (int) $r['n'], 'amount' => round((float) $r['amt'], 2),
  ], $brStmt->fetchAll());

  // approval rate among decided refunds, and refund value as a % of GMV
  $approved = $byStatus['Approved'] + $byStatus['Completed'];
  $decided  = $approved + $byStatus['Rejected'];
  $approvalRate = $decided > 0 ? round($approved / $decided * 100, 1) : null;
  $gmv = grossInWindow($pdo, $supplierId, $fromDt, $toDt);
  $refundValuePct = $gmv > 0 ? round($totalRefunded / $gmv * 100, 1) : null;

  sendJson(200, true, [
    'summary' => [
      'refunds'        => $totalRefunds,
      'totalRefunded'  => round($totalRefunded, 2),
      'paidOrders'     => $paidOrders,
      'refundRate'     => $paidOrders > 0 ? round($totalRefunds / $paidOrders * 100, 1) : null,
      'approvalRate'   => $approvalRate,     // approved ÷ (approved + rejected)
      'grossSales'     => round($gmv, 2),
      'refundValuePct' => $refundValuePct,   // refunded RM as % of GMV
    ],
    'byStatus' => $byStatus,
    'byReason' => $byReason,   // [{ reason, count, amount }], most common first
    'period' => [
      'from' => $fromDt !== null ? substr($fromDt, 0, 10) : null,
      'to'   => $toDt   !== null ? substr($toDt, 0, 10)   : null,
    ],
  ]);
}

// GET /admin/reports/companies — active suppliers (id + company name) to populate
// the "Company" filter dropdown on the platform reports. Ordered A→Z.
function handleAdminReportCompanies(PDO $pdo): void {
  $rows = $pdo->query(
    "SELECT s.supplierId, s.companyName
       FROM supplier s JOIN `user` u ON u.userId = s.userId
      WHERE u.status = 'Active'
      ORDER BY s.companyName ASC"
  )->fetchAll(PDO::FETCH_ASSOC);
  sendJson(200, true, [
    'companies' => array_map(fn($r) => [
      'supplierId'  => $r['supplierId'],
      'companyName' => $r['companyName'],
    ], $rows),
  ]);
}

// GET /admin/reports/commission — platform commission across all suppliers
// (paid orders only), broken down per supplier.
function handleAdminCommissionReport(PDO $pdo): void {
  $rate = activeCommissionRate($pdo);
  [$fromDt, $toDt] = reportRange();
  $supplierId = reportSupplierId();   // null → all companies

  $sql =
    "SELECT s.supplierId, s.companyName,
            SUM(oi.orderQuantity) AS units,
            SUM(oi.orderSubtotal) AS gross,
            COUNT(DISTINCT o.orderId) AS orders
       FROM order_item oi
       JOIN `order` o      ON o.orderId = oi.orderId
       JOIN payment pay    ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p      ON p.productId = pv.productId
       JOIN supplier s     ON s.supplierId = p.supplierId";
  $where = []; $params = [];
  if ($supplierId !== null) { $where[] = 'p.supplierId = :sid'; $params['sid'] = $supplierId; }
  if ($fromDt !== null)     { $where[] = 'pay.paymentDate BETWEEN :from AND :to'; $params['from'] = $fromDt; $params['to'] = $toDt; }
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' GROUP BY s.supplierId, s.companyName ORDER BY gross DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $totalGross = 0.0; $totalCommission = 0.0; $totalServiceTax = 0.0;
  $bySupplier = [];
  foreach ($rows as $r) {
    $g = (float) $r['gross'];
    $c = round($g * $rate / 100, 2);
    $t = serviceTaxOn($c);              // SST 8% on this supplier's commission
    $o = (int) $r['orders'];
    $totalGross += $g;
    $totalCommission += $c;
    $totalServiceTax += $t;
    $bySupplier[] = [
      'supplierId'  => $r['supplierId'],
      'companyName' => $r['companyName'],
      'units'       => (int) $r['units'],
      'orders'      => $o,
      'gross'       => round($g, 2),
      'commission'  => $c,
      'serviceTax'  => $t,
      'net'         => round($g - $c - $t, 2),          // what this supplier actually receives
      'avgOrderValue' => $o > 0 ? round($g / $o, 2) : null,
      'sharePct'    => 0.0,                             // % of GMV — filled below
    ];
  }
  // contribution share of GMV per supplier
  if ($totalGross > 0) {
    foreach ($bySupplier as $i => $s) {
      $bySupplier[$i]['sharePct'] = round($s['gross'] / $totalGross * 100, 1);
    }
  }

  // distinct paid orders (scoped to the company filter + window) → average order value
  $oSql = "SELECT COUNT(DISTINCT o.orderId)
             FROM `order` o
             JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'";
  $oWhere = []; $oParams = [];
  if ($supplierId !== null) {
    $oSql .= " JOIN order_item oi ON oi.orderId = o.orderId
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p ON p.productId = pv.productId";
    $oWhere[] = 'p.supplierId = :sid'; $oParams['sid'] = $supplierId;
  }
  if ($fromDt !== null) { $oWhere[] = 'pay.paymentDate BETWEEN :from AND :to'; $oParams['from'] = $fromDt; $oParams['to'] = $toDt; }
  if ($oWhere) { $oSql .= ' WHERE ' . implode(' AND ', $oWhere); }
  $oStmt = $pdo->prepare($oSql); $oStmt->execute($oParams);
  $orders = (int) $oStmt->fetchColumn();

  // delivery cost recovered from suppliers (3PL label OR in-house courier fee),
  // scoped to the company filter + window — reduces net-to-suppliers. 'Refunded'
  // payments are included (unlike the gross/commission queries): a parcel that
  // physically shipped incurred a real cost, so the supplier still bears it even
  // when the sale is refunded. Pre-shipment cancels delete their delivery rows.
  $shSql = "SELECT COALESCE(SUM(d.shippingCost + d.courierFee), 0)
              FROM delivery d
              JOIN `order` o   ON o.orderId = d.orderId
              JOIN payment pay ON pay.orderId = o.orderId AND pay.paymentStatus IN ('Successful', 'Refunded')";
  $shWhere = []; $shParams = [];
  if ($supplierId !== null) { $shWhere[] = 'd.supplierId = :sid'; $shParams['sid'] = $supplierId; }
  if ($fromDt !== null)     { $shWhere[] = 'pay.paymentDate BETWEEN :from AND :to'; $shParams['from'] = $fromDt; $shParams['to'] = $toDt; }
  if ($shWhere) { $shSql .= ' WHERE ' . implode(' AND ', $shWhere); }
  $shStmt = $pdo->prepare($shSql); $shStmt->execute($shParams);
  $totalDeliveryCost = round((float) $shStmt->fetchColumn(), 2);

  sendJson(200, true, [
    'commissionRate' => $rate,
    'serviceTaxRate' => serviceTaxRate(),
    'summary' => [
      'grossSales'      => round($totalGross, 2),
      'totalCommission' => round($totalCommission, 2),
      'totalServiceTax' => round($totalServiceTax, 2),
      'totalDeliveryCost' => $totalDeliveryCost,
      // what actually reaches suppliers after commission, the SST they bear, and
      // the delivery cost recovered from them
      'netToSuppliers'  => round($totalGross - $totalCommission - $totalServiceTax - $totalDeliveryCost, 2),
      'orders'          => $orders,
      'avgOrderValue'   => $orders > 0 ? round($totalGross / $orders, 2) : null,
      'suppliers'       => count($bySupplier),
    ],
    'bySupplier' => $bySupplier,
    'period' => periodBlock($pdo, $supplierId, $fromDt, $toDt, $totalGross),
  ]);
}
