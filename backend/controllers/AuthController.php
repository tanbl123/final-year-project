<?php
// Handles authentication endpoints.

// Shared password policy: 8+ chars with lower, upper, digit and special char.
// Returns an error message, or null when the password is acceptable.
function passwordPolicyError(string $password): ?string {
  if (strlen($password) < 8)                    return 'Password must be at least 8 characters.';
  if (!preg_match('/[a-z]/', $password))        return 'Password must include a lowercase letter.';
  if (!preg_match('/[A-Z]/', $password))        return 'Password must include an uppercase letter.';
  if (!preg_match('/[0-9]/', $password))        return 'Password must include a number.';
  if (!preg_match('/[^a-zA-Z0-9]/', $password)) return 'Password must include a special character.';
  return null;
}

// Username rules shared by registration, profile edit and the live check.
// 3–20 chars, letters/numbers/underscore. Returns an error message or null.
function usernameFormatError(string $u): ?string {
  if (!preg_match('/^[A-Za-z0-9_]{3,20}$/', $u)) {
    return 'Username must be 3–20 letters, numbers or underscores.';
  }
  return null;
}

// Is this username already taken? Optionally ignore one user's own row.
// Matching is case-insensitive via the column collation.
function usernameTaken(PDO $pdo, string $u, ?string $exceptUserId = null): bool {
  $sql = 'SELECT 1 FROM `user` WHERE username = :u';
  $params = ['u' => $u];
  if ($exceptUserId !== null) { $sql .= ' AND userId != :id'; $params['id'] = $exceptUserId; }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return (bool) $stmt->fetch();
}

// Reduce free text to a valid username body (lowercase, [a-z0-9_] only).
function usernameSlug(string $s): string {
  return substr(preg_replace('/[^a-z0-9_]/', '', strtolower($s)), 0, 20);
}

// First available handle for a base, appending 2, 3, … on collision.
function firstFreeUsername(PDO $pdo, string $base): string {
  if ($base === '') $base = 'user';
  if (strlen($base) < 3) $base = str_pad($base, 3, '0');   // satisfy the 3-char minimum
  $stem = substr($base, 0, 18);                            // leave room for a numeric suffix
  $candidate = $stem; $n = 1;
  while (usernameTaken($pdo, $candidate)) { $candidate = $stem . (++$n); }
  return $candidate;
}

// Suggest a unique handle from a company name (the default offered at sign-up).
function generateUsername(PDO $pdo, string $companyName): string {
  $base = usernameSlug($companyName);
  return firstFreeUsername($pdo, $base === '' ? 'supplier' : $base);
}

// GET /auth/username-available?u=...  — live availability for the sign-up and
// profile forms (Instagram-style). Public; never reveals anything but a yes/no
// (+ a free suggestion when taken).
function handleUsernameAvailable(PDO $pdo): void {
  $u = trim($_GET['u'] ?? '');
  if ($u === '' || usernameFormatError($u) !== null) {
    sendJson(200, true, ['available' => false, 'reason' => 'invalid']);
  }
  if (usernameTaken($pdo, $u)) {
    sendJson(200, true, ['available' => false, 'suggestion' => firstFreeUsername($pdo, usernameSlug($u))]);
  }
  sendJson(200, true, ['available' => true]);
}

// Email-verification tuning (shared by send-code and register).
const VERIFY_CODE_TTL_MIN  = 10;   // a code is valid for 10 minutes
const VERIFY_RESEND_SECS   = 60;   // min gap between sends to one email
const VERIFY_MAX_ATTEMPTS  = 5;    // wrong-code guesses before the code is burned

// POST /auth/register/send-code — email a 6-digit verification code to the
// address a supplier is registering with. The account is NOT created here; it's
// created by /auth/register once the supplier enters this code. One pending
// code per email (a new request overwrites the previous one).
function handleSendRegisterCode(PDO $pdo, array $config): void {
  $body  = getJsonBody();
  $email = trim($body['email'] ?? '');

  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }

  // SMTP must be configured — there's no other way to deliver the code (this is
  // a server-level fact, not account-specific, so it's safe to surface)
  if (!mailConfigured($config)) {
    sendJson(503, false, null, ['code' => 'MAIL_NOT_CONFIGURED',
      'message' => 'Email sending is not configured on the server. Please contact the administrator.']);
  }

  // identical generic response whether or not the email already has an account,
  // so the form can't be used to discover which emails are registered
  $generic = ['message' => 'If this email can be registered, a 6-digit code has been sent to it.'];

  // already registered? email the real owner a heads-up (never a code) and stop,
  // but tell the browser the same generic thing as for a brand-new email.
  $chk = $pdo->prepare('SELECT 1 FROM `user` WHERE email = :e');
  $chk->execute(['e' => $email]);
  if ($chk->fetch()) {
    try { sendAccountExistsEmail($config, $email); } catch (Throwable $ex) { /* best effort */ }
    sendJson(200, true, $generic);
  }

  // resend cooldown: don't let someone hammer the send button (or our SMTP).
  // Within the cooldown, return the same generic success without resending.
  $cool = $pdo->prepare('SELECT TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS secs
                           FROM email_verification WHERE email = :e');
  $cool->execute(['e' => $email]);
  $existing = $cool->fetch();
  if ($existing && $existing['secs'] !== null && (int) $existing['secs'] < VERIFY_RESEND_SECS) {
    sendJson(200, true, $generic);
  }

  // generate the code, store only its hash, reset the attempt counter + expiry
  $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
  $hash = password_hash($code, PASSWORD_BCRYPT);
  $pdo->prepare(
    'INSERT INTO email_verification (email, codeHash, attempts, expires_at, last_sent_at)
       VALUES (:e, :h, 0, DATE_ADD(NOW(), INTERVAL ' . VERIFY_CODE_TTL_MIN . ' MINUTE), NOW())
     ON DUPLICATE KEY UPDATE
       codeHash = VALUES(codeHash), attempts = 0,
       expires_at = VALUES(expires_at), last_sent_at = VALUES(last_sent_at)'
  )->execute(['e' => $email, 'h' => $hash]);

  try {
    sendVerificationCodeEmail($config, $email, $code, VERIFY_CODE_TTL_MIN);
  } catch (Throwable $ex) {
    sendJson(502, false, null, ['code' => 'MAIL_FAILED',
      'message' => 'Could not send the verification email. Please check the address and try again.']);
  }

  sendJson(200, true, $generic);
}

// POST /auth/register — create a new SUPPLIER account (status Pending,
// awaiting admin approval). Creates a `user` row + a `supplier` row together.
// Requires a valid verification code emailed via /auth/register/send-code.
function handleRegister(PDO $pdo): void {
  $body             = getJsonBody();
  $email            = trim($body['email'] ?? '');
  $verificationCode = trim($body['verificationCode'] ?? '');
  $phoneNumber    = trim($body['phoneNumber'] ?? '');
  $companyName    = trim($body['companyName'] ?? '');
  $companyAddress = trim($body['companyAddress'] ?? '');
  // operational (pickup) address — where couriers collect orders. Optional in
  // the payload: when blank it defaults to the registered companyAddress (the
  // SME case where they ship from their registered address).
  $operationalAddress = trim($body['operationalAddress'] ?? '');
  if ($operationalAddress === '') $operationalAddress = $companyAddress;
  $password       = $body['password'] ?? '';

  // business identity (supplier KYB). Bank/payout details are NOT collected
  // here — Stripe Connect collects + verifies them later via hosted onboarding.
  $businessRegNo      = trim($body['businessRegNo'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');
  $taxNumber          = trim($body['taxNumber'] ?? '');     // optional

  // the supplier's display name IS their company name (no separate contact name)
  $fullName = $companyName;

  // every required field must be present (taxNumber is the only optional one)
  if ($email === '' || $phoneNumber === ''
      || $companyName === '' || $companyAddress === ''
      || $businessRegNo === '' || $businessLicenseUrl === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'All fields are required.']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }
  // E.164: optional leading +, country code, up to 15 digits total
  if (!preg_match('/^(0\d{8,10}|\+?60\d{8,10})$/', $phoneNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid Malaysian phone number, e.g. 0123456789.']);
  }
  $phoneNumber = normalizeMyPhone($phoneNumber); // store canonical +60...
  // SSM number: new 12-digit format or old 6–8 digits + check letter
  if (!preg_match('/^(\d{12}|\d{6,8}-?[A-Za-z])$/', $businessRegNo)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.']);
  }
  // SST number is optional, but if given it must look like a real one
  if ($taxNumber !== '' && !preg_match('/^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/', $taxNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid SST number, e.g. W10-1808-32000001.']);
  }
  if (mb_strlen($operationalAddress) > 255) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Operational address is too long.']);
  }
  // password policy: 8+ chars with lower, upper, digit and special char
  $pwErr = passwordPolicyError($password);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }

  // friendly duplicate check on email (the UNIQUE key also protects us)
  $chk = $pdo->prepare('SELECT 1 FROM `user` WHERE email = :e');
  $chk->execute(['e' => $email]);
  if ($chk->fetch()) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already registered.']);
  }

  // login handle: the supplier may choose one; otherwise default to a handle
  // derived from the company name. Validate format + uniqueness when provided.
  $username = trim($body['username'] ?? '');
  if ($username === '') {
    $username = generateUsername($pdo, $companyName);
  } else {
    $fmtErr = usernameFormatError($username);
    if ($fmtErr) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $fmtErr]);
    }
    if (usernameTaken($pdo, $username)) {
      sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That username is already taken.']);
    }
  }

  // ── email ownership: require a valid, unexpired verification code ──
  // Checked last (after the cheap form validation) so a form typo never burns
  // a code-guess attempt. The code was emailed via /auth/register/send-code.
  if ($verificationCode === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A verification code is required.']);
  }
  $vstmt = $pdo->prepare('SELECT codeHash, attempts, (expires_at < NOW()) AS expired
                            FROM email_verification WHERE email = :e');
  $vstmt->execute(['e' => $email]);
  $vrow = $vstmt->fetch();
  if (!$vrow) {
    sendJson(400, false, null, ['code' => 'NO_CODE',
      'message' => 'Please request a verification code for this email first.']);
  }
  if ((int) $vrow['attempts'] >= VERIFY_MAX_ATTEMPTS) {
    $pdo->prepare('DELETE FROM email_verification WHERE email = :e')->execute(['e' => $email]);
    sendJson(429, false, null, ['code' => 'TOO_MANY',
      'message' => 'Too many incorrect attempts. Please request a new code.']);
  }
  if ((int) $vrow['expired'] === 1) {
    sendJson(400, false, null, ['code' => 'CODE_EXPIRED',
      'message' => 'Your verification code has expired. Please request a new one.']);
  }
  if (!password_verify($verificationCode, $vrow['codeHash'])) {
    $pdo->prepare('UPDATE email_verification SET attempts = attempts + 1 WHERE email = :e')->execute(['e' => $email]);
    $left = VERIFY_MAX_ATTEMPTS - ((int) $vrow['attempts'] + 1);
    $msg  = $left > 0 ? "Incorrect code. $left attempt(s) left." : 'Incorrect code. Please request a new one.';
    sendJson(400, false, null, ['code' => 'BAD_CODE', 'message' => $msg]);
  }

  // create user + supplier together (roll back if either fails)
  $pdo->beginTransaction();
  try {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $hash   = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare(
      'INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :un, :pw, :em, :fn, :ph, "Supplier", "Pending")'
    )->execute([
      'id' => $userId, 'un' => $username, 'pw' => $hash, 'em' => $email,
      'fn' => $fullName, 'ph' => $phoneNumber,
    ]);

    $supplierId = nextId($pdo, 'supplier', 'supplierId', 'SUP');
    $pdo->prepare(
      'INSERT INTO supplier
         (supplierId, userId, companyName, companyAddress, operationalAddress,
          businessRegNo, businessLicenseUrl, taxNumber)
       VALUES (:sid, :uid, :cn, :ca, :oa, :brn, :blu, :tax)'
    )->execute([
      'sid' => $supplierId, 'uid' => $userId, 'cn' => $companyName, 'ca' => $companyAddress,
      'oa' => $operationalAddress,
      'brn' => $businessRegNo, 'blu' => $businessLicenseUrl,
      'tax' => ($taxNumber === '' ? null : $taxNumber),
    ]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not create the account. Please try again.']);
  }

  // code consumed — clear it so it can't be replayed
  $pdo->prepare('DELETE FROM email_verification WHERE email = :e')->execute(['e' => $email]);

  sendJson(201, true, ['message' => 'Registration submitted. Your account is pending admin approval.']);
}

// POST /auth/register/customer — self-service CUSTOMER sign-up from the mobile
// app. Unlike suppliers (who need admin approval + KYB), customers are Active
// immediately. Creates a `user` row + a `customer` row. They log in afterwards.
function handleRegisterCustomer(PDO $pdo): void {
  $body        = getJsonBody();
  $username    = trim($body['username'] ?? '');
  $email       = trim($body['email'] ?? '');
  $password    = $body['password'] ?? '';
  $phoneRaw    = trim($body['phoneNumber'] ?? '');
  $phoneNumber = $phoneRaw !== '' ? $phoneRaw : null;
  $shipping    = trim($body['shippingAddress'] ?? '');

  if ($username === '' || $email === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Username and email are required.']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }
  if ($phoneNumber !== null && !preg_match('/^(0\d{8,10}|\+?60\d{8,10})$/', $phoneNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid Malaysian phone number, e.g. 0123456789.']);
  }
  if ($phoneNumber !== null) $phoneNumber = normalizeMyPhone($phoneNumber);
  $fmtErr = usernameFormatError($username);
  if ($fmtErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $fmtErr]);
  }
  $pwErr = passwordPolicyError($password);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }

  $chk = $pdo->prepare('SELECT 1 FROM `user` WHERE email = :e');
  $chk->execute(['e' => $email]);
  if ($chk->fetch()) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already registered.']);
  }
  if (usernameTaken($pdo, $username)) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That username is already taken.']);
  }

  // ── email ownership: require a valid, unexpired verification code ──
  $verificationCode = trim($body['verificationCode'] ?? '');
  if ($verificationCode === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A verification code is required.']);
  }
  $vstmt = $pdo->prepare('SELECT codeHash, attempts, (expires_at < NOW()) AS expired
                            FROM email_verification WHERE email = :e');
  $vstmt->execute(['e' => $email]);
  $vrow = $vstmt->fetch();
  if (!$vrow) {
    sendJson(400, false, null, ['code' => 'NO_CODE',
      'message' => 'Please request a verification code for this email first.']);
  }
  if ((int) $vrow['attempts'] >= VERIFY_MAX_ATTEMPTS) {
    $pdo->prepare('DELETE FROM email_verification WHERE email = :e')->execute(['e' => $email]);
    sendJson(429, false, null, ['code' => 'TOO_MANY',
      'message' => 'Too many incorrect attempts. Please request a new code.']);
  }
  if ((int) $vrow['expired'] === 1) {
    sendJson(400, false, null, ['code' => 'CODE_EXPIRED',
      'message' => 'Your verification code has expired. Please request a new one.']);
  }
  if (!password_verify($verificationCode, $vrow['codeHash'])) {
    $pdo->prepare('UPDATE email_verification SET attempts = attempts + 1 WHERE email = :e')->execute(['e' => $email]);
    $left = VERIFY_MAX_ATTEMPTS - ((int) $vrow['attempts'] + 1);
    $msg  = $left > 0 ? "Incorrect code. $left attempt(s) left." : 'Incorrect code. Please request a new one.';
    sendJson(400, false, null, ['code' => 'BAD_CODE', 'message' => $msg]);
  }

  $pdo->beginTransaction();
  try {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $hash   = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare(
      'INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :un, :pw, :em, :fn, :ph, "Customer", "Active")'
    )->execute(['id' => $userId, 'un' => $username, 'pw' => $hash, 'em' => $email, 'fn' => $username, 'ph' => $phoneNumber]);

    $customerId = nextId($pdo, 'customer', 'customerId', 'CUS');
    $pdo->prepare('INSERT INTO customer (customerId, userId, shippingAddress) VALUES (:cid, :uid, :sa)')
        ->execute(['cid' => $customerId, 'uid' => $userId, 'sa' => $shipping !== '' ? $shipping : null]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not create the account. Please try again.']);
  }

  sendJson(201, true, ['message' => 'Account created. You can now log in.']);
}

// POST /auth/register/courier — self-service DELIVERY PERSONNEL sign-up from the
// courier app. Like suppliers (and unlike customers) the account starts Pending
// and must be approved by an admin before it can log in. Creates a `user` row +
// a `delivery_personnel` row together. Requires a valid verification code emailed
// via /auth/register/send-code.
function handleRegisterCourier(PDO $pdo): void {
  $body        = getJsonBody();
  $email       = trim($body['email'] ?? '');
  $password    = $body['password'] ?? '';
  $fullName    = trim($body['fullName'] ?? '');
  $phoneNumber = trim($body['phoneNumber'] ?? '');
  $vehicleType  = trim($body['vehicleType']  ?? 'Motorcycle');
  $vehicleBrand = trim($body['vehicleBrand'] ?? '');
  $vehicleModel = trim($body['vehicleModel'] ?? '');
  $vehiclePlate = strtoupper(trim($body['vehiclePlate'] ?? ''));
  // KYC: driving licence, IC, profile photo (uploaded via /uploads/registration-doc)
  $licenseNumber   = trim($body['licenseNumber'] ?? '');
  $licensePhotoUrl = trim($body['licensePhotoUrl'] ?? '');
  $icNumber        = trim($body['icNumber'] ?? '');
  $icPhotoUrl      = trim($body['icPhotoUrl'] ?? '');
  $avatarUrl       = trim($body['avatarUrl'] ?? '');

  if ($fullName === '' || $email === '' || $phoneNumber === '' ||
      $vehicleBrand === '' || $vehicleModel === '' || $vehiclePlate === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'All fields including vehicle details are required.']);
  }
  $allowedTypes = ['Motorcycle', 'Car', 'Van', 'Truck'];
  if (!in_array($vehicleType, $allowedTypes, true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid vehicle type.']);
  }
  if (mb_strlen($vehicleBrand) > 50) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Vehicle brand is too long (max 50 characters).']);
  }
  if (mb_strlen($vehicleModel) > 50) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Vehicle model is too long (max 50 characters).']);
  }
  if (mb_strlen($vehiclePlate) < 3) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Plate number must be at least 3 characters.']);
  }
  if (!preg_match('/^[A-Za-z0-9 \-]+$/', $vehiclePlate)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Only letters, numbers, spaces or hyphens.']);
  }
  // KYC required: licence (number + photo), IC (number + photo), profile photo
  if ($licenseNumber === '' || $licensePhotoUrl === '' || $icNumber === '' || $icPhotoUrl === '' || $avatarUrl === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Driving licence, IC (both number + photo) and a profile photo are all required.']);
  }
  if (mb_strlen($licenseNumber) > 20) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Licence number is too long (max 20 characters).']);
  }
  // Malaysian NRIC is exactly 12 digits (entered without dashes).
  if (!preg_match('/^\d{12}$/', $icNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'IC must be 12 digits (e.g. 901231145678).']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }
  if (!preg_match('/^(0\d{8,10}|\+?60\d{8,10})$/', $phoneNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid Malaysian phone number, e.g. 0123456789.']);
  }
  $phoneNumber = normalizeMyPhone($phoneNumber); // store canonical +60...
  if (mb_strlen($fullName) > 120) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is too long (max 120 characters).']);
  }
  $pwErr = passwordPolicyError($password);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }

  $chk = $pdo->prepare('SELECT 1 FROM `user` WHERE email = :e');
  $chk->execute(['e' => $email]);
  if ($chk->fetch()) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already registered.']);
  }

  // auto-generate a unique username from the courier's full name
  $username = generateUsername($pdo, $fullName);

  // ── email ownership: require a valid, unexpired verification code ──
  $verificationCode = trim($body['verificationCode'] ?? '');
  if ($verificationCode === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A verification code is required.']);
  }
  $vstmt = $pdo->prepare('SELECT codeHash, attempts, (expires_at < NOW()) AS expired
                            FROM email_verification WHERE email = :e');
  $vstmt->execute(['e' => $email]);
  $vrow = $vstmt->fetch();
  if (!$vrow) {
    sendJson(400, false, null, ['code' => 'NO_CODE',
      'message' => 'Please request a verification code for this email first.']);
  }
  if ((int) $vrow['attempts'] >= VERIFY_MAX_ATTEMPTS) {
    $pdo->prepare('DELETE FROM email_verification WHERE email = :e')->execute(['e' => $email]);
    sendJson(429, false, null, ['code' => 'TOO_MANY',
      'message' => 'Too many incorrect attempts. Please request a new code.']);
  }
  if ((int) $vrow['expired'] === 1) {
    sendJson(400, false, null, ['code' => 'CODE_EXPIRED',
      'message' => 'Your verification code has expired. Please request a new one.']);
  }
  if (!password_verify($verificationCode, $vrow['codeHash'])) {
    $pdo->prepare('UPDATE email_verification SET attempts = attempts + 1 WHERE email = :e')->execute(['e' => $email]);
    $left = VERIFY_MAX_ATTEMPTS - ((int) $vrow['attempts'] + 1);
    $msg  = $left > 0 ? "Incorrect code. $left attempt(s) left." : 'Incorrect code. Please request a new one.';
    sendJson(400, false, null, ['code' => 'BAD_CODE', 'message' => $msg]);
  }

  $pdo->beginTransaction();
  try {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $hash   = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare(
      'INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status, avatarUrl)
       VALUES (:id, :un, :pw, :em, :fn, :ph, "DeliveryPersonnel", "Pending", :av)'
    )->execute(['id' => $userId, 'un' => $username, 'pw' => $hash, 'em' => $email, 'fn' => $fullName, 'ph' => $phoneNumber, 'av' => $avatarUrl !== '' ? $avatarUrl : null]);

    $deliveryPersonnelId = nextId($pdo, 'delivery_personnel', 'deliveryPersonnelId', 'DEL');
    $pdo->prepare('INSERT INTO delivery_personnel (deliveryPersonnelId, userId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate, licenseNumber, licensePhotoUrl, icNumber, icPhotoUrl)
                   VALUES (:did, :uid, :vt, :vb, :vm, :vp, :ln, :lp, :ic, :ip)')
        ->execute(['did' => $deliveryPersonnelId, 'uid' => $userId, 'vt' => $vehicleType, 'vb' => $vehicleBrand, 'vm' => $vehicleModel, 'vp' => $vehiclePlate,
                   'ln' => $licenseNumber, 'lp' => $licensePhotoUrl, 'ic' => $icNumber, 'ip' => $icPhotoUrl]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not create the account. Please try again.']);
  }

  // code consumed — clear it so it can't be replayed
  $pdo->prepare('DELETE FROM email_verification WHERE email = :e')->execute(['e' => $email]);

  sendJson(201, true, ['message' => 'Registration submitted. Your account is pending admin approval.']);
}

// POST /auth/google — Sign in (or sign up) a CUSTOMER via a Google ID token.
// The mobile app obtains the token from the Google Sign-In SDK and sends it here
// for server-side verification against Google's tokeninfo endpoint. On success,
// returns the same JWT + user envelope as /auth/login. If the email already has a
// ShoeAR account the Google ID is linked to it; otherwise a new Customer account
// is created (Active immediately, no email-code step needed).
function handleGoogleAuth(PDO $pdo, string $secret, array $config): void {
  $body    = getJsonBody();
  $idToken = trim($body['idToken'] ?? '');

  if ($idToken === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Google ID token is required.']);
  }

  // Verify with Google's tokeninfo endpoint (no client secret required).
  $ch = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken));
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
  $res      = curl_exec($ch);
  $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($res === false || $httpCode !== 200) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Invalid Google ID token.']);
  }
  $payload = json_decode((string) $res, true);
  if (!is_array($payload) || empty($payload['sub']) || empty($payload['email'])) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Could not verify Google identity.']);
  }

  // Optional audience check — prevents another app's tokens being accepted here.
  $clientId = $config['google_client_id'] ?? null;
  if ($clientId !== null && ($payload['aud'] ?? '') !== $clientId) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Google token audience mismatch.']);
  }

  $googleId = (string) $payload['sub'];
  $email    = strtolower(trim((string) $payload['email']));
  $fullName = trim((string) ($payload['name'] ?? ''));
  $avatar   = isset($payload['picture']) ? (string) $payload['picture'] : null;

  // 1. Look up by googleId (already linked)
  $stmt = $pdo->prepare(
    'SELECT userId, role, fullName, phoneNumber, status, rejectionReason, googleId AS gid,
            (password IS NOT NULL) AS hasPassword
       FROM `user` WHERE googleId = :g LIMIT 1'
  );
  $stmt->execute(['g' => $googleId]);
  $user = $stmt->fetch();

  // 2. Fall back to email match (implicit link — first Google sign-in for this email)
  if (!$user) {
    $stmt = $pdo->prepare(
      'SELECT userId, role, fullName, phoneNumber, status, rejectionReason, googleId AS gid,
              (password IS NOT NULL) AS hasPassword
         FROM `user` WHERE email = :e LIMIT 1'
    );
    $stmt->execute(['e' => $email]);
    $user = $stmt->fetch();
  }

  if ($user) {
    if ($user['role'] !== 'Customer') {
      sendJson(403, false, null, ['code' => 'WRONG_ROLE',
        'message' => 'This email belongs to a non-customer account and cannot be used here.']);
    }
    if ($user['status'] !== 'Active') {
      sendJson(403, false, null, ['code' => 'NOT_ACTIVE',
        'message' => 'Your account is ' . $user['status'] . '.']);
    }
    // link googleId on first Google sign-in for an existing email account
    if (empty($user['gid'])) {
      $pdo->prepare('UPDATE `user` SET googleId = :g WHERE userId = :id')
          ->execute(['g' => $googleId, 'id' => $user['userId']]);
    }
    // back-fill Google profile picture when none set yet
    if ($avatar) {
      $pdo->prepare('UPDATE `user` SET avatarUrl = :url WHERE userId = :id AND avatarUrl IS NULL')
          ->execute(['url' => $avatar, 'id' => $user['userId']]);
    }
  } else {
    // brand-new user — create Customer account (Active immediately)
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Google did not provide a valid email.']);
    }
    $pdo->beginTransaction();
    try {
      $userId   = nextId($pdo, 'user', 'userId', 'USR');
      $namePart = $fullName !== '' ? $fullName : explode('@', $email)[0];
      $username = firstFreeUsername($pdo, usernameSlug($namePart));
      $pdo->prepare(
        'INSERT INTO `user` (userId, username, password, googleId, email, fullName, phoneNumber, avatarUrl, role, status)
         VALUES (:id, :un, NULL, :gid, :em, :fn, NULL, :av, "Customer", "Active")'
      )->execute([
        'id' => $userId, 'un' => $username, 'gid' => $googleId,
        'em' => $email,  'fn' => ($namePart !== '' ? $namePart : $email), 'av' => $avatar,
      ]);
      $customerId = nextId($pdo, 'customer', 'customerId', 'CUS');
      $pdo->prepare('INSERT INTO customer (customerId, userId, shippingAddress) VALUES (:cid, :uid, NULL)')
          ->execute(['cid' => $customerId, 'uid' => $userId]);
      $pdo->commit();
    } catch (Throwable $e) {
      $pdo->rollBack();
      sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not create the account. Please try again.']);
    }
    $stmt = $pdo->prepare(
      'SELECT userId, role, fullName, phoneNumber, status, rejectionReason,
              (password IS NOT NULL) AS hasPassword
         FROM `user` WHERE userId = :id'
    );
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();
  }

  $now   = time();
  $token = jwt_encode([
    'userId' => $user['userId'],
    'role'   => $user['role'],
    'iat'    => $now,
    'exp'    => $now + (7 * 24 * 60 * 60),
  ], $secret);

  sendJson(200, true, [
    'token' => $token,
    'user'  => [
      'userId'          => $user['userId'],
      'role'            => $user['role'],
      'fullName'        => $user['fullName'],
      'phoneNumber'     => $user['phoneNumber'],
      'status'          => $user['status'],
      'rejectionReason' => $user['rejectionReason'],
      'hasPassword'     => isset($user['hasPassword']) ? (bool) $user['hasPassword'] : false,
    ],
  ]);
}

// POST /auth/login  — verify email + password, return a JWT + basic profile.
function handleLogin(PDO $pdo, string $secret): void {
  $body = getJsonBody();
  // accept either an email or a username in the same field (older clients may
  // still send 'email' — fall back to that)
  $identifier = trim($body['identifier'] ?? $body['email'] ?? '');
  $password = $body['password'] ?? '';

  if ($identifier === '' || $password === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Email/username and password are required.']);
  }

  // look up by email OR username (prepared statement → safe from SQL injection).
  // Two distinct placeholders: with emulation off, PDO won't reuse one twice.
  $stmt = $pdo->prepare(
    'SELECT userId, password, role, fullName, phoneNumber, status, rejectionReason
       FROM `user` WHERE email = :email OR username = :username'
  );
  $stmt->execute(['email' => $identifier, 'username' => $identifier]);
  $user = $stmt->fetch();

  // null password = Google-only account; same generic error so we don't leak
  if (!$user || $user['password'] === null || !password_verify($password, $user['password'])) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Invalid email/username or password.']);
  }

  // Active accounts get full access. A Rejected supplier is also let in, but
  // only to the limited "fix & resubmit your application" flow (the front-end
  // gates them there). Pending/Banned/Suspended/Deleted stay blocked.
  $isActive           = $user['status'] === 'Active';
  $isRejectedSupplier = $user['role'] === 'Supplier' && $user['status'] === 'Rejected';
  if (!$isActive && !$isRejectedSupplier) {
    if ($user['status'] === 'Pending') {
      $msg = 'Your account is pending admin approval. Please wait for approval.';
    } elseif ($user['status'] === 'Banned') {
      $msg = 'Your registration has been rejected and cannot be resubmitted.';
    } elseif ($user['status'] === 'Rejected') {
      // a rejected (non-supplier) applicant — surface the reason so they know why
      $msg = !empty($user['rejectionReason'])
        ? 'Your application was rejected: ' . $user['rejectionReason']
        : 'Your application was rejected.';
    } else {
      $msg = 'Your account is ' . $user['status'] . '.';
    }
    sendJson(403, false, null, ['code' => 'NOT_ACTIVE', 'message' => $msg]);
  }

  // issue a token valid for 7 days
  $now = time();
  $token = jwt_encode([
    'userId' => $user['userId'],
    'role'   => $user['role'],
    'iat'    => $now,
    'exp'    => $now + (7 * 24 * 60 * 60),
  ], $secret);

  sendJson(200, true, [
    'token' => $token,
    'user'  => [
      'userId'          => $user['userId'],
      'role'            => $user['role'],
      'fullName'        => $user['fullName'],
      'phoneNumber'     => $user['phoneNumber'],
      'status'          => $user['status'],
      'rejectionReason' => $user['rejectionReason'],
      'hasPassword'     => true, // password was verified above, so it is never null here
    ],
  ]);
}

// GET /auth/me — the signed-in user's own profile (+ role-specific details).
function handleMe(PDO $pdo, array $auth): void {
  $stmt = $pdo->prepare(
    'SELECT userId, username, fullName, email, phoneNumber, avatarUrl, role, status, created_at,
            (password IS NOT NULL) AS hasPassword
       FROM `user` WHERE userId = :id'
  );
  $stmt->execute(['id' => $auth['userId']]);
  $u = $stmt->fetch();
  if (!$u) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Account not found.']);
  }

  $profile = null;
  if ($u['role'] === 'Supplier') {
    $p = $pdo->prepare('SELECT supplierId, companyName, companyAddress, operationalAddress,
                               bankName, bankAccountName, bankAccountNumber
                          FROM supplier WHERE userId = :id');
  } elseif ($u['role'] === 'Customer') {
    $p = $pdo->prepare('SELECT customerId, shippingAddress, addressLine1, addressLine2,
                               postcode, city, state
                          FROM customer WHERE userId = :id');
  } elseif ($u['role'] === 'DeliveryPersonnel') {
    $p = $pdo->prepare('SELECT deliveryPersonnelId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate FROM delivery_personnel WHERE userId = :id');
  } else {
    $p = null;
  }
  if ($p) { $p->execute(['id' => $auth['userId']]); $profile = $p->fetch() ?: null; }
  $u['profile'] = $profile;

  sendJson(200, true, $u);
}

// PUT /auth/me — update the signed-in user's own editable fields.
function handleUpdateMe(PDO $pdo, array $auth): void {
  $body     = getJsonBody();
  $fullName = trim($body['fullName'] ?? '');
  $phone    = trim($body['phoneNumber'] ?? '');
  $username = trim($body['username'] ?? '');

  if ($fullName === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is required.']);
  }
  if ($phone === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Phone number is required.']);
  }
  if (!preg_match('/^(0\d{8,10}|\+?60\d{8,10})$/', $phone)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid Malaysian phone number, e.g. 0123456789.']);
  }
  $phone = normalizeMyPhone($phone); // store canonical +60...
  if ($username === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Username is required.']);
  }
  $fmtErr = usernameFormatError($username);
  if ($fmtErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $fmtErr]);
  }
  if (usernameTaken($pdo, $username, $auth['userId'])) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That username is already taken.']);
  }

  $upd = $pdo->prepare('UPDATE `user` SET fullName = :fn, phoneNumber = :ph, username = :un WHERE userId = :id');
  $upd->execute(['fn' => $fullName, 'ph' => $phone, 'un' => $username, 'id' => $auth['userId']]);

  // customers may also update their saved shipping address (no-op for others)
  if (array_key_exists('shippingAddress', $body)) {
    $pdo->prepare('UPDATE customer SET shippingAddress = :sa WHERE userId = :id')
        ->execute(['sa' => trim((string) $body['shippingAddress']), 'id' => $auth['userId']]);
  }

  // delivery personnel may also update their vehicle details (no-op for others)
  if (array_key_exists('vehicleType', $body) || array_key_exists('vehicleBrand', $body) ||
      array_key_exists('vehicleModel', $body) || array_key_exists('vehiclePlate', $body)) {
    $allowedTypes = ['Motorcycle', 'Car', 'Van', 'Truck'];
    $vType  = trim((string) ($body['vehicleType']  ?? 'Motorcycle'));
    $vBrand = trim((string) ($body['vehicleBrand'] ?? ''));
    $vModel = trim((string) ($body['vehicleModel'] ?? ''));
    $vPlate = strtoupper(trim((string) ($body['vehiclePlate'] ?? '')));
    if (!in_array($vType, $allowedTypes, true)) $vType = 'Motorcycle';
    if ($vPlate !== '' && mb_strlen($vPlate) < 3) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Plate number must be at least 3 characters.']);
    }
    if ($vPlate !== '' && !preg_match('/^[A-Za-z0-9 \-]+$/', $vPlate)) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Only letters, numbers, spaces or hyphens.']);
    }
    $pdo->prepare('UPDATE delivery_personnel SET vehicleType = :vt, vehicleBrand = :vb, vehicleModel = :vm, vehiclePlate = :vp WHERE userId = :id')
        ->execute(['vt' => $vType, 'vb' => $vBrand, 'vm' => $vModel, 'vp' => $vPlate, 'id' => $auth['userId']]);
  }

  sendJson(200, true, ['fullName' => $fullName, 'phoneNumber' => $phone, 'username' => $username]);
}

// POST /auth/me/avatar — upload (or replace) the signed-in user's profile
// picture. Accepts a multipart `file`; stores it and saves the URL on the user.
function handleUploadAvatar(PDO $pdo, array $auth): void {
  if (!isset($_FILES['file'])) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A photo is required.']);
  }
  $url = storeUploadedFile($_FILES['file'], 'image');
  $pdo->prepare('UPDATE `user` SET avatarUrl = :url WHERE userId = :id')
      ->execute(['url' => $url, 'id' => $auth['userId']]);
  sendJson(200, true, ['avatarUrl' => $url]);
}

// DELETE /auth/me/avatar — remove the profile picture (back to initials).
function handleRemoveAvatar(PDO $pdo, array $auth): void {
  $pdo->prepare('UPDATE `user` SET avatarUrl = NULL WHERE userId = :id')
      ->execute(['id' => $auth['userId']]);
  sendJson(200, true, ['avatarUrl' => null]);
}

// DELETE /auth/me — the customer closes their own account. Soft-delete (status →
// 'Deleted') so order/review history stays intact; the account can no longer log in.
//
// Only CUSTOMERS may self-delete (requireCustomerId 403s others) — couriers and
// suppliers are operational accounts managed by the admin. Before deleting we:
//   1. auto-cancel the customer's unpaid ('Placed') orders (they're leaving),
//   2. block if any order is still in progress (paid, not yet delivered),
//   3. block if any refund is still pending/approved.
function handleDeleteMe(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);

  // 1. Auto-cancel unpaid orders ('Placed' ⇒ no successful payment, no stock held).
  $pdo->prepare("UPDATE `order` SET orderStatus = 'Cancelled'
                  WHERE customerId = :cid AND orderStatus = 'Placed'")
      ->execute(['cid' => $customerId]);

  // 2. Orders still in progress (paid but not fully delivered) block deletion.
  $active = $pdo->prepare(
    "SELECT COUNT(*) FROM `order`
      WHERE customerId = :cid
        AND orderStatus IN ('Paid','Processing','Shipped','OutForDelivery')"
  );
  $active->execute(['cid' => $customerId]);
  if ((int) $active->fetchColumn() > 0) {
    sendJson(409, false, null, ['code' => 'ACTIVE_ORDERS',
      'message' => 'You have orders still in progress. You can delete your account once they are delivered.']);
  }

  // 3. A pending/approved refund must be resolved first.
  $ref = $pdo->prepare("SELECT COUNT(*) FROM refund WHERE customerId = :cid AND refundStatus IN ('Pending','Approved')");
  $ref->execute(['cid' => $customerId]);
  if ((int) $ref->fetchColumn() > 0) {
    sendJson(409, false, null, ['code' => 'ACTIVE_REFUND',
      'message' => 'You have a refund in progress. You can delete your account once it is resolved.']);
  }

  $pdo->prepare("UPDATE `user` SET status = 'Deleted' WHERE userId = :id")
      ->execute(['id' => $auth['userId']]);
  sendJson(200, true, ['message' => 'Your account has been deleted.']);
}

// POST /auth/change-password — verify the current password, then set a new one.
function handleChangePassword(PDO $pdo, array $auth): void {
  $body    = getJsonBody();
  $current = (string) ($body['currentPassword'] ?? '');
  $new     = (string) ($body['newPassword'] ?? '');

  if ($current === '' || $new === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Current and new password are both required.']);
  }

  $stmt = $pdo->prepare('SELECT password FROM `user` WHERE userId = :id');
  $stmt->execute(['id' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Account not found.']);
  }

  // Google-only accounts have no password — they must use forgot-password to set one
  if ($row['password'] === null) {
    sendJson(400, false, null, ['code' => 'NO_PASSWORD',
      'message' => 'Your account uses Google Sign-In and has no password. Use "Forgot password" to set one first.']);
  }

  // must prove they know the existing password before we change it
  if (!password_verify($current, $row['password'])) {
    sendJson(403, false, null, ['code' => 'BAD_PASSWORD', 'message' => 'Your current password is incorrect.']);
  }

  $pwErr = passwordPolicyError($new);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }
  if (password_verify($new, $row['password'])) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'New password must be different from the current one.']);
  }

  $hash = password_hash($new, PASSWORD_BCRYPT);
  $upd  = $pdo->prepare('UPDATE `user` SET password = :p WHERE userId = :id');
  $upd->execute(['p' => $hash, 'id' => $auth['userId']]);

  sendJson(200, true, ['message' => 'Password changed.']);
}

// POST /auth/forgot-password — start the "forgot password" flow. Emails a
// 6-digit reset code to the address IF it belongs to an account. The response
// is always the same generic success, so it never reveals whether an email is
// registered (prevents account enumeration). The code is finished at
// /auth/reset-password.
function handleForgotPassword(PDO $pdo, array $config): void {
  $body  = getJsonBody();
  $email = trim($body['email'] ?? '');

  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }

  // SMTP must be configured — there's no other way to deliver the code. This is
  // a server-level fact (not account-specific), so it's safe to surface.
  if (!mailConfigured($config)) {
    sendJson(503, false, null, ['code' => 'MAIL_NOT_CONFIGURED',
      'message' => 'Email sending is not configured on the server. Please contact the administrator.']);
  }

  // the one and only response when the email is well-formed — same whether or
  // not an account exists, so attackers can't probe which emails are registered
  $generic = ['message' => 'If an account exists for that email, a reset code has been sent.'];

  $stmt = $pdo->prepare('SELECT userId FROM `user` WHERE email = :e');
  $stmt->execute(['e' => $email]);
  if (!$stmt->fetch()) {
    sendJson(200, true, $generic);
  }

  // resend cooldown — silently honour it (the previously sent code still works)
  $cool = $pdo->prepare('SELECT TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS secs
                           FROM password_reset WHERE email = :e');
  $cool->execute(['e' => $email]);
  $existing = $cool->fetch();
  if ($existing && $existing['secs'] !== null && (int) $existing['secs'] < VERIFY_RESEND_SECS) {
    sendJson(200, true, $generic);
  }

  $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
  $hash = password_hash($code, PASSWORD_BCRYPT);
  $pdo->prepare(
    'INSERT INTO password_reset (email, codeHash, attempts, expires_at, last_sent_at)
       VALUES (:e, :h, 0, DATE_ADD(NOW(), INTERVAL ' . VERIFY_CODE_TTL_MIN . ' MINUTE), NOW())
     ON DUPLICATE KEY UPDATE
       codeHash = VALUES(codeHash), attempts = 0,
       expires_at = VALUES(expires_at), last_sent_at = VALUES(last_sent_at)'
  )->execute(['e' => $email, 'h' => $hash]);

  try {
    sendPasswordResetCodeEmail($config, $email, $code, VERIFY_CODE_TTL_MIN);
  } catch (Throwable $ex) {
    sendJson(502, false, null, ['code' => 'MAIL_FAILED',
      'message' => 'Could not send the reset email. Please try again.']);
  }

  sendJson(200, true, $generic);
}

// POST /auth/reset-password/verify-code — check the emailed code is valid for
// the address WITHOUT consuming it or changing the password. This lets the UI
// confirm the code as its own step before asking for a new password; the code
// is finally consumed by /auth/reset-password. Body: { email, code }.
function handleVerifyResetCode(PDO $pdo): void {
  $body  = getJsonBody();
  $email = trim($body['email'] ?? '');
  $code  = trim($body['code'] ?? '');

  if ($email === '' || $code === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Email and code are required.']);
  }

  $vstmt = $pdo->prepare('SELECT codeHash, attempts, (expires_at < NOW()) AS expired
                            FROM password_reset WHERE email = :e');
  $vstmt->execute(['e' => $email]);
  $vrow = $vstmt->fetch();
  if (!$vrow) {
    sendJson(400, false, null, ['code' => 'NO_CODE',
      'message' => 'Please request a password reset code first.']);
  }
  if ((int) $vrow['attempts'] >= VERIFY_MAX_ATTEMPTS) {
    $pdo->prepare('DELETE FROM password_reset WHERE email = :e')->execute(['e' => $email]);
    sendJson(429, false, null, ['code' => 'TOO_MANY',
      'message' => 'Too many incorrect attempts. Please request a new code.']);
  }
  if ((int) $vrow['expired'] === 1) {
    sendJson(400, false, null, ['code' => 'CODE_EXPIRED',
      'message' => 'Your reset code has expired. Please request a new one.']);
  }
  if (!password_verify($code, $vrow['codeHash'])) {
    $pdo->prepare('UPDATE password_reset SET attempts = attempts + 1 WHERE email = :e')->execute(['e' => $email]);
    $left = VERIFY_MAX_ATTEMPTS - ((int) $vrow['attempts'] + 1);
    $msg  = $left > 0 ? "Incorrect code. $left attempt(s) left." : 'Incorrect code. Please request a new one.';
    sendJson(400, false, null, ['code' => 'BAD_CODE', 'message' => $msg]);
  }

  // valid — leave the code in place; /auth/reset-password will consume it
  sendJson(200, true, ['message' => 'Code verified.']);
}

// POST /auth/reset-password — finish the flow: verify the emailed code for the
// address, then set a new password. Body: { email, code, newPassword }.
function handleResetPassword(PDO $pdo): void {
  $body  = getJsonBody();
  $email = trim($body['email'] ?? '');
  $code  = trim($body['code'] ?? '');
  $new   = (string) ($body['newPassword'] ?? '');

  if ($email === '' || $code === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Email and code are required.']);
  }

  $vstmt = $pdo->prepare('SELECT codeHash, attempts, (expires_at < NOW()) AS expired
                            FROM password_reset WHERE email = :e');
  $vstmt->execute(['e' => $email]);
  $vrow = $vstmt->fetch();
  if (!$vrow) {
    sendJson(400, false, null, ['code' => 'NO_CODE',
      'message' => 'Please request a password reset code first.']);
  }
  if ((int) $vrow['attempts'] >= VERIFY_MAX_ATTEMPTS) {
    $pdo->prepare('DELETE FROM password_reset WHERE email = :e')->execute(['e' => $email]);
    sendJson(429, false, null, ['code' => 'TOO_MANY',
      'message' => 'Too many incorrect attempts. Please request a new code.']);
  }
  if ((int) $vrow['expired'] === 1) {
    sendJson(400, false, null, ['code' => 'CODE_EXPIRED',
      'message' => 'Your reset code has expired. Please request a new one.']);
  }
  if (!password_verify($code, $vrow['codeHash'])) {
    $pdo->prepare('UPDATE password_reset SET attempts = attempts + 1 WHERE email = :e')->execute(['e' => $email]);
    $left = VERIFY_MAX_ATTEMPTS - ((int) $vrow['attempts'] + 1);
    $msg  = $left > 0 ? "Incorrect code. $left attempt(s) left." : 'Incorrect code. Please request a new one.';
    sendJson(400, false, null, ['code' => 'BAD_CODE', 'message' => $msg]);
  }

  // code checks out — now the new password must satisfy the policy
  $pwErr = passwordPolicyError($new);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }

  // and it must differ from the current password (same rule as change-password)
  // Guard against null (Google-only accounts) to avoid a TypeError in PHP 8+
  $cur = $pdo->prepare('SELECT password FROM `user` WHERE email = :e');
  $cur->execute(['e' => $email]);
  $curRow = $cur->fetch();
  if ($curRow && $curRow['password'] !== null && password_verify($new, $curRow['password'])) {
    sendJson(400, false, null, ['code' => 'VALIDATION',
      'message' => 'Your new password must be different from your current password.']);
  }

  $hash = password_hash($new, PASSWORD_BCRYPT);
  $upd  = $pdo->prepare('UPDATE `user` SET password = :p WHERE email = :e');
  $upd->execute(['p' => $hash, 'e' => $email]);
  if ($upd->rowCount() === 0) {
    // account vanished mid-flow (very unlikely) — clear the code and bail
    $pdo->prepare('DELETE FROM password_reset WHERE email = :e')->execute(['e' => $email]);
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Account not found.']);
  }

  // code consumed — clear it so it can't be replayed
  $pdo->prepare('DELETE FROM password_reset WHERE email = :e')->execute(['e' => $email]);
  sendJson(200, true, ['message' => 'Your password has been reset. You can now log in.']);
}

// PATCH /auth/me/phone — set or update the phone number. Used at checkout for
// Google Sign-In customers who haven't provided a phone number yet.
function handleUpdateName(PDO $pdo, array $auth): void {
  $body = getJsonBody();
  $name = trim($body['fullName'] ?? '');

  if ($name === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is required.']);
  }
  if (mb_strlen($name) < 2) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name must be at least 2 characters.']);
  }
  if (mb_strlen($name) > 120) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is too long (max 120 characters).']);
  }

  $pdo->prepare('UPDATE `user` SET fullName = :fn WHERE userId = :id')
      ->execute(['fn' => $name, 'id' => $auth['userId']]);

  sendJson(200, true, ['fullName' => $name]);
}

function handleUpdatePhone(PDO $pdo, array $auth): void {
  $body  = getJsonBody();
  $phone = trim($body['phoneNumber'] ?? '');

  if ($phone === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Phone number is required.']);
  }
  if (!preg_match('/^(0\d{8,10}|\+?60\d{8,10})$/', $phone)) {
    sendJson(400, false, null, ['code' => 'VALIDATION',
      'message' => 'Enter a valid Malaysian phone number, e.g. 0123456789.']);
  }
  $phone = normalizeMyPhone($phone); // store canonical +60...

  $pdo->prepare('UPDATE `user` SET phoneNumber = :ph WHERE userId = :id')
      ->execute(['ph' => $phone, 'id' => $auth['userId']]);

  sendJson(200, true, ['phoneNumber' => $phone]);
}
