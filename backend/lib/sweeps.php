<?php
// ─────────────────────────────────────────────────────────────────────
// Time-based notification sweeps.
//
// These are the notifications that can't be fired by a single user action —
// they depend on TIME PASSING (an unpaid order nearing its deadline, a cart
// left untouched, an order delivered a while ago). Real platforms run these on
// a scheduler (cron). Here they live behind one entry point, runNotificationSweeps(),
// which the admin can trigger on demand (POST /admin/run-sweeps) for a live demo
// and a real cron can call on a timer in production.
//
// Each sweep is idempotent — it uses the notification table (or a per-cart
// marker) to avoid re-notifying the same thing twice — so running it repeatedly
// is safe. Everything is best-effort and never throws.
// ─────────────────────────────────────────────────────────────────────

// How long before the auto-cancel deadline we nudge the buyer to pay.
const PAYMENT_REMINDER_LEAD_MINUTES = 15;
// How long a cart sits untouched (with items, no checkout) before it's "abandoned".
const CART_ABANDON_MINUTES = 60;

// Remind buyers whose unpaid orders are close to the auto-cancel deadline.
// One reminder per order (deduped via the existing 'payment' notification).
function sweepPaymentReminders(PDO $pdo): int {
  $window = defined('ORDER_PAYMENT_WINDOW_MINUTES') ? ORDER_PAYMENT_WINDOW_MINUTES : 60;
  $leadStart = max(1, $window - PAYMENT_REMINDER_LEAD_MINUTES);  // age at which we start reminding
  try {
    $stmt = $pdo->prepare(
      "SELECT o.orderId, TIMESTAMPDIFF(MINUTE, o.orderDate, NOW()) AS ageMin
         FROM `order` o
        WHERE o.orderStatus = 'Placed'
          AND o.orderDate <= (NOW() - INTERVAL :lead MINUTE)
          AND o.orderDate >  (NOW() - INTERVAL :win MINUTE)
          AND NOT EXISTS (SELECT 1 FROM payment p
                           WHERE p.orderId = o.orderId AND p.paymentStatus = 'Successful')
          AND NOT EXISTS (SELECT 1 FROM notification n
                           WHERE n.orderId = o.orderId AND n.type = 'payment')"
    );
    $stmt->execute(['lead' => $leadStart, 'win' => $window]);
    $rows = $stmt->fetchAll();
  } catch (Throwable $e) {
    return 0;
  }
  $sent = 0;
  foreach ($rows as $r) {
    $left = max(1, $window - (int) $r['ageMin']);
    notifyPaymentReminder($pdo, $r['orderId'], $left);
    $sent++;
  }
  return $sent;
}

// Remind customers who left items in their cart and never checked out.
// Re-arms automatically: bumping cartUpdatedAt (on any cart change) makes the
// cart eligible again, since we only skip carts reminded SINCE their last change.
function sweepAbandonedCarts(PDO $pdo): int {
  try {
    $stmt = $pdo->prepare(
      "SELECT c.cartId, cu.userId
         FROM cart c
         JOIN customer cu ON cu.customerId = c.customerId
        WHERE EXISTS (SELECT 1 FROM cart_item ci WHERE ci.cartId = c.cartId)
          AND c.cartUpdatedAt <= (NOW() - INTERVAL :stale MINUTE)
          AND (c.cartReminderSentAt IS NULL OR c.cartReminderSentAt < c.cartUpdatedAt)
          AND cu.userId IS NOT NULL"
    );
    $stmt->execute(['stale' => CART_ABANDON_MINUTES]);
    $rows = $stmt->fetchAll();
  } catch (Throwable $e) {
    return 0;
  }
  $mark = $pdo->prepare('UPDATE cart SET cartReminderSentAt = NOW() WHERE cartId = :id');
  $sent = 0;
  foreach ($rows as $r) {
    createNotification($pdo, (string) $r['userId'], 'cart', 'You left items in your cart',
      'Your cart is waiting — complete your purchase before these sell out.');
    try { $mark->execute(['id' => $r['cartId']]); } catch (Throwable $e) {/* ignore */}
    $sent++;
  }
  return $sent;
}

// Nudge buyers to review delivered orders that still have un-reviewed items.
// One reminder per order (deduped via the existing 'review' notification).
function sweepReviewReminders(PDO $pdo): int {
  try {
    $stmt = $pdo->query(
      "SELECT o.orderId, o.customerId
         FROM `order` o
        WHERE o.orderStatus = 'Delivered'
          AND NOT EXISTS (SELECT 1 FROM notification n
                           WHERE n.orderId = o.orderId AND n.type = 'review')"
    );
    $rows = $stmt->fetchAll();
  } catch (Throwable $e) {
    return 0;
  }
  $unreviewed = $pdo->prepare(
    "SELECT COUNT(*) FROM (
        SELECT DISTINCT p.productId
          FROM order_item oi
          JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
          JOIN product p          ON p.productId = pv.productId
         WHERE oi.orderId = :oid
     ) prods
     LEFT JOIN review r ON r.productId = prods.productId AND r.customerId = :cid
     WHERE r.reviewId IS NULL"
  );
  $sent = 0;
  foreach ($rows as $r) {
    try {
      $unreviewed->execute(['oid' => $r['orderId'], 'cid' => $r['customerId']]);
      if ((int) $unreviewed->fetchColumn() > 0) {
        notifyReviewReminderForOrder($pdo, $r['orderId']);
        $sent++;
      }
    } catch (Throwable $e) {/* skip this order */}
  }
  return $sent;
}

// Re-dispatch in-house parcels that are still waiting for a courier. When an
// order is paid but no ONLINE courier covers its state, the parcel is left
// Pending + unassigned (the "queue"). This sweep retries the auto-assign for
// each such parcel, so the moment a suitable courier comes online (or a new one
// is approved, or a busy one frees up) the queued order is picked up
// automatically — no admin action needed. The courier is notified of the new job.
function sweepRedispatchDeliveries(PDO $pdo): int {
  if (!function_exists('assignDelivery')) { return 0; }
  try {
    $rows = $pdo->query(
      "SELECT orderId, supplierId
         FROM delivery
        WHERE deliveryMethod = 'InHouse'
          AND deliveryStatus = 'Pending'
          AND deliveryPersonnelId IS NULL"
    )->fetchAll();
  } catch (Throwable $e) {
    return 0;
  }
  $assigned = 0;
  foreach ($rows as $r) {
    try {
      $res = assignDelivery($pdo, (string) $r['orderId'], (string) $r['supplierId']);
      if (($res['deliveryPersonnelId'] ?? null) !== null && ($res['auto'] ?? false)) {
        $assigned++;
        if (function_exists('recomputeOrderStatus')) {
          recomputeOrderStatus($pdo, (string) $r['orderId']);
        }
        notifyCourierNewAssignment($pdo, (string) $res['deliveryPersonnelId'], (string) $r['orderId']);
      }
    } catch (Throwable $e) { /* skip this parcel */ }
  }
  return $assigned;
}

// Tell a courier they've just been assigned a delivery (in-app + FCM push).
function notifyCourierNewAssignment(PDO $pdo, string $deliveryPersonnelId, string $orderId): void {
  if (!function_exists('createNotification')) { return; }
  try {
    $stmt = $pdo->prepare('SELECT userId FROM delivery_personnel WHERE deliveryPersonnelId = :id');
    $stmt->execute(['id' => $deliveryPersonnelId]);
    $userId = (string) ($stmt->fetchColumn() ?: '');
  } catch (Throwable $e) {
    return;
  }
  if ($userId !== '') {
    createNotification($pdo, $userId, 'delivery', 'New delivery assigned 📦',
      "You've been assigned a new delivery for order $orderId. Open the app to start it.", $orderId);
  }
}

// Run every time-based sweep. Returns per-sweep counts (handy for the demo).
// Also tidies up expired unpaid orders (which notifies on auto-cancel).
function runNotificationSweeps(PDO $pdo): array {
  $cancelled = 0;
  if (function_exists('cancelExpiredUnpaidOrders')) {
    $cancelled = cancelExpiredUnpaidOrders($pdo);
  }
  return [
    'paymentReminders' => sweepPaymentReminders($pdo),
    'abandonedCarts'   => sweepAbandonedCarts($pdo),
    'reviewReminders'  => sweepReviewReminders($pdo),
    'redispatched'     => sweepRedispatchDeliveries($pdo),
    'autoCancelled'    => $cancelled,
  ];
}

// Retrain the recommender model from the latest data (best-effort). Real
// platforms retrain their models on a schedule/batch — this is the same idea:
// tell the Python ML service to reload so new reviews/products are reflected.
// No-op if the ML service isn't configured or is unreachable.
function sweepReloadRecommender(array $config): bool {
  $base = trim($config['ml_service_url'] ?? '');
  if ($base === '') { return false; }
  try {
    $ch = curl_init(rtrim($base, '/') . '/reload');
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST           => true,
      CURLOPT_TIMEOUT        => 20,   // training can take a few seconds
      CURLOPT_CONNECTTIMEOUT => 2,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $res !== false && $code >= 200 && $code < 300;
  } catch (Throwable $e) {
    return false;
  }
}

// Everything the manual "Run reminders" button does, in one call: the
// notification sweeps + the gated courier monthly payout + a recommender
// model refresh. Used by BOTH the manual endpoint and the app-level auto-runner
// so they behave identically.
function runAllSweeps(PDO $pdo, array $config): array {
  $result = runNotificationSweeps($pdo);
  if (function_exists('sweepCourierPayouts')) {
    $result['courierPayouts'] = sweepCourierPayouts($pdo, $config);
  }
  $result['recommenderReloaded'] = sweepReloadRecommender($config);
  return $result;
}

// App-level "cron": run the sweeps automatically, at most once per
// sweeps_auto_interval_minutes, triggered opportunistically by request traffic
// (called post-response). Concurrency-safe — the conditional UPDATE lets only
// ONE request win the slot, so two simultaneous requests can't double-run.
// No-op (cheap) when not due, when disabled (interval 0), or on any error.
function maybeRunSweeps(PDO $pdo, array $config): void {
  $interval = (int) ($config['sweeps_auto_interval_minutes'] ?? 0);
  if ($interval <= 0) { return; }   // disabled (e.g. a real OS cron is wired up)
  try {
    // Claim the slot atomically: only succeeds if it's actually due. rowCount()
    // is 1 for the single winning request, 0 for everyone else.
    $claim = $pdo->prepare(
      'UPDATE cron_state
          SET lastSweepAt = NOW()
        WHERE id = 1
          AND (lastSweepAt IS NULL OR lastSweepAt <= (NOW() - INTERVAL :mins MINUTE))'
    );
    $claim->execute(['mins' => $interval]);
    if ($claim->rowCount() < 1) { return; }   // not due, or another request won
    runAllSweeps($pdo, $config);
  } catch (Throwable $e) {
    // never let background housekeeping affect the request that triggered it
  }
}
