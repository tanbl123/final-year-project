<?php
// Stripe Connect onboarding for suppliers (payouts). A supplier creates a
// Connect Express account and completes Stripe-hosted onboarding, where Stripe
// collects + verifies their bank account and identity. We store only the
// account id and whether payouts are enabled — never raw bank details.

// Fetch the caller's supplier row (id + stripe fields), or 404.
function supplierRowForAuth(PDO $pdo, array $auth): array {
  $stmt = $pdo->prepare(
    'SELECT supplierId, stripeAccountId, payoutsEnabled FROM supplier WHERE userId = :uid'
  );
  $stmt->execute(['uid' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Supplier profile not found.']);
  }
  return $row;
}

// POST /supplier/stripe/onboard — ensure a Connect account exists, then return
// a one-time hosted onboarding URL for the supplier to complete.
function handleStripeOnboard(PDO $pdo, array $config, array $auth): void {
  requireSupplierId($pdo, $auth);
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Payouts are not configured yet.']);
  }
  $secret = $config['stripe_secret'];
  $row    = supplierRowForAuth($pdo, $auth);
  $accountId = $row['stripeAccountId'];

  try {
    // create the Connect account on first use and remember its id
    if (!$accountId) {
      $account = stripeApi($secret, 'POST', '/v1/accounts',
        stripeConnectAccountParams([
          'transfers'     => ['requested' => 'true'],
          'card_payments' => ['requested' => 'true'],
        ]));
      $accountId = $account['id'];
      $pdo->prepare('UPDATE supplier SET stripeAccountId = :sid WHERE supplierId = :id')
          ->execute(['sid' => $accountId, 'id' => $row['supplierId']]);
    }

    $appUrl = rtrim($config['app_url'], '/');
    $link = stripeApi($secret, 'POST', '/v1/account_links', [
      'account'     => $accountId,
      'refresh_url' => $appUrl . '/payouts?refresh=1',
      'return_url'  => $appUrl . '/payouts?done=1',
      'type'        => 'account_onboarding',
    ]);

    sendJson(200, true, ['url' => $link['url']]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
}

// POST /supplier/stripe/dashboard — one-time link to the supplier's Stripe
// Express dashboard, where they can review/update their payout bank account.
// Only works once onboarding is complete (the account has a dashboard).
function handleStripeDashboard(PDO $pdo, array $config, array $auth): void {
  requireSupplierId($pdo, $auth);
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Payouts are not configured yet.']);
  }
  $row = supplierRowForAuth($pdo, $auth);
  if (!$row['stripeAccountId']) {
    sendJson(409, false, null, ['code' => 'NOT_CONNECTED', 'message' => 'Connect a Stripe account first.']);
  }

  try {
    $link = stripeApi($config['stripe_secret'], 'POST',
      '/v1/accounts/' . $row['stripeAccountId'] . '/login_links');
    sendJson(200, true, ['url' => $link['url']]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
}

// GET /supplier/stripe/status — report the supplier's payout status, syncing
// payoutsEnabled from Stripe when an account exists.
function handleStripeStatus(PDO $pdo, array $config, array $auth): void {
  requireSupplierId($pdo, $auth);
  $row = supplierRowForAuth($pdo, $auth);

  if (!$row['stripeAccountId']) {
    sendJson(200, true, [
      'connected'      => false,
      'payoutsEnabled' => false,
      'configured'     => stripeConfigured($config),
    ]);
  }
  if (!stripeConfigured($config)) {
    sendJson(200, true, [
      'connected'      => true,
      'payoutsEnabled' => (bool) $row['payoutsEnabled'],
      'configured'     => false,
    ]);
  }

  try {
    $account = stripeApi($config['stripe_secret'], 'GET', '/v1/accounts/' . $row['stripeAccountId']);
    $enabled = !empty($account['charges_enabled']) && !empty($account['payouts_enabled']);
    $pdo->prepare('UPDATE supplier SET payoutsEnabled = :e WHERE supplierId = :id')
        ->execute(['e' => $enabled ? 1 : 0, 'id' => $row['supplierId']]);

    sendJson(200, true, [
      'connected'       => true,
      'payoutsEnabled'  => $enabled,
      'detailsSubmitted' => !empty($account['details_submitted']),
      'configured'      => true,
    ]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => $e->getMessage()]);
  }
}
