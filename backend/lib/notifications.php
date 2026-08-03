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
function createNotification(PDO $pdo, string $userId, string $type, string $title, string $body, ?string $orderId = null, ?string $productId = null): void {
  if ($userId === '') { return; }
  try {
    $id = nextId($pdo, 'notification', 'notificationId', 'NTF');
    $pdo->prepare(
      "INSERT INTO notification (notificationId, userId, type, title, body, orderId, productId, isRead, createdAt)
       VALUES (:id, :uid, :type, :title, :body, :oid, :pid, 0, NOW())"
    )->execute([
      'id'    => $id,
      'uid'   => $userId,
      'type'  => $type,
      'title' => mb_substr($title, 0, 120),
      'body'  => mb_substr($body, 0, 255),
      'oid'   => $orderId,
      'pid'   => $productId,
    ]);
  } catch (Throwable $e) {
    return; // never block the caller
  }
  // best-effort real push (no-op unless FCM is configured)
  if (function_exists('pushToUser')) {
    try { pushToUser($pdo, $userId, $title, $body, $orderId, $productId); } catch (Throwable $e) { /* ignore */ }
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

// Confirm to the buyer that we received their refund REQUEST (the Pending step,
// before the admin has reviewed it). Approved/Rejected/Completed are handled by
// notifyRefundStatusChange above.
function notifyRefundRequested(PDO $pdo, string $customerId, string $orderId): void {
  notifyCustomerById($pdo, $customerId, 'refund', 'Refund request received',
    "We've received your refund request for order $orderId and will review it shortly.", $orderId);
}

// An unpaid order was auto-cancelled because payment didn't arrive in time.
// (Distinct, clearer copy than a manual cancellation.)
function notifyOrderAutoCancelled(PDO $pdo, string $orderId): void {
  notifyOrderCustomer($pdo, $orderId, 'order', 'Order cancelled',
    "We didn't receive payment for order $orderId in time, so it was cancelled and the items were released.");
}

// Remind the buyer to pay a still-unpaid order before it auto-cancels.
function notifyPaymentReminder(PDO $pdo, string $orderId, int $minutesLeft): void {
  $when = $minutesLeft > 1 ? "in about $minutesLeft minutes" : 'soon';
  notifyOrderCustomer($pdo, $orderId, 'payment', 'Complete your payment',
    "Your order $orderId is still awaiting payment and will be cancelled $when. Tap to pay now.");
}

// After delivery, nudge the buyer to review what they bought. Deep-links to the
// order (where each item can be rated).
function notifyReviewReminderForOrder(PDO $pdo, string $orderId): void {
  notifyOrderCustomer($pdo, $orderId, 'review', 'How were your shoes?',
    "Your order $orderId has arrived — tap to rate your purchase and help other shoppers.");
}

// ── wishlist re-engagement (price drop / back in stock) ──────────────────────

// Every customer userId who has this product on their wishlist.
function wishlistUserIds(PDO $pdo, string $productId): array {
  try {
    $stmt = $pdo->prepare(
      "SELECT DISTINCT c.userId
         FROM wishlist_item wi
         JOIN wishlist w ON w.wishlistId = wi.wishlistId
         JOIN customer c ON c.customerId = w.customerId
        WHERE wi.productId = :pid AND c.userId IS NOT NULL"
    );
    $stmt->execute(['pid' => $productId]);
    return array_column($stmt->fetchAll(), 'userId');
  } catch (Throwable $e) {
    return [];
  }
}

// Is the product visible to shoppers (so a wishlist nudge makes sense)?
function productNameIfApproved(PDO $pdo, string $productId): ?string {
  try {
    $stmt = $pdo->prepare("SELECT productName FROM product WHERE productId = :pid AND productStatus = 'Approved'");
    $stmt->execute(['pid' => $productId]);
    $name = $stmt->fetchColumn();
    return $name === false ? null : (string) $name;
  } catch (Throwable $e) {
    return null;
  }
}

// Notify wishlisters when the price actually DROPS on an approved product.
function notifyWishlistPriceDrop(PDO $pdo, string $productId, float $oldPrice, float $newPrice): void {
  if ($newPrice >= $oldPrice) { return; }
  $name = productNameIfApproved($pdo, $productId);
  if ($name === null) { return; }
  $title = 'Price drop on your wishlist';
  $body  = "$name is now RM " . number_format($newPrice, 2) . ' (was RM ' . number_format($oldPrice, 2) . ').';
  foreach (wishlistUserIds($pdo, $productId) as $uid) {
    createNotification($pdo, (string) $uid, 'wishlist', $title, $body);
  }
}

// Notify wishlisters when an approved product goes from out-of-stock to in-stock.
// The caller decides the 0→>0 transition; this just fans out the message.
function notifyWishlistBackInStock(PDO $pdo, string $productId): void {
  $name = productNameIfApproved($pdo, $productId);
  if ($name === null) { return; }
  $title = 'Back in stock';
  $body  = "$name on your wishlist is available again.";
  foreach (wishlistUserIds($pdo, $productId) as $uid) {
    createNotification($pdo, (string) $uid, 'wishlist', $title, $body);
  }
}
