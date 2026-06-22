<?php
// ─────────────────────────────────────────────────────────────────────
// In-app notifications.
//
// createNotification() inserts a row the customer sees in the app's bell, then
// hands off to pushToUser() (backend/lib/push.php) which delivers a real
// background push IF Firebase Cloud Messaging is configured (a swap seam — a
// no-op otherwise). Until FCM is set up the in-app notifications work alone.
//
// Everything here is BEST-EFFORT: a notification must never break the order or
// refund flow that triggered it, so all failures are swallowed.
// ─────────────────────────────────────────────────────────────────────

// Lazily load (and cache) the merged config so callers that lack a $config
// (e.g. recomputeOrderStatus) don't have to thread it through.
function notifConfig(): array {
  static $cfg = null;
  if ($cfg === null) { $cfg = require __DIR__ . '/../config.php'; }
  return $cfg;
}

// Insert one notification for a user, then try a background push.
function createNotification(PDO $pdo, string $userId, string $type, string $title, string $body, ?string $orderId = null): void {
  if ($userId === '') { return; }
  try {
    $id = nextId($pdo, 'notification', 'notificationId', 'NTF');
    $pdo->prepare(
      "INSERT INTO notification (notificationId, userId, type, title, body, orderId, isRead, createdAt)
       VALUES (:id, :uid, :type, :title, :body, :oid, 0, NOW())"
    )->execute([
      'id'    => $id,
      'uid'   => $userId,
      'type'  => $type,
      'title' => mb_substr($title, 0, 120),
      'body'  => mb_substr($body, 0, 255),
      'oid'   => $orderId,
    ]);
  } catch (Throwable $e) {
    return; // never block the caller
  }
  // best-effort real push (no-op unless FCM is configured)
  if (function_exists('pushToUser')) {
    try { pushToUser($pdo, $userId, $title, $body, $orderId); } catch (Throwable $e) { /* ignore */ }
  }
}

// Resolve a customer's userId from a customerId, then notify them.
function notifyCustomerById(PDO $pdo, string $customerId, string $type, string $title, string $body, ?string $orderId = null): void {
  try {
    $stmt = $pdo->prepare('SELECT userId FROM customer WHERE customerId = :cid');
    $stmt->execute(['cid' => $customerId]);
    $userId = $stmt->fetchColumn();
  } catch (Throwable $e) {
    return;
  }
  if ($userId) { createNotification($pdo, (string) $userId, $type, $title, $body, $orderId); }
}

// Resolve the buyer's userId from an orderId, then notify them.
function notifyOrderCustomer(PDO $pdo, string $orderId, string $type, string $title, string $body): void {
  try {
    $stmt = $pdo->prepare(
      'SELECT c.userId FROM `order` o JOIN customer c ON c.customerId = o.customerId WHERE o.orderId = :oid'
    );
    $stmt->execute(['oid' => $orderId]);
    $userId = $stmt->fetchColumn();
  } catch (Throwable $e) {
    return;
  }
  if ($userId) { createNotification($pdo, (string) $userId, $type, $title, $body, $orderId); }
}

// Map an order status to friendly copy and notify the buyer. Called when an
// order actually transitions (deduped by the caller). Unknown statuses are
// ignored so we don't spam on internal-only states.
function notifyOrderStatusChange(PDO $pdo, string $orderId, string $status): void {
  $copy = [
    'Paid'           => ['Payment received',  "We've received your payment for order $orderId."],
    'Shipped'        => ['Order shipped',      "Your order $orderId is on its way."],
    'OutForDelivery' => ['Out for delivery',   "Your order $orderId is out for delivery today."],
    'Delivered'      => ['Order delivered',    "Your order $orderId has been delivered. Enjoy!"],
    'Completed'      => ['Order completed',    "Your order $orderId is complete."],
    'Cancelled'      => ['Order cancelled',    "Your order $orderId was cancelled."],
  ];
  if (!isset($copy[$status])) { return; }
  [$title, $body] = $copy[$status];
  notifyOrderCustomer($pdo, $orderId, 'order', $title, $body);
}

// Map a refund status to friendly copy and notify the buyer.
function notifyRefundStatusChange(PDO $pdo, string $customerId, string $orderId, string $status): void {
  $copy = [
    'Approved'  => ['Refund approved',  "Your refund for order $orderId was approved."],
    'Rejected'  => ['Refund rejected',  "Your refund request for order $orderId was rejected."],
    'Completed' => ['Refund completed', "Your refund for order $orderId has been processed."],
  ];
  if (!isset($copy[$status])) { return; }
  [$title, $body] = $copy[$status];
  notifyCustomerById($pdo, $customerId, 'refund', $title, $body, $orderId);
}
