<?php
// ─────────────────────────────────────────────────────────────
// LOCAL SECRETS — this is a TEMPLATE and is committed, so it must NEVER hold a
// real key. COPY this file to "config.local.php" (same folder) and put your
// real keys in THAT copy — config.local.php is gitignored, so it never gets
// committed. Any key in config.local.php overrides the matching key in config.php.
// ─────────────────────────────────────────────────────────────
return [
  // Your Stripe TEST secret key — Dashboard → Developers → API keys →
  // "Reveal test key" (starts with sk_test_). Put the REAL value in
  // config.local.php, not here.
  'stripe_secret' => 'sk_test_REPLACE_ME',

  // Your Stripe TEST publishable key (starts with pk_test_). Sent to the mobile
  // app so its Stripe SDK can present the payment sheet. Safe to expose.
  'stripe_publishable' => 'pk_test_REPLACE_ME',

  // Only if your React app runs somewhere other than the default:
  // 'app_url' => 'http://localhost:5173',

  // OPTIONAL — Firebase (Storage for uploads + Cloud Messaging for push).
  // ONE service-account key powers both. Firebase console → Project settings →
  // Service accounts → Generate new private key; save the JSON and point this
  // at its absolute path. Leave unset to keep LOCAL file storage + in-app-only
  // notifications (no cloud, no push). See backend/lib/storage.php + push.php.
  // 'firebase_service_account' => 'C:/xampp/htdocs/shoear/backend/firebase-service-account.json',

  // Your Storage bucket (Firebase console → Storage). Required for cloud file
  // uploads (product images, 3D .glb models, avatars, proof photos). Looks like
  // 'your-project-id.appspot.com' (or '...firebasestorage.app').
  // 'firebase_storage_bucket' => 'your-project-id.appspot.com',

  // Google Sign-In for the customer mobile app.
  // Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 client ID
  // (Android client, package name com.example.customer). Paste the client ID here so
  // the backend can verify the audience (aud) of each ID token. If omitted, any valid
  // Google ID token is accepted (fine for dev; add it before going to production).
  // 'google_client_id' => '123456789-abc.apps.googleusercontent.com',

  // Optional: override the FAKE test bank account the payout demo attaches to
  // each supplier (only needed if Stripe rejects the built-in default for your
  // country — see Stripe's "test bank account numbers" docs).
  // 'demo_bank' => ['routing_number' => '110000000', 'account_number' => '000123456789'],

  // SMTP — required to email supplier registration verification codes.
  // GMAIL SETUP: 1) turn on 2-Step Verification on your Google account,
  // 2) go to Google Account → Security → App passwords, generate one for
  // "Mail", 3) paste the 16-character password below (spaces don't matter).
  // Use your Gmail address for both 'username' and 'from'.
  'smtp' => [
    'host'      => 'smtp.gmail.com',
    'port'      => 587,
    'secure'    => 'tls',                 // 'tls' for port 587, or 'ssl' for 465
    'username'  => 'you@gmail.com',
    'password'  => 'your-16-char-app-password',
    'from'      => 'you@gmail.com',
    'from_name' => 'ShoeAR',
  ],
];
