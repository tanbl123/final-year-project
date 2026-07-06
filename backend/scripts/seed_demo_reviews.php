<?php
// ─────────────────────────────────────────────────────────────────────
// Seed demo customers + PREFERENCE-CLUSTERED reviews.
//
// The recommender's collaborative (SVD) side needs ratings with real signal.
// This creates one "fan" customer per product category and has each fan rate
// EVERY approved product high for their own category and low for others — so
// SVD can learn category-affinity factors and "Recommended for you" becomes
// genuinely personalized (a running fan gets running shoes, etc.).
//
// Deliberately NOT all-5-star (that inflation is what breaks CF) — high for the
// preferred category, low/medium for the rest, with a little variance.
//
// Idempotent: re-running reuses existing demo customers and updates their
// ratings; it never duplicates. Safe to run before AND after a database wipe.
//
//   php backend/scripts/seed_demo_reviews.php
//
// After running, refresh the model:  POST http://127.0.0.1:5001/reload
// (or restart the Flask service). Demo customers can log in with password below.

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const DEMO_PASSWORD = 'Demo@1234';   // every demo customer logs in with this

// Comment sentinels stamped on every seeded review, so the unseed script can
// find and remove ONLY seeded reviews (leaving any genuine ones). Keep these in
// sync with unseed_customer_reviews.php.
const SEED_COMMENT_LIKE = 'Love this — exactly my style.';
const SEED_COMMENT_MEH  = 'Not really my type.';

// Optional args:
//   php seed_demo_reviews.php [customerEmail] [PreferredCategory]
// If a customer email is given, that specific customer (e.g. your Google-login
// account) is ALSO seeded with a clear single-category preference, so their
// "Recommended for you" is visibly personalized. Remove later with
// unseed_customer_reviews.php.
// Pass --no-fans to skip the synthetic demo-fan customers and seed ONLY the
// target customer(s) — handy when you use two REAL accounts to activate CF and
// don't want fake accounts in the admin Users list. (Run once per real email.)
$noFans       = in_array('--no-fans', $argv, true);
$positional   = array_values(array_filter(array_slice($argv, 1), fn($a) => $a !== '--no-fans'));
$targetEmail  = trim($positional[0] ?? '');
$preferredArg = trim($positional[1] ?? '');

$pdo = getPDO();

// 1. Approved products grouped by category ------------------------------------
$products = $pdo->query(
  "SELECT p.productId, c.categoryName
     FROM product p JOIN category c ON c.categoryId = p.categoryId
    WHERE p.productStatus = 'Approved'
    ORDER BY p.productId"
)->fetchAll(PDO::FETCH_ASSOC);

if (count($products) < 2) {
  echo "Need at least 2 approved products to seed reviews (found " . count($products) . ").\n";
  echo "Add some products first, then re-run.\n";
  exit(1);
}

$categories = [];
foreach ($products as $p) { $categories[$p['categoryName']] = true; }
$categories = array_keys($categories);
echo "Products: " . count($products) . " | Categories: " . implode(', ', $categories) . "\n";

$hash = password_hash(DEMO_PASSWORD, PASSWORD_BCRYPT);
mt_srand(42); // reproducible variance

// 2. One demo "fan" customer per category (skipped with --no-fans) ------------
$fans = []; // categoryName => customerId
foreach (($noFans ? [] : $categories) as $i => $cat) {
  $slug     = strtolower(preg_replace('/[^a-z0-9]+/i', '', $cat)) ?: ('cat' . $i);
  $username = 'demo_' . $slug;
  $email    = $username . '@shoear.test';
  $fullName = 'Demo ' . $cat . ' Fan';

  // reuse if this demo user already exists
  $stmt = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
  $stmt->execute(['u' => $username, 'e' => $email]);
  $userId = $stmt->fetchColumn();

  if (!$userId) {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $pdo->prepare(
      "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :u, :pw, :e, :fn, :ph, 'Customer', 'Active')"
    )->execute(['id' => $userId, 'u' => $username, 'pw' => $hash, 'e' => $email,
                'fn' => $fullName, 'ph' => '0120000' . str_pad((string) $i, 3, '0', STR_PAD_LEFT)]);
  }

  // ensure a customer row for this user
  $stmt = $pdo->prepare('SELECT customerId FROM customer WHERE userId = :uid');
  $stmt->execute(['uid' => $userId]);
  $customerId = $stmt->fetchColumn();
  if (!$customerId) {
    $customerId = nextId($pdo, 'customer', 'customerId', 'CUS');
    $pdo->prepare('INSERT INTO customer (customerId, userId, shippingAddress) VALUES (:cid, :uid, NULL)')
        ->execute(['cid' => $customerId, 'uid' => $userId]);
  }
  $fans[$cat] = ['customerId' => $customerId, 'username' => $username];
}

// 3. Each fan rates every product (high for own category, low for others) -----
$findReview = $pdo->prepare('SELECT reviewId FROM review WHERE customerId = :c AND productId = :p');
$insReview  = $pdo->prepare(
  "INSERT INTO review (reviewId, customerId, productId, ratingScore, reviewComment, reviewStatus)
   VALUES (:id, :c, :p, :r, :cm, 'Published')"
);
$updReview  = $pdo->prepare('UPDATE review SET ratingScore = :r WHERE reviewId = :id');

$inserted = 0; $updated = 0;
foreach ($fans as $cat => $fan) {
  foreach ($products as $p) {
    $isPreferred = ($p['categoryName'] === $cat);
    // preferred: 4–5, others: 2–3 (a little variance, never uniformly 5)
    $rating  = $isPreferred ? (4 + mt_rand(0, 1)) : (2 + mt_rand(0, 1));
    $comment = $isPreferred ? SEED_COMMENT_LIKE : SEED_COMMENT_MEH;

    $findReview->execute(['c' => $fan['customerId'], 'p' => $p['productId']]);
    $existingId = $findReview->fetchColumn();
    if ($existingId) {
      $updReview->execute(['r' => $rating, 'id' => $existingId]);
      $updated++;
    } else {
      $rid = nextId($pdo, 'review', 'reviewId', 'REV');
      $insReview->execute(['id' => $rid, 'c' => $fan['customerId'], 'p' => $p['productId'],
                           'r' => $rating, 'cm' => $comment]);
      $inserted++;
    }
  }
}

// 3b. Optionally seed a specific real customer (e.g. your Google-login account)
//     with a clear single-category preference, so their recommendations are
//     visibly personalized during the demo. -----------------------------------
if ($targetEmail !== '') {
  $preferred = $preferredArg !== '' ? $preferredArg : ($categories[0] ?? '');
  $stmt = $pdo->prepare(
    'SELECT c.customerId FROM customer c JOIN `user` u ON u.userId = c.userId WHERE u.email = :e'
  );
  $stmt->execute(['e' => $targetEmail]);
  $targetCid = $stmt->fetchColumn();

  if (!$targetCid) {
    echo "\n⚠ No customer found with email {$targetEmail}.\n";
    echo "  Log in via Google as that customer first, THEN re-run with the email.\n";
  } elseif (!in_array($preferred, $categories, true)) {
    echo "\n⚠ '{$preferred}' isn't a known category. Choose one of: " . implode(', ', $categories) . "\n";
  } else {
    $ti = 0; $tu = 0;
    foreach ($products as $p) {
      $isPreferred = ($p['categoryName'] === $preferred);
      $rating  = $isPreferred ? (4 + mt_rand(0, 1)) : (2 + mt_rand(0, 1));
      $comment = $isPreferred ? SEED_COMMENT_LIKE : SEED_COMMENT_MEH;
      $findReview->execute(['c' => $targetCid, 'p' => $p['productId']]);
      $existingId = $findReview->fetchColumn();
      if ($existingId) { $updReview->execute(['r' => $rating, 'id' => $existingId]); $tu++; }
      else {
        $rid = nextId($pdo, 'review', 'reviewId', 'REV');
        $insReview->execute(['id' => $rid, 'c' => $targetCid, 'p' => $p['productId'],
                             'r' => $rating, 'cm' => $comment]);
        $ti++;
      }
    }
    echo "\n🎯 Seeded customer {$targetEmail} (prefers {$preferred}): inserted $ti, updated $tu.\n";
    echo "   Remove these later with:\n";
    echo "     php backend/scripts/unseed_customer_reviews.php {$targetEmail}\n";
  }
}

// 4. Summary ------------------------------------------------------------------
$total   = (int) $pdo->query("SELECT COUNT(*) FROM review WHERE reviewStatus = 'Published'")->fetchColumn();
$raters  = (int) $pdo->query("SELECT COUNT(DISTINCT customerId) FROM review WHERE reviewStatus = 'Published'")->fetchColumn();
if ($fans) {
  echo "\nDemo customers (login password: " . DEMO_PASSWORD . "):\n";
  foreach ($fans as $cat => $fan) { echo "  - {$fan['username']}  → prefers {$cat}\n"; }
}
echo "\nReviews inserted: $inserted, updated: $updated. Total published reviews now: $total.\n";
echo "Distinct customers with reviews: $raters.\n";
if ($raters < 2) {
  echo "⚠ CF needs ≥2 customers with reviews — seed a second customer to activate it.\n";
}
echo "\n✅ Done. Now refresh the model:  POST http://127.0.0.1:5001/reload\n";
echo "   Then /health should show cfAvailable: true, and 'Recommended for you'\n";
echo "   will differ per customer (log in as a demo_* user to see it).\n";
