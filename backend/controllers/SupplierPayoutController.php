<?php
// Supplier earnings + payouts (Stripe Connect "separate charges & transfers").
// The customer pays the platform once; the platform keeps its commission + SST,
// recovers delivery, and transfers each supplier their net. This module settles
// that net for real — an admin "Pay now" action (and, in Phase 2, an automatic
// sweep) that transfers a supplier's payable balance and records one
// supplier_payout row per covered order so it can't be paid twice.
//
// The PAYABLE rule (see docs/supplier-payout-plan.md): a supplier's share of an
// order is payable only once the parcel is Delivered AND the refund window has
// closed (deliveryDate + REFUND_WINDOW_DAYS < now) AND the payment is still
// Successful AND it hasn't already been paid. Paying only after the refund window
// removes the refund-clawback problem — we never pay out refundable money.
//
// Mirrors CourierPayoutController; reuses the Sales-report maths
// (activeCommissionRate + serviceTaxOn) so the number a supplier is PAID equals
// the number they were SHOWN.

// Refund window in days (matches the customer refund policy in RefundController).
function supplierRefundWindowDays(): int {
  return defined('REFUND_WINDOW_DAYS') ? REFUND_WINDOW_DAYS : 7;
}

// Payable (supplier, order) slices — each with the same gross→net breakdown the
// Sales report shows. Pass a supplierId to scope to one supplier, or null for all.
// Rows already paid (a 'Paid' supplier_payout row exists) are excluded.
function supplierPayableRows(PDO $pdo, ?string $supplierId = null): array {
  $rate = activeCommissionRate($pdo);
  $win  = supplierRefundWindowDays();

  $sql =
    "SELECT d.orderId, d.supplierId,
            SUM(oi.orderSubtotal)            AS supplierGross,
            ot.orderSub                      AS orderSub,
            pay.refundedAmount               AS refundedAmount,
            (d.shippingCost + d.courierFee)  AS deliveryCost,
            d.deliveryDate
       FROM delivery d
       JOIN `order` o          ON o.orderId = d.orderId
       JOIN payment pay        ON pay.orderId = o.orderId AND pay.paymentStatus = 'Successful'
       JOIN order_item oi       ON oi.orderId = o.orderId
       JOIN product_variant pv  ON pv.productVariantId = oi.productVariantId
       JOIN product p           ON p.productId = pv.productId AND p.supplierId = d.supplierId
       JOIN (SELECT orderId, SUM(orderSubtotal) AS orderSub FROM order_item GROUP BY orderId) ot
         ON ot.orderId = o.orderId
       LEFT JOIN supplier_payout sp
         ON sp.orderId = d.orderId AND sp.supplierId = d.supplierId AND sp.payoutStatus = 'Paid'
      WHERE d.deliveryStatus = 'Delivered'
        AND d.deliveryDate IS NOT NULL
        AND d.deliveryDate + INTERVAL :win DAY < NOW()
        AND sp.payoutId IS NULL";
  $params = ['win' => $win];
  if ($supplierId !== null) { $sql .= ' AND d.supplierId = :sid'; $params['sid'] = $supplierId; }
  $sql .= ' GROUP BY d.orderId, d.supplierId, ot.orderSub, pay.refundedAmount, d.shippingCost, d.courierFee, d.deliveryDate';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);

  $out = [];
  foreach ($stmt->fetchAll() as $r) {
    $gross    = (float) $r['supplierGross'];
    $orderSub = (float) $r['orderSub'];
    $refunded = (float) $r['refundedAmount'];
    // this supplier's share of any partial refund on the order
    $refundShare = $orderSub > 0 ? round($refunded * ($gross / $orderSub), 2) : 0.0;
    $netSales    = round($gross - $refundShare, 2);
    $commission  = round($netSales * $rate / 100, 2);
    $sst         = serviceTaxOn($commission);
    $delivery    = round((float) $r['deliveryCost'], 2);
    $net         = round($netSales - $commission - $sst - $delivery, 2);
    $out[] = [
      'orderId'      => $r['orderId'],
      'supplierId'   => $r['supplierId'],
      'gross'        => round($gross, 2),
      'refundShare'  => $refundShare,
      'commission'   => $commission,
      'serviceTax'   => $sst,
      'deliveryCost' => $delivery,
      'net'          => $net,
      'deliveryDate' => $r['deliveryDate'],
    ];
  }
  return $out;
}

// A supplier's payable balance (net of all payable slices) + the order count.
function supplierBalance(PDO $pdo, string $supplierId): array {
  $rows = supplierPayableRows($pdo, $supplierId);
  $bal = 0.0;
  foreach ($rows as $r) { $bal += $r['net']; }
  return ['balance' => round($bal, 2), 'orders' => count($rows), 'rows' => $rows];
}

// Core payout: transfer a supplier's whole payable balance in ONE Stripe transfer,
// then record a supplier_payout row per covered order (isAuto marks a sweep vs a
// manual "Pay now"). Returns the result, or throws RuntimeException on failure.
// Caller does the connected/balance pre-checks.
function payOutSupplierBalance(PDO $pdo, array $config, array $supplier, bool $isAuto): array {
  $supplierId = $supplier['supplierId'];
  $bal  = supplierBalance($pdo, $supplierId);
  $rows = $bal['rows'];
  if ($bal['balance'] <= 0) {
    throw new RuntimeException('This supplier has no payable balance.');
  }

  $cents = (int) round($bal['balance'] * 100);
  $auto  = $isAuto ? 1 : 0;
  // one transfer_group id shared by every supplier_payout row in this run
  $group = nextId($pdo, 'supplier_payout', 'payoutId', 'PYT');

  $transferId = null;
  try {
    $transfer = stripeApi($config['stripe_secret'], 'POST', '/v1/transfers', [
      'amount'         => $cents,
      'currency'       => 'myr',
      'destination'    => $supplier['stripeAccountId'],
      'transfer_group' => $group,
    ]);
    $transferId = $transfer['id'] ?? null;
  } catch (Throwable $e) {
    // record failed attempts (one per covered order) so they're auditable, then
    // surface the error. 'Failed' rows don't block a later retry (we only exclude
    // 'Paid' rows from the payable set).
    $ins = $pdo->prepare(
      "INSERT INTO supplier_payout
         (payoutId, supplierId, orderId, stripeTransferId, grossAmount, commissionAmount, serviceTaxAmount, netAmount, currency, payoutStatus, isAuto, paidAt)
       VALUES (:id, :sid, :oid, NULL, :g, :c, :t, :n, 'myr', 'Failed', :au, NULL)"
    );
    foreach ($rows as $r) {
      $ins->execute([
        'id' => nextId($pdo, 'supplier_payout', 'payoutId', 'PYT'),
        'sid' => $supplierId, 'oid' => $r['orderId'],
        'g' => $r['gross'], 'c' => $r['commission'], 't' => $r['serviceTax'], 'n' => $r['net'], 'au' => $auto,
      ]);
    }
    throw new RuntimeException($e->getMessage());
  }

  try {
    $pdo->beginTransaction();
    $ins = $pdo->prepare(
      "INSERT INTO supplier_payout
         (payoutId, supplierId, orderId, stripeTransferId, grossAmount, commissionAmount, serviceTaxAmount, netAmount, currency, payoutStatus, isAuto, paidAt)
       VALUES (:id, :sid, :oid, :tr, :g, :c, :t, :n, 'myr', 'Paid', :au, NOW())"
    );
    foreach ($rows as $r) {
      $ins->execute([
        'id' => nextId($pdo, 'supplier_payout', 'payoutId', 'PYT'),
        'sid' => $supplierId, 'oid' => $r['orderId'], 'tr' => $transferId,
        'g' => $r['gross'], 'c' => $r['commission'], 't' => $r['serviceTax'], 'n' => $r['net'], 'au' => $auto,
      ]);
    }
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    throw new RuntimeException('Transfer ' . $transferId . ' succeeded but recording it failed.');
  }

  return [
    'amount'           => $bal['balance'],
    'orderCount'       => count($rows),
    'stripeTransferId' => $transferId,
    'payoutStatus'     => 'Paid',
  ];
}

// ── Supplier-facing (web/app) ───────────────────────────────────────────────

// GET /supplier/earnings — the signed-in supplier's payable balance, the orders
// still in the refund-hold window, payout history, and Stripe connection status.
function handleSupplierEarnings(PDO $pdo, array $config, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $s = $pdo->prepare('SELECT stripeAccountId, payoutsEnabled FROM supplier WHERE supplierId = :id');
  $s->execute(['id' => $supplierId]);
  $sup = $s->fetch();

  $bal = supplierBalance($pdo, $supplierId);

  // delivered orders still inside the refund window — money owed but not yet
  // payable (shown to the supplier as "in hold, releases after the refund window")
  $win = supplierRefundWindowDays();
  $hold = $pdo->prepare(
    "SELECT COUNT(*) FROM delivery d
       JOIN payment pay ON pay.orderId = d.orderId AND pay.paymentStatus = 'Successful'
       LEFT JOIN supplier_payout sp ON sp.orderId = d.orderId AND sp.supplierId = d.supplierId AND sp.payoutStatus = 'Paid'
      WHERE d.supplierId = :sid AND d.deliveryStatus = 'Delivered'
        AND d.deliveryDate IS NOT NULL AND d.deliveryDate + INTERVAL :win DAY >= NOW()
        AND sp.payoutId IS NULL"
  );
  $hold->execute(['sid' => $supplierId, 'win' => $win]);
  $inHoldOrders = (int) $hold->fetchColumn();

  $paid = $pdo->prepare(
    "SELECT COALESCE(SUM(netAmount), 0) FROM supplier_payout WHERE supplierId = :sid AND payoutStatus = 'Paid'"
  );
  $paid->execute(['sid' => $supplierId]);
  $lifetimePaid = round((float) $paid->fetchColumn(), 2);

  $hist = $pdo->prepare(
    "SELECT stripeTransferId, SUM(netAmount) AS amount, COUNT(*) AS orderCount,
            MAX(payoutStatus) AS payoutStatus, MAX(isAuto) AS isAuto, MAX(paidAt) AS paidAt, MAX(created_at) AS created_at
       FROM supplier_payout
      WHERE supplierId = :sid AND stripeTransferId IS NOT NULL
      GROUP BY stripeTransferId
      ORDER BY created_at DESC"
  );
  $hist->execute(['sid' => $supplierId]);
  $payouts = array_map(function ($p) {
    $p['amount'] = round((float) $p['amount'], 2);
    $p['orderCount'] = (int) $p['orderCount'];
    $p['isAuto'] = (bool) (int) $p['isAuto'];
    return $p;
  }, $hist->fetchAll());

  sendJson(200, true, [
    'balance'        => $bal['balance'],
    'payableOrders'  => $bal['orders'],
    'inHoldOrders'   => $inHoldOrders,
    'refundWindowDays' => $win,
    'lifetimePaid'   => $lifetimePaid,
    'connected'      => (bool) ($sup['stripeAccountId'] ?? null),
    'payoutsEnabled' => (bool) ($sup['payoutsEnabled'] ?? 0),
    'currency'       => 'MYR',
    'payouts'        => $payouts,
  ]);
}

// ── Admin-facing (web) ──────────────────────────────────────────────────────

// GET /admin/supplier-payouts — every active supplier with their payable balance,
// order count, lifetime paid, and Stripe connection status.
function handleListSupplierBalances(PDO $pdo): void {
  // payable slices for all suppliers, aggregated per supplier in PHP
  $agg = [];
  foreach (supplierPayableRows($pdo, null) as $r) {
    $sid = $r['supplierId'];
    if (!isset($agg[$sid])) { $agg[$sid] = ['balance' => 0.0, 'orders' => 0]; }
    $agg[$sid]['balance'] += $r['net'];
    $agg[$sid]['orders']  += 1;
  }

  $rows = $pdo->query(
    "SELECT s.supplierId, s.companyName, u.email, s.stripeAccountId, s.payoutsEnabled,
            COALESCE((SELECT SUM(sp.netAmount) FROM supplier_payout sp
                       WHERE sp.supplierId = s.supplierId AND sp.payoutStatus = 'Paid'), 0) AS lifetimePaid
       FROM supplier s
       JOIN `user` u ON u.userId = s.userId AND u.status = 'Active'
      ORDER BY s.companyName ASC"
  )->fetchAll();

  $suppliers = array_map(function ($r) use ($agg) {
    $sid = $r['supplierId'];
    return [
      'supplierId'     => $sid,
      'companyName'    => $r['companyName'],
      'email'          => $r['email'],
      'pendingBalance' => round($agg[$sid]['balance'] ?? 0.0, 2),
      'pendingOrders'  => $agg[$sid]['orders'] ?? 0,
      'lifetimePaid'   => round((float) $r['lifetimePaid'], 2),
      'connected'      => (bool) $r['stripeAccountId'],
      'payoutsEnabled' => (bool) $r['payoutsEnabled'],
    ];
  }, $rows);

  // biggest balance first, so who's owed the most surfaces at the top
  usort($suppliers, fn($a, $b) => $b['pendingBalance'] <=> $a['pendingBalance'] ?: strcmp($a['companyName'], $b['companyName']));

  sendJson(200, true, ['suppliers' => $suppliers]);
}

// GET /admin/suppliers/{supplierId}/payouts — that supplier's payout history
// (grouped per transfer run).
function handleSupplierPayoutHistory(PDO $pdo, string $supplierId): void {
  $stmt = $pdo->prepare(
    "SELECT stripeTransferId, SUM(netAmount) AS amount, COUNT(*) AS orderCount,
            MAX(payoutStatus) AS payoutStatus, MAX(isAuto) AS isAuto, MAX(paidAt) AS paidAt, MAX(created_at) AS created_at
       FROM supplier_payout
      WHERE supplierId = :sid
      GROUP BY stripeTransferId, DATE(created_at)
      ORDER BY created_at DESC"
  );
  $stmt->execute(['sid' => $supplierId]);
  $payouts = array_map(function ($p) {
    $p['amount'] = round((float) $p['amount'], 2);
    $p['orderCount'] = (int) $p['orderCount'];
    $p['isAuto'] = (bool) (int) $p['isAuto'];
    return $p;
  }, $stmt->fetchAll());
  sendJson(200, true, ['payouts' => $payouts]);
}

// POST /admin/suppliers/{supplierId}/payout — pay a supplier their whole payable
// balance in one Stripe transfer.
function handlePaySupplier(PDO $pdo, array $config, string $supplierId): void {
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Payouts are not configured yet.']);
  }

  $stmt = $pdo->prepare(
    'SELECT s.supplierId, s.companyName, s.stripeAccountId, s.payoutsEnabled
       FROM supplier s WHERE s.supplierId = :id'
  );
  $stmt->execute(['id' => $supplierId]);
  $supplier = $stmt->fetch();
  if (!$supplier) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Supplier not found.']);
  }
  if (!$supplier['stripeAccountId'] || !$supplier['payoutsEnabled']) {
    sendJson(409, false, null, ['code' => 'NOT_CONNECTED',
      'message' => 'This supplier has not finished connecting their payout account.']);
  }
  if (supplierBalance($pdo, $supplierId)['balance'] <= 0) {
    sendJson(409, false, null, ['code' => 'NOTHING_DUE', 'message' => 'This supplier has no payable balance.']);
  }

  try {
    $res = payOutSupplierBalance($pdo, $config, $supplier, false);   // false = manual
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
  sendJson(201, true, $res);
}
