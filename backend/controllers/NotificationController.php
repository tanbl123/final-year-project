<?php
// Customer in-app notifications (the bell) + device push-token registration.
// The producers (order/refund status changes) live in lib/notifications.php;
// these handlers are the read/ack side the mobile app calls.

// GET /notifications — the signed-in user's notifications, newest first, with
// an unread count for the bell badge.
function handleListNotifications(PDO $pdo, array $auth): void {
  $userId = (string) ($auth['userId'] ?? '');
  if ($userId === '') {
    sendJson(401, false, null, ['code' => 'NO_TOKEN', 'message' => 'Authentication required.']);
  }
  $stmt = $pdo->prepare(
    "SELECT notificationId, type, title, body, orderId, isRead, createdAt
       FROM notification
      WHERE userId = :uid
      ORDER BY createdAt DESC, notificationId DESC
      LIMIT 100"
  );
  $stmt->execute(['uid' => $userId]);
  $rows = $stmt->fetchAll();

  $unread = 0;
  foreach ($rows as &$r) {
    $r['isRead'] = (bool) (int) $r['isRead'];
    if (!$r['isRead']) { $unread++; }
  }
  unset($r);

  sendJson(200, true, ['notifications' => $rows, 'unreadCount' => $unread]);
}

// PATCH /notifications/{id}/read — mark one of the caller's notifications read.
function handleMarkNotificationRead(PDO $pdo, array $auth, string $id): void {
  $userId = (string) ($auth['userId'] ?? '');
  $pdo->prepare('UPDATE notification SET isRead = 1 WHERE notificationId = :id AND userId = :uid')
      ->execute(['id' => $id, 'uid' => $userId]);
  sendJson(200, true, ['notificationId' => $id, 'isRead' => true]);
}

// POST /notifications/read-all — mark all of the caller's notifications read.
function handleMarkAllNotificationsRead(PDO $pdo, array $auth): void {
  $userId = (string) ($auth['userId'] ?? '');
  $pdo->prepare('UPDATE notification SET isRead = 1 WHERE userId = :uid AND isRead = 0')
      ->execute(['uid' => $userId]);
  sendJson(200, true, ['ok' => true]);
}

// POST /notifications/device — register (or re-point) this device's FCM token
// to the signed-in user. Body: { token, platform? }. Tokens are unique per
// device, so the same token re-registering just updates its owner.
function handleRegisterDevice(PDO $pdo, array $auth): void {
  $userId   = (string) ($auth['userId'] ?? '');
  $body     = getJsonBody();
  $token    = trim($body['token'] ?? '');
  $platform = trim($body['platform'] ?? 'android');
  if ($userId === '') {
    sendJson(401, false, null, ['code' => 'NO_TOKEN', 'message' => 'Authentication required.']);
  }
  if ($token === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A device token is required.']);
  }
  if (!in_array($platform, ['android', 'ios'], true)) { $platform = 'android'; }

  $ex = $pdo->prepare('SELECT deviceTokenId FROM device_token WHERE token = :t');
  $ex->execute(['t' => $token]);
  if ($ex->fetchColumn()) {
    $pdo->prepare('UPDATE device_token SET userId = :uid, platform = :p, updatedAt = NOW() WHERE token = :t')
        ->execute(['uid' => $userId, 'p' => $platform, 't' => $token]);
  } else {
    $newId = nextId($pdo, 'device_token', 'deviceTokenId', 'DVT');
    $pdo->prepare(
      'INSERT INTO device_token (deviceTokenId, userId, token, platform, updatedAt)
       VALUES (:id, :uid, :t, :p, NOW())'
    )->execute(['id' => $newId, 'uid' => $userId, 't' => $token, 'p' => $platform]);
  }
  sendJson(200, true, ['ok' => true]);
}
