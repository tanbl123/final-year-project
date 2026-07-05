<?php
// ─────────────────────────────────────────────────────────────────────
// Create the first admin account on a fresh (wiped) database, so you can log
// into the web to approve suppliers/products. An admin is two rows: a `user`
// row (the login) + an `admin` row (marks it as admin).
//
//   php backend/scripts/seed_admin.php
//
// Login afterwards:  username 'admin'  /  password below.
// Idempotent: if an admin user already exists it does nothing.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Admin@1234';   // change after first login
const ADMIN_EMAIL    = 'admin@shoear.test';
const ADMIN_NAME     = 'System Admin';

$pdo = getPDO();

// already there?
$stmt = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
$stmt->execute(['u' => ADMIN_USERNAME, 'e' => ADMIN_EMAIL]);
$existing = $stmt->fetchColumn();
if ($existing) {
  echo "Admin already exists (userId $existing). Nothing to do.\n";
  exit(0);
}

$userId  = nextId($pdo, 'user', 'userId', 'USR');
$adminId = nextId($pdo, 'admin', 'adminId', 'ADM');
$hash    = password_hash(ADMIN_PASSWORD, PASSWORD_BCRYPT);

$pdo->beginTransaction();
try {
  $pdo->prepare(
    "INSERT INTO `user` (userId, username, password, email, fullName, role, status)
     VALUES (:id, :u, :pw, :e, :fn, 'Admin', 'Active')"
  )->execute(['id' => $userId, 'u' => ADMIN_USERNAME, 'pw' => $hash, 'e' => ADMIN_EMAIL, 'fn' => ADMIN_NAME]);

  $pdo->prepare('INSERT INTO admin (adminId, userId) VALUES (:aid, :uid)')
      ->execute(['aid' => $adminId, 'uid' => $userId]);
  $pdo->commit();
} catch (Throwable $e) {
  $pdo->rollBack();
  echo 'Failed to create admin: ' . $e->getMessage() . "\n";
  exit(1);
}

echo "✅ Admin created.\n";
echo "   Login username: " . ADMIN_USERNAME . "\n";
echo "   Login password: " . ADMIN_PASSWORD . "  (please change after first login)\n";
