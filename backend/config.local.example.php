<?php
// ─────────────────────────────────────────────────────────────
// LOCAL SECRETS — this is a TEMPLATE and is committed, so it must NEVER hold a
// real key. COPY this file to "config.local.php" (same folder) and put your
// real keys in THAT copy — config.local.php is gitignored, so it never gets
// committed. Any key in config.local.php overrides the matching key in config.php.
// ─────────────────────────────────────────────────────────────
return [
  // Your Stripe TEST secret key — Dashboard → Developers → API keys →
  // "Reveal test key" (starts with sk_test_). Put the REAL value in
  // config.local.php, not here.
  'stripe_secret' => 'sk_test_REPLACE_ME',

  // Only if your React app runs somewhere other than the default:
  // 'app_url' => 'http://localhost:5173',

  // Optional: override the FAKE test bank account the payout demo attaches to
  // each supplier (only needed if Stripe rejects the built-in default for your
  // country — see Stripe's "test bank account numbers" docs).
  // 'demo_bank' => ['routing_number' => '110000000', 'account_number' => '000123456789'],
];
