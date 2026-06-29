<?php
// Quick check: which Stripe (test) account do my keys point at?
// Prints the account's country + currency (which decide the test bank number to
// use during courier/supplier onboarding and the payout currency) and whether
// charges/payouts are enabled — also a fast "is my Stripe key working?" test.
//
//   php backend/scripts/stripe_whoami.php
//
// Reads backend/config.php (which merges in backend/config.local.php).

require __DIR__ . '/../lib/stripe.php';
$config = require __DIR__ . '/../config.php';

if (!stripeConfigured($config)) {
  fwrite(STDERR, "No 'stripe_secret' found in config. Add it to backend/config.local.php.\n");
  exit(1);
}

try {
  $a = stripeApi($config['stripe_secret'], 'GET', '/v1/account');
} catch (Throwable $e) {
  fwrite(STDERR, 'Stripe call failed: ' . $e->getMessage() . "\n");
  exit(1);
}

$country  = $a['country'] ?? '?';
$currency = strtoupper($a['default_currency'] ?? '?');

echo "Stripe account : " . ($a['id'] ?? '?') . "\n";
echo "Country        : $country\n";
echo "Currency       : $currency\n";
echo "Charges enabled: " . (!empty($a['charges_enabled']) ? 'yes' : 'no') . "\n";
echo "Payouts enabled: " . (!empty($a['payouts_enabled']) ? 'yes' : 'no') . "\n";

// Remind which test bank to use during hosted onboarding.
$banks = [
  'MY' => 'routing MBBEMYKL, account 000123456000',
  'US' => 'routing 110000000, account 000123456789',
  'GB' => 'sort code 108800, account 00012345',
  'SG' => 'bank/branch 1100-000, account 000123456',
  'AU' => 'BSB 110000, account 000123456',
];
if (isset($banks[$country])) {
  echo "\nTest bank for onboarding ($country): {$banks[$country]}\n";
}
