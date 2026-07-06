<?php
// ─────────────────────────────────────────────────────────────────────
// Remove the SEEDED demo reviews for one specific customer (by email) — e.g.
// after showing your progress, to clean the fake ratings off your Google-login
// account. Only deletes reviews stamped with the seed comment sentinels, so any
// genuine reviews that customer wrote themselves are left untouched.
//
//   php backend/scripts/unseed_customer_reviews.php you@gmail.com
//
// After running, reload the ML service so the change is reflected.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';

// Must match the sentinels stamped by seed_demo_reviews.php.
const SEED_COMMENT_LIKE = 'Love this — exactly my style.';
const SEED_COMMENT_MEH  = 'Not really my type.';

$email = trim($argv[1] ?? '');
if ($email === '') {
  echo "Usage: php backend/scripts/unseed_customer_reviews.php <customerEmail>\n";
  exit(1);
}

$pdo = getPDO();

$stmt = $pdo->prepare(
  'SELECT c.customerId FROM customer c JOIN `user` u ON u.userId = c.userId WHERE u.email = :e'
);
$stmt->execute(['e' => $email]);
$customerId = $stmt->fetchColumn();

if (!$customerId) {
  echo "No customer found with email {$email}.\n";
  exit(1);
}

$del = $pdo->prepare(
  'DELETE FROM review WHERE customerId = :c AND reviewComment IN (:a, :b)'
);
$del->execute(['c' => $customerId, 'a' => SEED_COMMENT_LIKE, 'b' => SEED_COMMENT_MEH]);

echo "Deleted {$del->rowCount()} seeded review(s) for {$email} (customer {$customerId}).\n";
echo "Now reload the ML service so 'Recommended for you' updates:\n";
echo "  POST http://127.0.0.1:5001/reload  (or restart the service)\n";
