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
function pushToUser(PDO $pdo, string $userId, string $title, string $body, ?string $orderId): void {
  $cfg    = notifConfig();
  $saPath = $cfg['fcm_service_account'] ?? '';
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
  $accessToken = fcmAccessToken($saPath);
  if (!$accessToken || $projectId === '') { return; }

  foreach ($tokens as $token) {
    fcmSend($accessToken, (string) $projectId, (string) $token, $title, $body, $orderId);
  }
}

// Exchange the service-account key for a short-lived OAuth2 access token
// (RS256-signed JWT bearer grant). Cached in-process until it nears expiry.
function fcmAccessToken(string $saPath): ?string {
  static $cache = [];
  if (isset($cache[$saPath]) && $cache[$saPath]['exp'] > time() + 60) {
    return $cache[$saPath]['token'];
  }
  $sa = json_decode((string) @file_get_contents($saPath), true);
  if (!is_array($sa) || empty($sa['client_email']) || empty($sa['private_key'])) { return null; }

  $b64 = fn($d) => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
  $now = time();
  $header = ['alg' => 'RS256', 'typ' => 'JWT'];
  $claim  = [
    'iss'   => $sa['client_email'],
    'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
    'aud'   => 'https://oauth2.googleapis.com/token',
    'iat'   => $now,
    'exp'   => $now + 3600,
  ];
  $unsigned = $b64(json_encode($header)) . '.' . $b64(json_encode($claim));
  $sig = '';
  if (!openssl_sign($unsigned, $sig, $sa['private_key'], 'sha256')) { return null; }
  $assertion = $unsigned . '.' . $b64($sig);

  $res = httpPostForm('https://oauth2.googleapis.com/token', [
    'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion'  => $assertion,
  ]);
  $data = json_decode((string) $res, true);
  if (!isset($data['access_token'])) { return null; }

  $cache[$saPath] = ['token' => $data['access_token'], 'exp' => $now + 3600];
  return $data['access_token'];
}

// POST one FCM message (HTTP v1). The data payload carries the orderId so the
// app can deep-link to the order when the user taps the push.
function fcmSend(string $accessToken, string $projectId, string $token, string $title, string $body, ?string $orderId): void {
  $message = [
    'token'        => $token,
    'notification' => ['title' => $title, 'body' => $body],
    'android'      => ['priority' => 'high'],
  ];
  if ($orderId !== null && $orderId !== '') {
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

// Tiny form-POST helper for the OAuth2 token exchange.
function httpPostForm(string $url, array $fields): ?string {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_POSTFIELDS     => http_build_query($fields),
  ]);
  $res = curl_exec($ch);
  curl_close($ch);
  return $res === false ? null : (string) $res;
}
