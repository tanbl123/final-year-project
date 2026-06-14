<?php
/**
 * ShoeAR — Stripe Connect MULTI-SUPPLIER PAYOUT DEMO (test mode only)
 * =====================================================================
 * Proves the whole money flow end-to-end, using fake Stripe test data:
 *
 *   1. Each supplier gets a Stripe test "connected account" with a FAKE
 *      (test) bank account — Stripe generates these for you.
 *   2. A demo customer buys one item from EACH supplier in a single order.
 *   3. The customer pays the PLATFORM once (a test card charge).
 *   4. The platform keeps the COMMISSION and sends each supplier their NET
 *      as a Stripe Transfer  →  "each supplier receives money".
 *   5. Order / payment / payout rows are written to the database, so the
 *      Sales report (per supplier) and the Commission report (admin) light up.
 *
 * No real money EVER moves — this only works with a test key (sk_test_...).
 *
 * HOW TO RUN (locally, with XAMPP MySQL running):
 *   1. Put your Stripe TEST secret key in backend/config.local.php:
 *          <?php return ['stripe_secret' => 'sk_test_...'];
 *   2. Make sure Connect is enabled on your test account:
 *          Stripe Dashboard → Connect → Get started (test mode).
 *   3. Import the seeds (phpMyAdmin):
 *          schema.sql → seed.sql → seed_sales.sql → seed_multi_supplier.sql
 *      and apply database/migrations/2026_06_14_supplier_payout.sql
 *   4. From the project root run:
 *          php backend/scripts/stripe_payout_demo.php
 *
 * If a connected account can't be auto-verified, the script prints a Stripe
 * onboarding link for it — open it, click through Stripe's test pages (use the
 * "Skip / use test data" options), then RUN THE SCRIPT AGAIN to finish.
 * =====================================================================
 */

if (PHP_SAPI !== 'cli') {
  http_response_code(403);
  exit("This demo script can only be run from the command line.\n");
}

require __DIR__ . '/../lib/db.php';                 // getPDO()
require __DIR__ . '/../lib/ids.php';                // nextId()
require __DIR__ . '/../lib/stripe.php';             // stripeApi(), stripeConfigured()

$config = require __DIR__ . '/../config.php';        // app + Stripe config

// ── tiny console helpers ──────────────────────────────────────
function line(string $s = ''): void { fwrite(STDOUT, $s . "\n"); }
function rule(): void { line(str_repeat('─', 60)); }
function bail(string $s): void { fwrite(STDERR, "\n✗ " . $s . "\n"); exit(1); }
function money(float $a, string $cur): string { return strtoupper($cur) . ' ' . number_format($a, 2); }
// Whole-currency amount → Stripe's minor units (e.g. 12.34 MYR → 1234).
function minor(float $a): int { return (int) round($a * 100); }

// FAKE test bank accounts, per country. In test mode Stripe accepts these and
// instantly treats them as valid — no real bank is touched. If your country
// isn't listed (or Stripe rejects the value), the script falls back to the
// hosted onboarding link, OR you can override via config.local.php:
//     'demo_bank' => ['routing_number' => '...', 'account_number' => '...'],
$TEST_BANKS = [
  'US' => ['routing_number' => '110000000', 'account_number' => '000123456789'],
  'GB' => ['routing_number' => '108800',     'account_number' => '00012345'],
  'MY' => ['routing_number' => 'MBBEMYKL',   'account_number' => '000123456000'],
  'SG' => ['routing_number' => '1100-000',   'account_number' => '000123456'],
  'AU' => ['routing_number' => '110000',     'account_number' => '000123456'],
];

rule();
line('  ShoeAR — Stripe multi-supplier payout demo (TEST MODE)');
rule();

// ── 0. Pre-flight ─────────────────────────────────────────────
if (!stripeConfigured($config)) {
  bail("No Stripe key found. Put your TEST key in backend/config.local.php:\n"
     . "      <?php return ['stripe_secret' => 'sk_test_...'];");
}
$secret = $config['stripe_secret'];
if (strpos($secret, 'sk_test_') !== 0) {
  bail("Refusing to run: the key is not a TEST key (must start with sk_test_).\n"
     . "      This demo moves money and must never touch a live key.");
}

$pdo = getPDO();

// Platform account → its country/currency drive everything (connected accounts
// must live in the platform's country; the charge uses its default currency).
try {
  $platform = stripeApi($secret, 'GET', '/v1/account');
} catch (Throwable $e) {
  bail("Couldn't reach Stripe (need outbound access to api.stripe.com):\n      " . $e->getMessage());
}
$country  = strtoupper($platform['country'] ?? 'US');
$currency = strtolower($platform['default_currency'] ?? 'usd');
line("Platform account : {$platform['id']}  ({$country}, " . strtoupper($currency) . ")");

if (empty($platform['charges_enabled'])) {
  line("⚠  Your platform account can't take charges yet. If the charge step fails,");
  line("   finish your test account setup in the Stripe Dashboard first.");
}

// Pick the fake bank to attach (config override wins).
$bank = $config['demo_bank'] ?? ($TEST_BANKS[$country] ?? null);

// ── 1. Find suppliers with something to sell ──────────────────
// One in-stock, approved product variant per supplier (up to 3 suppliers).
$rows = $pdo->query(
  "SELECT s.supplierId, s.companyName, s.stripeAccountId, s.payoutsEnabled,
          pv.productVariantId, pv.size, pv.stockQuantity,
          p.productId, p.productName, p.productPrice
     FROM supplier s
     JOIN product p          ON p.supplierId = s.supplierId AND p.productStatus = 'Approved'
     JOIN product_variant pv ON pv.productId = p.productId AND pv.stockQuantity > 0
    ORDER BY s.supplierId, p.productId, pv.productVariantId"
)->fetchAll();

$suppliers = [];                       // supplierId → chosen line + stripe fields
foreach ($rows as $r) {
  if (isset($suppliers[$r['supplierId']])) continue;   // first variant per supplier
  $suppliers[$r['supplierId']] = $r;
  if (count($suppliers) === 3) break;
}
if (count($suppliers) < 2) {
  bail("Need at least 2 suppliers with an approved, in-stock product.\n"
     . "      Import database/seed_multi_supplier.sql first.");
}
line('Suppliers in cart: ' . implode(', ', array_keys($suppliers)));
rule();

// ── 2. Ensure each supplier has an ENABLED connected account ───
// Returns the account array. Creates one (with fake bank) on first run.
function ensureAccount(string $secret, string $country, string $currency, ?array $bank, PDO $pdo, array $sup): array {
  $accountId = $sup['stripeAccountId'];

  if (!$accountId) {
    // Comprehensive payload first: in test mode the magic values below verify
    // the account instantly. We only request `transfers` — that's all a
    // supplier needs to RECEIVE money; the platform handles card payments.
    $payload = [
      'type'          => 'custom',
      'country'       => $country,
      'business_type' => 'individual',
      'capabilities'  => ['transfers' => ['requested' => 'true']],
      'business_profile' => [
        'mcc' => '5661',                                   // shoe stores
        'url' => 'https://shoear.example.com',
        'product_description' => 'ShoeAR test supplier (no real goods).',
      ],
      'individual' => [
        'first_name' => 'Test',
        'last_name'  => 'Supplier ' . $sup['supplierId'],
        'email'      => strtolower($sup['supplierId']) . '@example.com',
        'phone'      => '+60123456789',
        'dob'        => ['day' => 1, 'month' => 1, 'year' => 1901],   // test DOB
        'id_number'  => '000000000',                                  // test ID → verified
        'address'    => [
          'line1'       => 'address_full_match',                      // test → address verified
          'city'        => 'Kuala Lumpur',
          'state'       => 'Wilayah Persekutuan',
          'postal_code' => '50000',
          'country'     => $country,
        ],
      ],
      'tos_acceptance' => ['date' => time(), 'ip' => '127.0.0.1'],
    ];

    try {
      $account = stripeApi($secret, 'POST', '/v1/accounts', $payload);
    } catch (Throwable $e) {
      // Some countries require different fields — fall back to a bare account
      // that the user finishes through the hosted onboarding link.
      line("    (auto-fill rejected: {$e->getMessage()} — creating a basic account to onboard by link)");
      $account = stripeApi($secret, 'POST', '/v1/accounts', [
        'type'           => 'custom',
        'country'        => $country,
        'business_type'  => 'individual',
        'capabilities'   => ['transfers' => ['requested' => 'true']],
        'tos_acceptance' => ['date' => time(), 'ip' => '127.0.0.1'],
      ]);
    }
    $accountId = $account['id'];
    $pdo->prepare('UPDATE supplier SET stripeAccountId = :a WHERE supplierId = :s')
        ->execute(['a' => $accountId, 's' => $sup['supplierId']]);

    // Attach the FAKE test bank account (best effort — onboarding can add it too).
    if ($bank) {
      try {
        stripeApi($secret, 'POST', "/v1/accounts/{$accountId}/external_accounts", [
          'external_account' => array_merge([
            'object'              => 'bank_account',
            'country'             => $country,
            'currency'            => $currency,
            'account_holder_name' => $sup['companyName'],
            'account_holder_type' => 'individual',
          ], $bank),
        ]);
      } catch (Throwable $e) {
        line("    (couldn't attach test bank automatically: {$e->getMessage()})");
      }
    }
  }

  return stripeApi($secret, 'GET', "/v1/accounts/{$accountId}");
}

// A supplier can receive a transfer once its `transfers` capability is active.
function transfersActive(array $account): bool {
  return ($account['capabilities']['transfers'] ?? '') === 'active';
}

$needsOnboarding = [];
foreach ($suppliers as $sid => &$sup) {
  line("Supplier {$sid} ({$sup['companyName']}):");
  $account = ensureAccount($secret, $country, $currency, $bank, $pdo, $sup);
  $sup['stripeAccountId'] = $account['id'];

  $ok = transfersActive($account);
  $pdo->prepare('UPDATE supplier SET payoutsEnabled = :e WHERE supplierId = :s')
      ->execute(['e' => !empty($account['payouts_enabled']) ? 1 : 0, 's' => $sid]);

  if ($ok) {
    line("  ✓ account {$account['id']} — transfers ENABLED" .
         (!empty($account['payouts_enabled']) ? ', payouts enabled' : ''));
  } else {
    // Build a hosted onboarding link so the user can finish in the browser.
    $appUrl = rtrim($config['app_url'] ?? 'http://localhost:5173', '/');
    try {
      $link = stripeApi($secret, 'POST', '/v1/account_links', [
        'account'     => $account['id'],
        'refresh_url' => $appUrl . '/payouts?refresh=1',
        'return_url'  => $appUrl . '/payouts?done=1',
        'type'        => 'account_onboarding',
      ]);
      $needsOnboarding[$sid] = $link['url'];
      $due = implode(', ', $account['requirements']['currently_due'] ?? []);
      line("  … needs onboarding (still due: " . ($due ?: 'verification') . ")");
    } catch (Throwable $e) {
      $needsOnboarding[$sid] = '(could not create onboarding link: ' . $e->getMessage() . ')';
    }
  }
}
unset($sup);
rule();

if ($needsOnboarding) {
  line("Some accounts need a quick onboarding step. Open each link, click");
  line("through Stripe's TEST pages (use the autofill/skip test options), then");
  line("RUN THIS SCRIPT AGAIN to complete the purchase:\n");
  foreach ($needsOnboarding as $sid => $url) {
    line("  {$sid}:  {$url}");
  }
  line("\nNo charge was made. Re-run once the links above are done.");
  exit(0);
}

// ── 3. The commission rate (what the platform/admin keeps) ─────
$rate = (float) ($pdo->query(
  "SELECT commissionRateValue FROM commission
    WHERE commissionStatus = 'Active' AND effectiveDate <= NOW()
    ORDER BY effectiveDate DESC LIMIT 1"
)->fetchColumn() ?: 0.0);
line("Commission rate  : {$rate}%  (kept by the platform/admin)");

// A customer to attribute the order to.
$customerId = $pdo->query("SELECT customerId FROM customer ORDER BY customerId LIMIT 1")->fetchColumn();
if (!$customerId) bail("No customer found. Import seed_multi_supplier.sql (it creates one).");

// ── 4. Build the cart & the per-supplier split ────────────────
$cart = [];           // one line per supplier
$total = 0.0;
foreach ($suppliers as $sid => $sup) {
  $qty   = 1;
  $price = (float) $sup['productPrice'];
  $gross = round($price * $qty, 2);
  $commission = round($gross * $rate / 100, 2);
  $net   = round($gross - $commission, 2);
  $total += $gross;
  $cart[$sid] = [
    'sup' => $sup, 'qty' => $qty, 'price' => $price,
    'gross' => $gross, 'commission' => $commission, 'net' => $net,
  ];
}

// Generate the order IDs up front (we need orderId as the Stripe transfer_group).
$orderId   = nextId($pdo, 'order', 'orderId', 'ORD');
$paymentId = nextId($pdo, 'payment', 'paymentId', 'PAY');

line('');
line("Customer {$customerId} buys order {$orderId}:");
foreach ($cart as $sid => $c) {
  line(sprintf('  • %-22s %s ×%d  →  gross %s', $c['sup']['productName'], money($c['price'], $currency), $c['qty'], money($c['gross'], $currency)));
}
line('  ' . str_repeat('-', 40));
line('  Order total      : ' . money($total, $currency));
rule();

// ── 5. Customer pays the PLATFORM once (test card) ────────────
line('Charging the customer on the platform (test card pm_card_visa)…');
try {
  $pi = stripeApi($secret, 'POST', '/v1/payment_intents', [
    'amount'              => minor($total),
    'currency'            => $currency,
    'payment_method'      => 'pm_card_visa',         // shared Stripe test card
    'payment_method_types'=> ['card'],
    'confirm'             => 'true',
    'description'         => "ShoeAR test order {$orderId}",
    'transfer_group'      => $orderId,
    'metadata'           => ['orderId' => $orderId],
  ]);
} catch (Throwable $e) {
  bail("Charge failed: {$e->getMessage()}");
}
if (($pi['status'] ?? '') !== 'succeeded') {
  bail("Charge not completed (status: " . ($pi['status'] ?? '?') . ").");
}
$chargeId = is_array($pi['latest_charge'] ?? null) ? $pi['latest_charge']['id'] : ($pi['latest_charge'] ?? null);
line("  ✓ paid — payment_intent {$pi['id']}, charge {$chargeId}");

// ── 6. Write the order + transfer each supplier their net ─────
$pdo->beginTransaction();
try {
  $pdo->prepare(
    "INSERT INTO `order` (orderId, customerId, orderDate, orderStatus, orderTotalAmount, orderDeliveryAddress)
     VALUES (:id, :cid, NOW(), 'Paid', :total, :addr)"
  )->execute([
    'id' => $orderId, 'cid' => $customerId, 'total' => $total,
    'addr' => 'Demo address (Stripe payout test)',
  ]);

  $pdo->prepare(
    "INSERT INTO payment (paymentId, orderId, transactionId, paymentMethod, paymentAmount, paymentDate, paymentStatus)
     VALUES (:pid, :oid, :txn, 'Stripe', :amt, NOW(), 'Successful')"
  )->execute(['pid' => $paymentId, 'oid' => $orderId, 'txn' => $pi['id'], 'amt' => $total]);

  foreach ($cart as $sid => $c) {
    $oitId = nextId($pdo, 'order_item', 'orderItemId', 'OIT');
    $pdo->prepare(
      "INSERT INTO order_item (orderItemId, orderId, productVariantId, orderSize, orderQuantity, orderUnitPrice, orderSubtotal)
       VALUES (:oi, :oid, :var, :size, :qty, :price, :sub)"
    )->execute([
      'oi' => $oitId, 'oid' => $orderId, 'var' => $c['sup']['productVariantId'],
      'size' => $c['sup']['size'], 'qty' => $c['qty'], 'price' => $c['price'], 'sub' => $c['gross'],
    ]);

    // Atomic stock decrement (won't go below zero).
    $pdo->prepare(
      "UPDATE product_variant SET stockQuantity = stockQuantity - :q
        WHERE productVariantId = :v AND stockQuantity >= :q"
    )->execute(['q' => $c['qty'], 'v' => $c['sup']['productVariantId']]);

    // The actual money movement: platform → supplier (their net).
    $payoutId = nextId($pdo, 'supplier_payout', 'payoutId', 'PYT');
    $status = 'Failed'; $transferId = null;
    try {
      $transfer = stripeApi($secret, 'POST', '/v1/transfers', [
        'amount'             => minor($c['net']),
        'currency'           => $currency,
        'destination'        => $c['sup']['stripeAccountId'],
        'source_transaction' => $chargeId,           // draw from this charge
        'transfer_group'     => $orderId,
        'metadata'          => ['orderId' => $orderId, 'supplierId' => $sid],
      ]);
      $transferId = $transfer['id'];
      $status = 'Paid';
      line(sprintf('  → %-8s net %s transferred  (commission %s kept)  [%s]',
        $sid, money($c['net'], $currency), money($c['commission'], $currency), $transferId));
    } catch (Throwable $e) {
      line("  ✗ transfer to {$sid} failed: {$e->getMessage()}");
    }

    $pdo->prepare(
      "INSERT INTO supplier_payout
         (payoutId, supplierId, orderId, stripeTransferId, grossAmount, commissionAmount, netAmount, currency, payoutStatus)
       VALUES (:pid, :sid, :oid, :tr, :gross, :comm, :net, :cur, :st)"
    )->execute([
      'pid' => $payoutId, 'sid' => $sid, 'oid' => $orderId, 'tr' => $transferId,
      'gross' => $c['gross'], 'comm' => $c['commission'], 'net' => $c['net'],
      'cur' => $currency, 'st' => $status,
    ]);
  }

  $pdo->commit();
} catch (Throwable $e) {
  $pdo->rollBack();
  bail("Database write failed (charge succeeded on Stripe though): {$e->getMessage()}");
}

// ── 7. Summary ────────────────────────────────────────────────
$totalCommission = array_sum(array_column($cart, 'commission'));
$totalNet        = array_sum(array_column($cart, 'net'));
rule();
line('  DONE — money split in Stripe test mode');
rule();
line('  Customer paid (platform) : ' . money($total, $currency));
line('  Admin commission kept    : ' . money($totalCommission, $currency));
line('  Paid out to suppliers    : ' . money($totalNet, $currency));
line('');
line('  Verify it:');
line('   • Stripe Dashboard → Connect → Accounts → each supplier has a balance');
line('   • Stripe Dashboard → Payments shows the customer charge');
line("   • App report (admin) : GET /admin/reports/commission");
line("   • App report (each supplier) : GET /reports/sales");
line("   • Database: SELECT * FROM supplier_payout WHERE orderId = '{$orderId}';");
rule();
