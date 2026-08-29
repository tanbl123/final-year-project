<?php
// ─────────────────────────────────────────────────────────────────────
// Remove the moderation demo data created by seed_moderation_demo.php.
// Safe: it only touches accounts whose email ends in '@moderation.seed'.
// Their customer rows, reviews, content_flag rows (reporter/target) and the
// account_appeal all disappear automatically via ON DELETE CASCADE.
//
//   php backend/scripts/unseed_moderation_demo.php
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';

const SEED_DOMAIN = '@moderation.seed';

$pdo = getPDO();

$find = $pdo->prepare("SELECT userId, username FROM `user` WHERE email LIKE :d");
$find->execute(['d' => '%' . SEED_DOMAIN]);
$rows = $find->fetchAll();

if (!$rows) {
  echo "Nothing to remove — no '@moderation.seed' accounts found.\n";
  exit(0);
}

$del = $pdo->prepare("DELETE FROM `user` WHERE userId = :id");
$n = 0;
foreach ($rows as $r) {
  $del->execute(['id' => $r['userId']]);
  $n++;
  echo "  - removed  {$r['username']}  ({$r['userId']})\n";
}

echo "\n🧹 Removed $n seeded moderation account(s). Flagged + Appeals queues are clean again.\n";
