<?php
// Courier earnings + payouts. A courier earns a flat fee per completed parcel
// (snapshotted on the delivery row when it's confirmed). The accrued balance is
// the sum of fees on Delivered parcels not yet covered by a payout. The admin
// pays a courier their balance in one Stripe Connect transfer; each covered
// delivery is stamped with the payout id so it can't be paid twice.
//
// Stripe onboarding mirrors the supplier flow (StripeController): the courier
// creates an Express Connect account and completes Stripe-hosted onboarding,
// so we only ever store the account id + whether payouts are enabled.

// Fetch the caller's delivery_personnel row (id + stripe fields), or 404.
function courierRowForAuth(PDO $pdo, array $auth): array {
  $stmt = $pdo->prepare(
    'SELECT deliveryPersonnelId, stripeAccountId, payoutsEnabled FROM delivery_personnel WHERE userId = :uid'
  );
  $stmt->execute(['uid' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Courier profile not found.']);
  }
  return $row;
}

// Pending balance (sum of unpaid Delivered fees) + delivery count for a courier.
function courierBalance(PDO $pdo, string $courierId): array {
  $stmt = $pdo->prepare(
    "SELECT COALESCE(SUM(courierFee), 0) AS balance, COUNT(*) AS deliveries
       FROM delivery
      WHERE deliveryPersonnelId = :dp AND deliveryStatus = 'Delivered' AND courierPayoutId IS NULL"
  );
  $stmt->execute(['dp' => $courierId]);
  $r = $stmt->fetch();
  return ['balance' => (float) $r['balance'], 'deliveries' => (int) $r['deliveries']];
}

// ── Courier-facing (delivery app) ──────────────────────────────────────────

// GET /courier/earnings — the courier's balance, lifetime earnings, payout
// history and Stripe connection status.
function handleCourierEarnings(PDO $pdo, array $config, array $auth): void {
  $row       = courierRowForAuth($pdo, $auth);
  $courierId = $row['deliveryPersonnelId'];

  $bal = courierBalance($pdo, $courierId);

  $paidStmt = $pdo->prepare(
    "SELECT COALESCE(SUM(courierFee), 0) FROM delivery
      WHERE deliveryPersonnelId = :dp AND deliveryStatus = 'Delivered'"
  );
  $paidStmt->execute(['dp' => $courierId]);
  $lifetime = (float) $paidStmt->fetchColumn();

  $hist = $pdo->prepare(
    "SELECT payoutId, amount, deliveryCount, currency, payoutStatus, created_at
       FROM courier_payout WHERE deliveryPersonnelId = :dp
      ORDER BY created_at DESC, payoutId DESC"
  );
  $hist->execute(['dp' => $courierId]);
  $payouts = $hist->fetchAll();
  foreach ($payouts as &$p) { $p['amount'] = (float) $p['amount']; }
  unset($p);

  sendJson(200, true, [
    'balance'         => $bal['balance'],
    'pendingCount'    => $bal['deliveries'],
    'lifetimeEarned'  => $lifetime,
    'feePerDelivery'  => (float) ($config['courier_fee_per_delivery'] ?? 0),
    'connected'       => (bool) $row['stripeAccountId'],
    'payoutsEnabled'  => (bool) $row['payoutsEnabled'],
    'currency'        => 'MYR',
    'payouts'         => $payouts,
  ]);
}

// POST /courier/stripe/onboard — ensure a Connect account exists, return a
// one-time hosted onboarding URL.
function handleCourierStripeOnboard(PDO $pdo, array $config, array $auth): void {
  requireDeliveryPersonnelId($pdo, $auth);
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Payouts are not configured yet.']);
  }
  $secret    = $config['stripe_secret'];
  $row       = courierRowForAuth($pdo, $auth);
  $accountId = $row['stripeAccountId'];

  try {
    if (!$accountId) {
      $account = stripeApi($secret, 'POST', '/v1/accounts', [
        'type'         => 'express',
        'country'      => 'MY',
        'capabilities' => ['transfers' => ['requested' => 'true']],
      ]);
      $accountId = $account['id'];
      $pdo->prepare('UPDATE delivery_personnel SET stripeAccountId = :sid WHERE deliveryPersonnelId = :id')
          ->execute(['sid' => $accountId, 'id' => $row['deliveryPersonnelId']]);
    }

    $appUrl = rtrim($config['app_url'], '/');
    $link = stripeApi($secret, 'POST', '/v1/account_links', [
      'account'     => $accountId,
      'refresh_url' => $appUrl . '/courier/earnings?refresh=1',
      'return_url'  => $appUrl . '/courier/earnings?done=1',
      'type'        => 'account_onboarding',
    ]);
    sendJson(200, true, ['url' => $link['url']]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
}

// GET /courier/stripe/status — report payout status, syncing payoutsEnabled
// from Stripe when an account exists.
function handleCourierStripeStatus(PDO $pdo, array $config, array $auth): void {
  $row = courierRowForAuth($pdo, $auth);

  if (!$row['stripeAccountId']) {
    sendJson(200, true, ['connected' => false, 'payoutsEnabled' => false, 'configured' => stripeConfigured($config)]);
  }
  if (!stripeConfigured($config)) {
    sendJson(200, true, ['connected' => true, 'payoutsEnabled' => (bool) $row['payoutsEnabled'], 'configured' => false]);
  }

  try {
    $account = stripeApi($config['stripe_secret'], 'GET', '/v1/accounts/' . $row['stripeAccountId']);
    $enabled = !empty($account['payouts_enabled'])
        && (($account['capabilities']['transfers'] ?? '') === 'active');
    $pdo->prepare('UPDATE delivery_personnel SET payoutsEnabled = :e WHERE deliveryPersonnelId = :id')
        ->execute(['e' => $enabled ? 1 : 0, 'id' => $row['deliveryPersonnelId']]);

    sendJson(200, true, [
      'connected'        => true,
      'payoutsEnabled'   => $enabled,
      'detailsSubmitted' => !empty($account['details_submitted']),
      'configured'       => true,
    ]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
}

// ── Admin-facing (web) ──────────────────────────────────────────────────────

// GET /admin/courier-payouts — every Active courier with their pending balance,
// lifetime paid, and Stripe connection status.
function handleListCourierBalances(PDO $pdo): void {
  $rows = $pdo->query(
    "SELECT dp.deliveryPersonnelId, u.fullName, u.email,
            dp.stripeAccountId, dp.payoutsEnabled,
            COALESCE(SUM(CASE WHEN d.deliveryStatus = 'Delivered' AND d.courierPayoutId IS NULL THEN d.courierFee ELSE 0 END), 0) AS pendingBalance,
            COALESCE(SUM(CASE WHEN d.deliveryStatus = 'Delivered' AND d.courierPayoutId IS NULL THEN 1 ELSE 0 END), 0) AS pendingDeliveries
       FROM delivery_personnel dp
       JOIN `user` u ON u.userId = dp.userId AND u.status = 'Active'
       LEFT JOIN delivery d ON d.deliveryPersonnelId = dp.deliveryPersonnelId
      GROUP BY dp.deliveryPersonnelId, u.fullName, u.email, dp.stripeAccountId, dp.payoutsEnabled
      ORDER BY pendingBalance DESC, u.fullName ASC"
  )->fetchAll();

  foreach ($rows as &$r) {
    $r['pendingBalance']    = (float) $r['pendingBalance'];
    $r['pendingDeliveries'] = (int) $r['pendingDeliveries'];
    $r['connected']         = (bool) $r['stripeAccountId'];
    $r['payoutsEnabled']    = (bool) $r['payoutsEnabled'];
    unset($r['stripeAccountId']);
  }
  unset($r);

  sendJson(200, true, ['couriers' => $rows]);
}

// GET /admin/couriers/{deliveryPersonnelId}/payouts — that courier's payout history.
function handleCourierPayoutHistory(PDO $pdo, string $courierId): void {
  $stmt = $pdo->prepare(
    "SELECT payoutId, amount, deliveryCount, currency, payoutStatus, stripeTransferId, created_at
       FROM courier_payout WHERE deliveryPersonnelId = :dp
      ORDER BY created_at DESC, payoutId DESC"
  );
  $stmt->execute(['dp' => $courierId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['amount'] = (float) $r['amount']; }
  unset($r);
  sendJson(200, true, ['payouts' => $rows]);
}

// POST /admin/couriers/{deliveryPersonnelId}/payout — pay the courier their
// whole pending balance in one Stripe transfer, then stamp the covered
// deliveries with the payout id.
function handlePayCourier(PDO $pdo, array $config, string $courierId): void {
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Payouts are not configured yet.']);
  }

  $stmt = $pdo->prepare(
    'SELECT dp.deliveryPersonnelId, dp.stripeAccountId, dp.payoutsEnabled, u.fullName
       FROM delivery_personnel dp JOIN `user` u ON u.userId = dp.userId
      WHERE dp.deliveryPersonnelId = :id'
  );
  $stmt->execute(['id' => $courierId]);
  $courier = $stmt->fetch();
  if (!$courier) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Courier not found.']);
  }
  if (!$courier['stripeAccountId'] || !$courier['payoutsEnabled']) {
    sendJson(409, false, null, ['code' => 'NOT_CONNECTED',
      'message' => 'This courier has not finished connecting their payout account.']);
  }

  $bal = courierBalance($pdo, $courierId);
  if ($bal['balance'] <= 0) {
    sendJson(409, false, null, ['code' => 'NOTHING_DUE', 'message' => 'This courier has no pending balance.']);
  }

  $payoutId = nextId($pdo, 'courier_payout', 'payoutId', 'CPY');
  $cents    = (int) round($bal['balance'] * 100);

  $transferId = null;
  $status     = 'Failed';
  try {
    $transfer = stripeApi($config['stripe_secret'], 'POST', '/v1/transfers', [
      'amount'         => $cents,
      'currency'       => 'myr',
      'destination'    => $courier['stripeAccountId'],
      'transfer_group' => $payoutId,
    ]);
    $transferId = $transfer['id'] ?? null;
    $status     = 'Paid';
  } catch (Throwable $e) {
    // record the failed attempt so it's auditable, then surface the error
    $pdo->prepare(
      "INSERT INTO courier_payout (payoutId, deliveryPersonnelId, stripeTransferId, amount, deliveryCount, currency, payoutStatus)
       VALUES (:id, :dp, NULL, :amt, :cnt, 'myr', 'Failed')"
    )->execute(['id' => $payoutId, 'dp' => $courierId, 'amt' => $bal['balance'], 'cnt' => $bal['deliveries']]);
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }

  try {
    $pdo->beginTransaction();
    $pdo->prepare(
      "INSERT INTO courier_payout (payoutId, deliveryPersonnelId, stripeTransferId, amount, deliveryCount, currency, payoutStatus)
       VALUES (:id, :dp, :tr, :amt, :cnt, 'myr', :st)"
    )->execute(['id' => $payoutId, 'dp' => $courierId, 'tr' => $transferId,
                'amt' => $bal['balance'], 'cnt' => $bal['deliveries'], 'st' => $status]);
    // stamp exactly the deliveries that made up this balance
    $pdo->prepare(
      "UPDATE delivery SET courierPayoutId = :pid
        WHERE deliveryPersonnelId = :dp AND deliveryStatus = 'Delivered' AND courierPayoutId IS NULL"
    )->execute(['pid' => $payoutId, 'dp' => $courierId]);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR',
      'message' => 'The transfer succeeded but recording it failed. Note transfer ' . $transferId . ' and contact support.']);
  }

  sendJson(201, true, [
    'payoutId'      => $payoutId,
    'amount'        => $bal['balance'],
    'deliveryCount' => $bal['deliveries'],
    'stripeTransferId' => $transferId,
    'payoutStatus'  => $status,
  ]);
}
