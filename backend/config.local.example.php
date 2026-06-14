<?php
// ─────────────────────────────────────────────────────────────
// LOCAL SECRETS — copy this file to "config.local.php" (same folder) and put
// your real keys in the copy. config.local.php is gitignored, so your keys
// never get committed. Any key here overrides the matching key in config.php.
// ─────────────────────────────────────────────────────────────
return [
  // Your Stripe TEST secret key — Dashboard → Developers → API keys →
  // "Reveal test key" (starts with sk_test_).
  'stripe_secret' => 'sk_test_51TNyboGcnylCxTxKFSOH2W6hb3VM9i0rCCSMkos2zGMYumjBDgGPisBix5sqsKHmMsRR4d8ILNM5aibRJY7q5fMP00W1WYVw2z',

  // Only if your React app runs somewhere other than the default:
  // 'app_url' => 'http://localhost:5173',
];
