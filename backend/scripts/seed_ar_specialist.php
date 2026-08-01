<?php
// ─────────────────────────────────────────────────────────────────────
// Create a test AR Specialist account, so you can log into the web staff
// portal and exercise the AR preparation workflow. An AR Specialist is two
// rows: a `user` row (the login) + an `ar_specialist` row (marks the role).
//
//   php backend/scripts/seed_ar_specialist.php
//
// Login afterwards (at the STAFF login, same page as admin):
//   username 'arspecialist'  /  password below.
// Idempotent: if the account already exists it does nothing.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const ARS_USERNAME = 'arspecialist';
const ARS_PASSWORD = 'ArSpec@1234';   // change after first login
const ARS_EMAIL    = 'ar@shoear.test';
const ARS_NAME      = 'AR Specialist';

$pdo = getPDO();

// already there?
$stmt = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
$stmt->execute(['u' => ARS_USERNAME, 'e' => ARS_EMAIL]);
$existing = $stmt->fetchColumn();
if ($existing) {
  echo "AR Specialist already exists (userId $existing). Nothing to do.\n";
  exit(0);
}

$userId = nextId($pdo, 'user', 'userId', 'USR');
$arsId  = nextId($pdo, 'ar_specialist', 'arSpecialistId', 'ARS');
$hash   = password_hash(ARS_PASSWORD, PASSWORD_BCRYPT);

$pdo->beginTransaction();
try {
  $pdo->prepare(
    "INSERT INTO `user` (userId, username, password, email, fullName, role, status)
     VALUES (:id, :u, :pw, :e, :fn, 'ArSpecialist', 'Active')"
  )->execute(['id' => $userId, 'u' => ARS_USERNAME, 'pw' => $hash, 'e' => ARS_EMAIL, 'fn' => ARS_NAME]);

  $pdo->prepare('INSERT INTO ar_specialist (arSpecialistId, userId) VALUES (:aid, :uid)')
      ->execute(['aid' => $arsId, 'uid' => $userId]);
  $pdo->commit();
} catch (Throwable $e) {
  $pdo->rollBack();
  echo 'Failed to create AR Specialist: ' . $e->getMessage() . "\n";
  exit(1);
}

echo "✅ AR Specialist created.\n";
echo "   Login username: " . ARS_USERNAME . "\n";
echo "   Login password: " . ARS_PASSWORD . "  (please change after first login)\n";
