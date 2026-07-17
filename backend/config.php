<?php
// ─────────────────────────────────────────────────────────────
// The ONLY file you edit to move from local XAMPP → cloud MySQL.
// Keep real credentials out of public git in production.
//
// SECRETS: don't put real keys here (this file is committed). Instead create
// backend/config.local.php (gitignored) returning an array that OVERRIDES any
// keys below — e.g. ['stripe_secret' => 'sk_test_...']. See config.local.example.php.
// ─────────────────────────────────────────────────────────────
$config = [
  'db' => [
    'host'    => '127.0.0.1',
    'port'    => '3306',
    'name'    => 'shoear',
    'user'    => 'root',
    'pass'    => '',          // XAMPP default has no password
    'charset' => 'utf8mb4',
  ],
  'jwt_secret' => 'CHANGE_ME_to_a_long_random_string',

  // Stripe Connect (payouts). Keep the secret OUT of git — set it via the
  // STRIPE_SECRET environment variable OR in config.local.php (use a test
  // key: sk_test_...).
  'stripe_secret' => getenv('STRIPE_SECRET') ?: '',

  // Where Stripe sends the supplier back after hosted onboarding.
  'app_url' => getenv('APP_URL') ?: 'http://localhost:5173',

  // App-level cron: how often (minutes) the time-based sweeps may auto-run after
  // a request, so they fire on a timer WITHOUT an OS cron job. The manual "Run
  // reminders" button still works regardless. Set to 0 to disable auto-running
  // (e.g. if you wire a real OS cron / Task Scheduler to /admin/run-sweeps).
  'sweeps_auto_interval_minutes' => (int) (getenv('SWEEPS_AUTO_INTERVAL') ?: 10),

  // Google Places (New) API key for address autocomplete on the web supplier
  // form. Kept server-side (the browser hits our /places/* proxy, never Google
  // directly). Leave empty to disable autocomplete — the form still works with
  // manual entry + the offline postcode → city/state lookup. Put the real key
  // in config.local.php (it's gitignored). Same key the customer app uses.
  'google_places_api_key' => getenv('GOOGLE_PLACES_API_KEY') ?: '',

  // EasyParcel (Malaysia) Open API — auto-books a Standard (long-distance)
  // parcel and returns a carrier + tracking number, like Shopee generating an
  // airway bill. This is the OAuth2 "Open API": register an app in EasyParcel's
  // Developer Hub to get a Client ID + Client Secret, put them in
  // config.local.php, then the admin clicks "Connect EasyParcel" once. Leave the
  // credentials empty to keep manual carrier + tracking entry (no booking, no
  // cost). redirect_uri (optional) must match what you registered in the app —
  // defaults to <this host>/shoear/api/v1/easyparcel/callback. Default parcel
  // weight (kg) is used for the rate quote since we don't capture product weight.
  'easyparcel_client_id'     => getenv('EASYPARCEL_CLIENT_ID') ?: '',
  'easyparcel_client_secret' => getenv('EASYPARCEL_CLIENT_SECRET') ?: '',
  'easyparcel_redirect_uri'  => getenv('EASYPARCEL_REDIRECT_URI') ?: '',
  'easyparcel_live'          => getenv('EASYPARCEL_LIVE') === '1',
  'easyparcel_default_weight'=> (float) (getenv('EASYPARCEL_WEIGHT') ?: 1.0),

  // Flat fee (MYR) a courier earns per completed (Delivered) parcel. Snapshotted
  // onto each delivery when it's confirmed, so changing this never alters past
  // earnings. Couriers are paid out their accrued balance via Stripe Connect.
  'courier_fee_per_delivery' => (float) (getenv('COURIER_FEE_PER_DELIVERY') ?: 5.00),

  // Automatically pay every connected courier their pending balance once per
  // calendar month (so the admin can never forget). Manual payouts still work
  // any time. Set COURIER_AUTO_PAYOUT=0 to disable and rely on manual only.
  'courier_auto_payout' => getenv('COURIER_AUTO_PAYOUT') !== '0',

  // SMTP — used to email supplier registration verification codes. Keep the
  // password OUT of git: set these in config.local.php (see the example file).
  // For Gmail: host smtp.gmail.com, port 587, secure 'tls', username your
  // address, password a 16-char App Password (not your normal password).
  'smtp' => [
    'host'      => getenv('SMTP_HOST')      ?: '',
    'port'      => getenv('SMTP_PORT')      ?: 587,
    'secure'    => getenv('SMTP_SECURE')    ?: 'tls',   // 'tls' (587) or 'ssl' (465)
    'username'  => getenv('SMTP_USERNAME')  ?: '',
    'password'  => getenv('SMTP_PASSWORD')  ?: '',
    'from'      => getenv('SMTP_FROM')      ?: (getenv('SMTP_USERNAME') ?: ''),
    'from_name' => getenv('SMTP_FROM_NAME') ?: 'ShoeAR',
  ],

  // Snapchat Camera Kit — the STAGING api token + the app's single lens GROUP id.
  // Used ONLY by the admin AR-lens picker: the backend hands the token to an
  // authenticated admin at runtime so their browser's Camera Kit Web SDK can list
  // the group's lenses. Keep the token OUT of git — set it in config.local.php.
  // The group id is not secret (just an identifier). Snap has no server-side lens
  // list API, so the token has to reach the (admin-only) browser to fetch lenses.
  'camerakit_api_token' => getenv('CAMERAKIT_API_TOKEN') ?: '',
  'camerakit_group_id'  => getenv('CAMERAKIT_GROUP_ID')  ?: 'fdac5175-05fe-47e9-adf5-108b36419d71',
];

// Local, gitignored overrides (real secrets live here on each machine).
$localFile = __DIR__ . '/config.local.php';
if (is_file($localFile)) {
  $local = require $localFile;
  if (is_array($local)) {
    $config = array_replace($config, $local);
  }
}

return $config;
