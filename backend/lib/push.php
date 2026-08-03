<?php
// ─────────────────────────────────────────────────────────────────────
// Background push notifications via Firebase Cloud Messaging (FCM HTTP v1).
//
// SWAP SEAM (mirrors backend/lib/storage.php): pushToUser() is a NO-OP until
// FCM is configured. To turn on real background push:
//   1. Create a Firebase project, add an Android app, download the
//      service-account key JSON (Project settings → Service accounts →
//      Generate new private key).
//   2. In backend/config.local.php add:
//        'fcm_service_account' => 'C:/path/to/serviceAccount.json',
//   3. In the Flutter app add firebase_messaging + google-services.json and
//      call POST /notifications/device with the device's FCM token.
// Until step 2 is done this file does nothing and in-app notifications still
// work on their own. Everything here is best-effort and swallows errors.
// ─────────────────────────────────────────────────────────────────────

// Send a push to every device registered to $userId. No-op unless FCM is set up.
function pushToUser(PDO $pdo, string $userId, string $title, string $body, ?string $orderId, ?string $productId = null): void {
  $cfg    = notifConfig();
  $saPath = function_exists('firebaseServiceAccountPath') ? firebaseServiceAccountPath($cfg) : ($cfg['fcm_service_account'] ?? '');
  if ($saPath === '' || !is_file($saPath)) { return; }   // not configured → silent no-op

  try {
    $stmt = $pdo->prepare('SELECT token FROM device_token WHERE userId = :uid');
    $stmt->execute(['uid' => $userId]);
    $tokens = $stmt->fetchAll(PDO::FETCH_COLUMN);
  } catch (Throwable $e) {
    return;
  }
  if (!$tokens) { return; }

  $sa = json_decode((string) @file_get_contents($saPath), true);
  $projectId   = $sa['project_id'] ?? '';
  $accessToken = googleAccessToken($saPath, 'https://www.googleapis.com/auth/firebase.messaging');
  if (!$accessToken || $projectId === '') { return; }

  foreach ($tokens as $token) {
    fcmSend($accessToken, (string) $projectId, (string) $token, $title, $body, $orderId, $productId);
  }
}

// POST one FCM message (HTTP v1). The data payload carries a deep-link target
// (a product or an order) so the app can navigate when the user taps the push.
function fcmSend(string $accessToken, string $projectId, string $token, string $title, string $body, ?string $orderId, ?string $productId = null): void {
  $message = [
    'token'        => $token,
    'notification' => ['title' => $title, 'body' => $body],
    'android'      => ['priority' => 'high'],
  ];
  if ($productId !== null && $productId !== '') {
    $message['data'] = ['type' => 'product', 'productId' => $productId];
  } elseif ($orderId !== null && $orderId !== '') {
    $message['data'] = ['type' => 'order', 'orderId' => $orderId];
  }
  $ch = curl_init("https://fcm.googleapis.com/v1/projects/{$projectId}/messages:send");
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_HTTPHEADER     => [
      'Authorization: Bearer ' . $accessToken,
      'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS     => json_encode(['message' => $message]),
  ]);
  curl_exec($ch);
  curl_close($ch);
}
