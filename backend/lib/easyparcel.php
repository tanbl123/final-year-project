<?php
// ─────────────────────────────────────────────────────────────────────
// EasyParcel (Malaysia) — Open API integration. Auto-books a Standard parcel
// and returns a carrier + tracking number, the way Shopee generates an airway
// bill. This is the NEW OAuth2 "Open API" (api.easyparcel.com), not the legacy
// individual api-key API.
//
// HOW IT CONNECTS (one-time, by the admin):
//   1. Admin clicks "Connect EasyParcel" → we send them to EasyParcel's consent
//      screen (oauth/login) with our client_id + redirect_uri.
//   2. They approve → EasyParcel redirects the browser back to our callback with
//      a one-time `code`.
//   3. We exchange that code (Basic client_id:client_secret) for an access token
//      (~10 h) + a refresh token (~1 year), stored in the easyparcel_oauth table.
//   4. From then on the backend swaps the refresh token for fresh access tokens
//      automatically — no further admin action until the refresh token expires.
//
// HOW IT BOOKS (per Standard parcel): quotation → submit_orders. submit_orders
// charges the EasyParcel wallet immediately and returns the AWB (free test
// credit in the sandbox). ANY failure returns null so the caller falls back to
// manual carrier + tracking entry — the demo never hard-breaks.
//
// Progressive enhancement: only active once a client_id + client_secret are
// configured AND the admin has connected. Set those in config.local.php.
//
// Docs: https://easyparcel.github.io/OpenAPI/ (Developer Hub gives the app
// credentials). Base host is the same for sandbox + production — the chosen
// host is set by which Developer-Hub app (sandbox vs live) you registered.
// ─────────────────────────────────────────────────────────────────────

const EP_API_BASE    = 'https://api.easyparcel.com';
const EP_API_VERSION = '2026-06';

// Our state names → ISO 3166-2:MY subdivision codes (the Open API's
// `subdivision_code`, e.g. Penang = MY-07).
const EP_SUBDIVISION_CODES = [
  'Johor' => 'MY-01', 'Kedah' => 'MY-02', 'Kelantan' => 'MY-03', 'Melaka' => 'MY-04',
  'Negeri Sembilan' => 'MY-05', 'Pahang' => 'MY-06', 'Pulau Pinang' => 'MY-07',
  'Perak' => 'MY-08', 'Perlis' => 'MY-09', 'Selangor' => 'MY-10', 'Terengganu' => 'MY-11',
  'Sabah' => 'MY-12', 'Sarawak' => 'MY-13', 'Kuala Lumpur' => 'MY-14', 'Labuan' => 'MY-15',
  'Putrajaya' => 'MY-16',
];

// Configured = we have app credentials. (Still needs the admin to CONNECT before
// any booking can happen — see easyParcelConnected().)
function easyParcelEnabled(array $config): bool {
  return trim((string) ($config['easyparcel_client_id'] ?? '')) !== ''
      && trim((string) ($config['easyparcel_client_secret'] ?? '')) !== '';
}

function easyParcelSubdivision(string $state): string {
  return EP_SUBDIVISION_CODES[$state] ?? '';
}

// The redirect URI EasyParcel sends the browser back to after consent. MUST
// match exactly what's registered in the Developer-Hub app. Configurable; falls
// back to deriving it from the current request host.
function easyParcelRedirectUri(array $config): string {
  $uri = trim((string) ($config['easyparcel_redirect_uri'] ?? ''));
  if ($uri !== '') { return $uri; }
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return $scheme . '://' . $host . '/shoear/api/v1/easyparcel/callback';
}

// ── OAuth: build the consent URL the admin is sent to ──
function easyParcelAuthorizeUrl(array $config, string $state): string {
  $q = http_build_query([
    'client_id'     => trim((string) ($config['easyparcel_client_id'] ?? '')),
    'redirect_uri'  => easyParcelRedirectUri($config),
    'response_type' => 'code',
    'state'         => $state,
  ]);
  return EP_API_BASE . '/oauth/login?' . $q;
}

// ── OAuth: token endpoint (Basic client_id:client_secret). Decoded array or null. ──
function easyParcelTokenRequest(array $config, array $body): ?array {
  $id     = trim((string) ($config['easyparcel_client_id'] ?? ''));
  $secret = trim((string) ($config['easyparcel_client_secret'] ?? ''));
  $ch = curl_init(EP_API_BASE . '/oauth/token');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_HTTPHEADER     => [
      'Authorization: Basic ' . base64_encode($id . ':' . $secret),
      'Content-Type: application/x-www-form-urlencoded',
      'Accept: application/json',
    ],
    CURLOPT_POSTFIELDS     => http_build_query($body),
  ]);
  $res  = curl_exec($ch);
  $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($code < 200 || $code >= 300) { return null; }
  $data = json_decode((string) $res, true);
  return is_array($data) ? $data : null;
}

function easyParcelExchangeCode(array $config, string $code, string $state): ?array {
  return easyParcelTokenRequest($config, [
    'grant_type'   => 'authorization_code',
    'code'         => $code,
    'redirect_uri' => easyParcelRedirectUri($config),
    'state'        => $state,
  ]);
}

function easyParcelRefresh(array $config, string $refreshToken): ?array {
  return easyParcelTokenRequest($config, [
    'grant_type'    => 'refresh_token',
    'refresh_token' => $refreshToken,
  ]);
}

// ── Token storage (single-row easyparcel_oauth table) ──
function easyParcelLoadTokens(PDO $pdo): array {
  try {
    $row = $pdo->query('SELECT * FROM easyparcel_oauth WHERE id = 1')->fetch();
  } catch (Throwable $e) {
    return [];   // table not migrated yet → behave as "not connected"
  }
  return $row ?: [];
}

// Persist a token response. We shave 60 s off each expiry as a safety margin.
// Only overwrites the refresh token when the response actually includes one
// (a refresh-grant response may omit it — keep the existing one).
function easyParcelSaveTokens(PDO $pdo, array $tok): void {
  $now    = time();
  $sets   = [];
  $params = ['id' => 1];
  if (!empty($tok['access_token'])) {
    $sets[]         = 'accessToken = :at';
    $params['at']   = $tok['access_token'];
    $sets[]         = 'accessExpiresAt = :ae';
    $params['ae']   = isset($tok['expires_in'])
      ? date('Y-m-d H:i:s', $now + (int) $tok['expires_in'] - 60) : null;
  }
  if (!empty($tok['refresh_token'])) {
    $sets[]         = 'refreshToken = :rt';
    $params['rt']   = $tok['refresh_token'];
    $sets[]         = 'refreshExpiresAt = :re';
    $params['re']   = isset($tok['refresh_token_expires_in'])
      ? date('Y-m-d H:i:s', $now + (int) $tok['refresh_token_expires_in'] - 60) : null;
  }
  if (!empty($tok['account_id'])) {
    $sets[]         = 'accountId = :aid';
    $params['aid']  = $tok['account_id'];
  }
  if (!$sets) { return; }
  $sets[] = 'connectedAt = COALESCE(connectedAt, NOW())';
  $sets[] = 'pendingState = NULL';
  $sets[] = 'pendingStateAt = NULL';
  $pdo->prepare('UPDATE easyparcel_oauth SET ' . implode(', ', $sets) . ' WHERE id = :id')
      ->execute($params);
}

// Stash a one-time CSRF state before sending the admin to the consent screen.
function easyParcelSetPendingState(PDO $pdo, string $state): void {
  $pdo->prepare('UPDATE easyparcel_oauth SET pendingState = :s, pendingStateAt = NOW() WHERE id = 1')
      ->execute(['s' => $state]);
}

// Clear all tokens (the admin disconnected).
function easyParcelDisconnect(PDO $pdo): void {
  $pdo->prepare(
    'UPDATE easyparcel_oauth
        SET accessToken = NULL, accessExpiresAt = NULL, refreshToken = NULL,
            refreshExpiresAt = NULL, accountId = NULL, connectedAt = NULL,
            pendingState = NULL, pendingStateAt = NULL
      WHERE id = 1'
  )->execute();
}

// True when we hold a refresh token that hasn't expired (i.e. bookings can run
// without the admin reconnecting).
function easyParcelConnected(PDO $pdo): bool {
  $row = easyParcelLoadTokens($pdo);
  if (!$row || empty($row['refreshToken'])) { return false; }
  $exp = $row['refreshExpiresAt'] ?? null;
  return !($exp && strtotime((string) $exp) <= time());
}

// Return a valid access token, refreshing via the refresh token if the current
// one has expired. null when not connected or the refresh failed (→ reconnect).
function easyParcelAccessToken(PDO $pdo, array $config): ?string {
  $row = easyParcelLoadTokens($pdo);
  if (!$row) { return null; }
  $access = (string) ($row['accessToken'] ?? '');
  $accExp = $row['accessExpiresAt'] ?? null;
  if ($access !== '' && $accExp && strtotime((string) $accExp) > time()) {
    return $access;   // still valid
  }
  $refresh = (string) ($row['refreshToken'] ?? '');
  if ($refresh === '') { return null; }
  $refExp = $row['refreshExpiresAt'] ?? null;
  if ($refExp && strtotime((string) $refExp) <= time()) { return null; }  // must reconnect
  $tok = easyParcelRefresh($config, $refresh);
  if (!$tok || empty($tok['access_token'])) { return null; }
  easyParcelSaveTokens($pdo, $tok);
  return (string) $tok['access_token'];
}

// Last booking failure reason — set at each failure point below, read by the
// supplier ship endpoint so a failed auto-book reports WHY (insufficient
// balance, a rejected field, an auth problem, …) instead of a blank fallback.
// Pass a string to set it; call with no argument to read it.
function easyParcelError(?string $set = null): string {
  static $err = '';
  if ($set !== null) { $err = $set; }
  return $err;
}

// ── Authenticated JSON POST to an Open API endpoint. Decoded array or null. ──
function easyParcelApiPost(string $token, string $endpoint, array $payload): ?array {
  $ch = curl_init(EP_API_BASE . '/open_api/' . EP_API_VERSION . $endpoint);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
      'Authorization: Bearer ' . $token,
      'Content-Type: application/json',
      'Accept: application/json',
    ],
    CURLOPT_POSTFIELDS     => json_encode($payload),
  ]);
  $res  = curl_exec($ch);
  $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($code < 200 || $code >= 300) {
    easyParcelError("HTTP {$code} from {$endpoint}: " . substr(trim((string) $res), 0, 600));
    return null;
  }
  $data = json_decode((string) $res, true);
  return is_array($data) ? $data : null;
}

// Book a shipment end to end. $sender/$receiver each:
//   [name, company, phone, email, line1, line2, city, state(full name), code(postcode)]
// $parcel: [weight, content, value]. Returns
//   ['carrier','tracking','tracking_url','awb_link'] or null on any failure.
function easyParcelBook(PDO $pdo, array $config, array $sender, array $receiver, array $parcel): ?array {
  easyParcelError('');   // reset for this attempt
  if (!easyParcelEnabled($config)) { easyParcelError('EasyParcel app credentials are not configured.'); return null; }
  $token = easyParcelAccessToken($pdo, $config);
  if (!$token) { easyParcelError('Not connected (no valid token) — reconnect EasyParcel in admin → Integrations.'); return null; }

  $pickSub = easyParcelSubdivision($sender['state'] ?? '');
  $sendSub = easyParcelSubdivision($receiver['state'] ?? '');
  if ($pickSub === '' || $sendSub === '') {
    easyParcelError("Unrecognised state — sender '{$sender['state']}' / receiver '{$receiver['state']}'.");
    return null;
  }
  $weight = (float) ($parcel['weight'] ?? 1);
  $value  = (float) ($parcel['value'] ?? 0);

  // 1) quotation → pick the cheapest service
  $q = easyParcelApiPost($token, '/shipment/quotations', ['shipment' => [[
    'sender'   => ['postcode' => $sender['code'],   'subdivision_code' => $pickSub, 'country' => 'MY'],
    'receiver' => ['postcode' => $receiver['code'], 'subdivision_code' => $sendSub, 'country' => 'MY'],
    'weight' => $weight, 'width' => 10, 'length' => 10, 'height' => 10, 'parcel_value' => $value,
  ]]]);
  if ($q === null) { return null; }   // easyParcelApiPost already recorded the HTTP error
  $quotes = $q['data'][0]['quotations'] ?? [];
  if (!is_array($quotes) || !$quotes) {
    easyParcelError('No courier rates returned for this route. ' . substr(json_encode($q['data'][0] ?? $q), 0, 400));
    return null;
  }
  usort($quotes, static fn($a, $b) =>
    (float) ($a['pricing']['total_amount'] ?? 0) <=> (float) ($b['pricing']['total_amount'] ?? 0));
  $svc       = $quotes[0];
  $serviceId = $svc['courier']['service_id'] ?? '';
  $courier   = $svc['courier']['courier_name'] ?? ($svc['courier']['service_name'] ?? 'Courier');
  if ($serviceId === '') { easyParcelError('Quotation returned no service_id.'); return null; }

  // 2) submit the order (charges the wallet / free credit) → AWB + tracking
  $s = easyParcelApiPost($token, '/shipment/submit_orders', ['shipment' => [[
    'service_id'      => $serviceId,
    'collection_date' => date('Y-m-d'),
    'weight' => $weight, 'width' => 10, 'length' => 10, 'height' => 10,
    'sender' => [
      'name' => $sender['name'], 'company' => $sender['company'] ?? '',
      'phone_number' => $sender['phone'], 'email' => $sender['email'] ?? '',
      'address_1' => $sender['line1'], 'address_2' => $sender['line2'] ?? '',
      'city' => $sender['city'], 'postcode' => $sender['code'],
      'subdivision_code' => $pickSub, 'country_code' => 'MY',
    ],
    'receiver' => [
      'name' => $receiver['name'], 'company' => $receiver['company'] ?? '',
      'phone_number' => $receiver['phone'], 'email' => $receiver['email'] ?? '',
      'address_1' => $receiver['line1'], 'address_2' => $receiver['line2'] ?? '',
      'city' => $receiver['city'], 'postcode' => $receiver['code'],
      'subdivision_code' => $sendSub, 'country_code' => 'MY',
    ],
    'items' => [[
      'content' => $parcel['content'] ?? 'Footwear', 'weight' => $weight,
      'width' => 10, 'length' => 10, 'height' => 10,
      'currency_code' => 'MYR', 'value' => $value, 'quantity' => 1,
    ]],
    'features' => [
      'sms_tracking' => false, 'email_tracking' => true, 'whatsapp_tracking' => false,
    ],
  ]]]);
  if ($s === null) { return null; }   // easyParcelApiPost already recorded the HTTP error
  $ship = $s['data'][0]['shipments'][0] ?? [];
  if (($ship['status'] ?? '') !== 'success') {
    $why = $ship['errors'] ?? ($ship['message'] ?? ($s['message'] ?? $s['data'][0] ?? $s));
    easyParcelError('Order submission rejected: ' . substr(is_string($why) ? $why : json_encode($why), 0, 400));
    return null;
  }
  $awb = (string) ($ship['awb_number'] ?? '');
  if ($awb === '') { easyParcelError('Order submitted but no AWB/tracking number was returned.'); return null; }

  return [
    'carrier'      => $ship['courier'] ?? $courier,
    'tracking'     => $awb,
    'tracking_url' => $ship['tracking_url'] ?? '',
    'awb_link'     => $ship['awb_url'] ?? '',
  ];
}
