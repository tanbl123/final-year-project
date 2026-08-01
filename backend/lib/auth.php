<?php
// Authentication / authorization middleware.

// Verify the JWT from the Authorization header. Returns the payload, or 401s.
function requireAuth(string $secret): array {
  $token = getBearerToken();
  if (!$token) {
    sendJson(401, false, null, ['code' => 'NO_TOKEN', 'message' => 'Missing authentication token.']);
  }
  $payload = jwt_decode($token, $secret);
  if (!$payload) {
    sendJson(401, false, null, ['code' => 'BAD_TOKEN', 'message' => 'Invalid or expired token.']);
  }
  return $payload;   // ['userId' => ..., 'role' => ..., 'exp' => ...]
}

// Ensure the caller is an Admin (or 403).
function requireAdmin(array $auth): void {
  if (($auth['role'] ?? '') !== 'Admin') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Admin access only.']);
  }
}

// Ensure the caller is INTERNAL STAFF — Admin or AR Specialist (or 403). Used on
// the AR-preparation routes (auto-fit, lens, product detail, AR queue) that both
// roles share; listing approval (approve/reject) stays Admin-only.
function requireStaff(array $auth): void {
  $role = $auth['role'] ?? '';
  if ($role !== 'Admin' && $role !== 'ArSpecialist') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Staff access only.']);
  }
}

// Ensure the caller is an AR Specialist and return their id (or 403).
function requireArSpecialistId(PDO $pdo, array $auth): string {
  if (($auth['role'] ?? '') !== 'ArSpecialist') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'AR Specialist access only.']);
  }
  $stmt = $pdo->prepare('SELECT arSpecialistId FROM ar_specialist WHERE userId = :userId');
  $stmt->execute(['userId' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(403, false, null, ['code' => 'NO_AR_SPECIALIST', 'message' => 'No AR specialist profile for this user.']);
  }
  return $row['arSpecialistId'];
}

// Ensure the caller is a Customer and return their customerId (or 403).
function requireCustomerId(PDO $pdo, array $auth): string {
  if (($auth['role'] ?? '') !== 'Customer') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Customer access only.']);
  }
  $stmt = $pdo->prepare('SELECT customerId FROM customer WHERE userId = :userId');
  $stmt->execute(['userId' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(403, false, null, ['code' => 'NO_CUSTOMER', 'message' => 'No customer profile for this user.']);
  }
  return $row['customerId'];
}

// Ensure the caller is Delivery Personnel and return their id (or 403).
function requireDeliveryPersonnelId(PDO $pdo, array $auth): string {
  if (($auth['role'] ?? '') !== 'DeliveryPersonnel') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Delivery personnel access only.']);
  }
  $stmt = $pdo->prepare('SELECT deliveryPersonnelId FROM delivery_personnel WHERE userId = :userId');
  $stmt->execute(['userId' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(403, false, null, ['code' => 'NO_COURIER', 'message' => 'No delivery profile for this user.']);
  }
  return $row['deliveryPersonnelId'];
}

// Ensure the caller is a Supplier and return their supplierId (or 403).
function requireSupplierId(PDO $pdo, array $auth): string {
  if (($auth['role'] ?? '') !== 'Supplier') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Supplier access only.']);
  }
  $stmt = $pdo->prepare('SELECT supplierId FROM supplier WHERE userId = :userId');
  $stmt->execute(['userId' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(403, false, null, ['code' => 'NO_SUPPLIER', 'message' => 'No supplier profile for this user.']);
  }
  return $row['supplierId'];
}
