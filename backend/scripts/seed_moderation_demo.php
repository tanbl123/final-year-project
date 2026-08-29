<?php
// ─────────────────────────────────────────────────────────────────────
// Seed demo data for the admin MODERATION screens so they have something
// to show for UI screenshots:
//   • Admin ▸ Flagged  (GET /admin/flags)   — 1 reported review + 1 reported avatar
//   • Admin ▸ Appeals  (GET /admin/appeals)  — 1 suspended user's open appeal
//
//   php backend/scripts/seed_moderation_demo.php
//
// Self-contained: it creates its own demo CUSTOMER accounts (a reporter, a
// reported reviewer, a reported-avatar user, and a suspended user) so it does
// not touch any of your real users. The review flag is attached to a real
// existing product so the card shows the product + comment.
//
// REMOVABLE: every seeded login uses the '@moderation.seed' email domain.
// Remove everything (users + their reviews/flags/appeal cascade away) with:
//   php backend/scripts/unseed_moderation_demo.php
//
// Idempotent: re-running skips accounts that already exist.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const SEED_DOMAIN   = '@moderation.seed';
const SEED_PASSWORD = 'Moderation@1234';

$pdo  = getPDO();
$hash = password_hash(SEED_PASSWORD, PASSWORD_BCRYPT);

// Create a demo user (+ a customer row). Returns [userId, customerId] or the
// existing userId if already seeded. $extra overrides columns (status, etc.).
function makeCustomer(PDO $pdo, string $hash, string $username, string $fullName,
                      string $phone, array $extra = []): ?array {
  $email = $username . SEED_DOMAIN;
  $chk = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
  $chk->execute(['u' => $username, 'e' => $email]);
  if ($existing = $chk->fetchColumn()) {
    $c = $pdo->prepare('SELECT customerId FROM customer WHERE userId = :u');
    $c->execute(['u' => $existing]);
    return [$existing, $c->fetchColumn() ?: null, true];   // already there
  }

  $userId = nextId($pdo, 'user', 'userId', 'USR');
  $cusId  = nextId($pdo, 'customer', 'customerId', 'CUS');
  $status    = $extra['status']    ?? 'Active';
  $avatarUrl = $extra['avatarUrl'] ?? null;
  $rejReason = $extra['rejectionReason'] ?? null;

  $pdo->prepare(
    "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, avatarUrl, role, status, rejectionReason)
     VALUES (:id, :u, :pw, :e, :fn, :ph, :av, 'Customer', :st, :rr)"
  )->execute(['id' => $userId, 'u' => $username, 'pw' => $hash, 'e' => $email,
              'fn' => $fullName, 'ph' => $phone, 'av' => $avatarUrl, 'st' => $status, 'rr' => $rejReason]);
  $pdo->prepare('INSERT INTO customer (customerId, userId) VALUES (:c, :u)')
      ->execute(['c' => $cusId, 'u' => $userId]);
  return [$userId, $cusId, false];
}

$pdo->beginTransaction();
try {
  // ── the four demo people ───────────────────────────────────────────
  [$reporterId]              = makeCustomer($pdo, $hash, 'mod_reporter', 'Jason Teo Kah Wai', '0129900001');
  [$reviewerId, $reviewerCus] = makeCustomer($pdo, $hash, 'mod_reviewer', 'Kevin Loh Zhi Hao', '0129900002');
  [$avatarUserId]            = makeCustomer($pdo, $hash, 'mod_avatar', 'Bella Ng Sze Ying', '0129900003',
      ['avatarUrl' => 'https://ui-avatars.com/api/?name=Bella+Ng&background=E74C3C&color=fff&size=128']);
  [$suspendedId]            = makeCustomer($pdo, $hash, 'mod_suspended', 'Derek Wong Jun Kit', '0129900004',
      ['status' => 'Suspended', 'rejectionReason' => 'Multiple customer reports of abusive reviews.']);

  // ── 1) reported REVIEW — needs a real product to hang the review on ─
  $productId = $pdo->query("SELECT productId FROM product ORDER BY productId LIMIT 1")->fetchColumn();
  if ($productId && $reviewerCus) {
    // avoid the one-review-per-customer-per-product unique clash on re-run
    $has = $pdo->prepare('SELECT reviewId FROM review WHERE customerId = :c AND productId = :p');
    $has->execute(['c' => $reviewerCus, 'p' => $productId]);
    $reviewId = $has->fetchColumn();
    if (!$reviewId) {
      $reviewId = nextId($pdo, 'review', 'reviewId', 'REV');
      $pdo->prepare(
        "INSERT INTO review (reviewId, customerId, productId, ratingScore, reviewComment, reviewStatus)
         VALUES (:r, :c, :p, 1, :cm, 'Published')"
      )->execute(['r' => $reviewId, 'c' => $reviewerCus, 'p' => $productId,
                  'cm' => 'This seller is a total scammer and an idiot. Absolute garbage, do not waste your money here.']);
    }
    // flag the review (reporter → reviewer)
    if (!flagExists($pdo, $reporterId, $reviewerId, $reviewId)) {
      insertFlag($pdo, $reporterId, $reviewerId, $reviewId, 'Abusive language and insults in the review');
    }
  } else {
    echo "  (no product found — skipping the reported-review flag; the avatar flag still seeds)\n";
  }

  // ── 2) reported AVATAR (reviewId NULL) — reporter → avatar user ─────
  if (!flagExists($pdo, $reporterId, $avatarUserId, null)) {
    insertFlag($pdo, $reporterId, $avatarUserId, null, 'Inappropriate / offensive profile photo');
  }

  // ── 3) suspension APPEAL — the suspended user submits an open appeal ─
  $openAppeal = $pdo->prepare("SELECT 1 FROM account_appeal WHERE userId = :u AND appealStatus = 'Open' LIMIT 1");
  $openAppeal->execute(['u' => $suspendedId]);
  if (!$openAppeal->fetchColumn()) {
    $appealId = nextId($pdo, 'account_appeal', 'appealId', 'APL');
    $pdo->prepare(
      "INSERT INTO account_appeal (appealId, userId, message, appealStatus)
       VALUES (:a, :u, :m, 'Open')"
    )->execute(['a' => $appealId, 'u' => $suspendedId,
      'm' => 'I believe my suspension was a misunderstanding. My reviews were honest feedback about the '
           . 'product quality and I did not intend to break any community rules. I would really appreciate '
           . 'a review of my account and another chance to keep using ShoeAR. Thank you.']);
  }

  $pdo->commit();
} catch (Throwable $e) {
  $pdo->rollBack();
  echo 'Seed failed: ' . $e->getMessage() . "\n";
  exit(1);
}

// confirm what the admin queues will now show
$flags   = $pdo->query("SELECT COUNT(*) FROM content_flag  WHERE flagStatus='Open'")->fetchColumn();
$appeals = $pdo->query("SELECT COUNT(*) FROM account_appeal WHERE appealStatus='Open'")->fetchColumn();
echo "\n✅ Moderation demo seeded.\n";
echo "   Flagged content — open flags now in DB : $flags\n";
echo "   Suspension appeals — open appeals now  : $appeals\n";
echo "   Refresh Admin ▸ Flagged and Admin ▸ Appeals.\n";
echo "   Remove later with: php backend/scripts/unseed_moderation_demo.php\n";

// ── helpers ──────────────────────────────────────────────────────────
function flagExists(PDO $pdo, string $rep, string $tgt, ?string $rev): bool {
  if ($rev === null) {
    $s = $pdo->prepare("SELECT 1 FROM content_flag WHERE reporterUserId=:r AND targetUserId=:t AND reviewId IS NULL LIMIT 1");
    $s->execute(['r' => $rep, 't' => $tgt]);
  } else {
    $s = $pdo->prepare("SELECT 1 FROM content_flag WHERE reporterUserId=:r AND targetUserId=:t AND reviewId=:v LIMIT 1");
    $s->execute(['r' => $rep, 't' => $tgt, 'v' => $rev]);
  }
  return (bool) $s->fetchColumn();
}
function insertFlag(PDO $pdo, string $rep, string $tgt, ?string $rev, string $reason): void {
  $flagId = nextId($pdo, 'content_flag', 'flagId', 'FLG');
  $pdo->prepare(
    "INSERT INTO content_flag (flagId, reporterUserId, targetUserId, reviewId, reason, flagStatus)
     VALUES (:f, :r, :t, :v, :reason, 'Open')"
  )->execute(['f' => $flagId, 'r' => $rep, 't' => $tgt, 'v' => $rev, 'reason' => $reason]);
}
