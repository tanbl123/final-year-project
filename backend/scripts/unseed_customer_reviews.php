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
require __DIR__ . '/seed_comments.php';   // shared pool of seeded comment phrases

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

// Delete reviews whose comment is one of the seeded phrases (leaving genuine
// reviews the customer wrote themselves).
$comments = allSeedComments();
$ph = implode(',', array_fill(0, count($comments), '?'));
$del = $pdo->prepare(
  "DELETE FROM review WHERE customerId = ? AND reviewComment IN ($ph)"
);
$del->execute(array_merge([$customerId], $comments));

echo "Deleted {$del->rowCount()} seeded review(s) for {$email} (customer {$customerId}).\n";

// Reload the recommender so the removal takes effect immediately. Best-effort.
$config = require __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/sweeps.php';
if (trim($config['ml_service_url'] ?? '') === '') {
  echo "ℹ Restart the ML service (or POST /reload) so 'Recommended for you' updates.\n";
} elseif (sweepReloadRecommender($config)) {
  echo "♻ Recommender reloaded — recommendations updated.\n";
} else {
  echo "⚠ Couldn't reach the ML service to reload (is it running?). POST /reload to apply.\n";
}
