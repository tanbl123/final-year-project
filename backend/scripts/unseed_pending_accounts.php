<?php
// ─────────────────────────────────────────────────────────────────────
// Remove the demo PENDING supplier + courier accounts created by
// seed_pending_accounts.php. Safe: it only ever touches accounts whose
// email ends in '@pending.seed', so real applicants are never affected.
// The supplier / delivery_personnel detail rows go automatically via the
// ON DELETE CASCADE foreign key on userId.
//
//   php backend/scripts/unseed_pending_accounts.php
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';

const SEED_DOMAIN = '@pending.seed';

$pdo = getPDO();

$find = $pdo->prepare(
  "SELECT userId, username, role FROM `user`
    WHERE email LIKE :d AND role IN ('Supplier','DeliveryPersonnel')"
);
$find->execute(['d' => '%' . SEED_DOMAIN]);
$rows = $find->fetchAll();

if (!$rows) {
  echo "Nothing to remove — no '@pending.seed' accounts found.\n";
  exit(0);
}

$del = $pdo->prepare("DELETE FROM `user` WHERE userId = :id");
$n = 0;
foreach ($rows as $r) {
  $del->execute(['id' => $r['userId']]);
  $n++;
  echo "  - removed {$r['role']}  {$r['username']}  ({$r['userId']})\n";
}

echo "\n🧹 Removed $n seeded pending account(s). The approval queues are clean again.\n";
