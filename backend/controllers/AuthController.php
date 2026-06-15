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

// POST /auth/register — create a new SUPPLIER account (status Pending,
// awaiting admin approval). Creates a `user` row + a `supplier` row together.
function handleRegister(PDO $pdo): void {
  $body           = getJsonBody();
  $email          = trim($body['email'] ?? '');
  $phoneNumber    = trim($body['phoneNumber'] ?? '');
  $companyName    = trim($body['companyName'] ?? '');
  $companyAddress = trim($body['companyAddress'] ?? '');
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
  if (!preg_match('/^\+?[1-9]\d{7,14}$/', $phoneNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid phone number in international format, e.g. +60123456789.']);
  }
  // SSM number: new 12-digit format or old 6–8 digits + check letter
  if (!preg_match('/^(\d{12}|\d{6,8}-?[A-Za-z])$/', $businessRegNo)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.']);
  }
  // SST number is optional, but if given it must look like a real one
  if ($taxNumber !== '' && !preg_match('/^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/', $taxNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid SST number, e.g. W10-1808-32000001.']);
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
         (supplierId, userId, companyName, companyAddress,
          businessRegNo, businessLicenseUrl, taxNumber)
       VALUES (:sid, :uid, :cn, :ca, :brn, :blu, :tax)'
    )->execute([
      'sid' => $supplierId, 'uid' => $userId, 'cn' => $companyName, 'ca' => $companyAddress,
      'brn' => $businessRegNo, 'blu' => $businessLicenseUrl,
      'tax' => ($taxNumber === '' ? null : $taxNumber),
    ]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not create the account. Please try again.']);
  }

  sendJson(201, true, ['message' => 'Registration submitted. Your account is pending admin approval.']);
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

  // look up by email OR username (prepared statement → safe from SQL injection)
  $stmt = $pdo->prepare(
    'SELECT userId, password, role, fullName, status, rejectionReason
       FROM `user` WHERE email = :id OR username = :id'
  );
  $stmt->execute(['id' => $identifier]);
  $user = $stmt->fetch();

  // same message whichever was wrong (don't leak which)
  if (!$user || !password_verify($password, $user['password'])) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Invalid email/username or password.']);
  }

  // Active accounts get full access. A Rejected supplier is also let in, but
  // only to the limited "fix & resubmit your application" flow (the front-end
  // gates them there). Pending/Banned/Suspended/Deleted stay blocked.
  $isActive           = $user['status'] === 'Active';
  $isRejectedSupplier = $user['role'] === 'Supplier' && $user['status'] === 'Rejected';
  if (!$isActive && !$isRejectedSupplier) {
    $msg = $user['status'] === 'Pending'
      ? 'Your account is pending admin approval. Please wait for approval.'
      : ($user['status'] === 'Banned'
          ? 'Your registration has been rejected and cannot be resubmitted.'
          : 'Your account is ' . $user['status'] . '.');
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
      'userId'   => $user['userId'],
      'role'     => $user['role'],
      'fullName' => $user['fullName'],
      'status'   => $user['status'],
      'rejectionReason' => $user['rejectionReason'],
    ],
  ]);
}

// GET /auth/me — the signed-in user's own profile (+ role-specific details).
function handleMe(PDO $pdo, array $auth): void {
  $stmt = $pdo->prepare(
    'SELECT userId, username, fullName, email, phoneNumber, role, status, created_at
       FROM `user` WHERE userId = :id'
  );
  $stmt->execute(['id' => $auth['userId']]);
  $u = $stmt->fetch();
  if (!$u) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Account not found.']);
  }

  $profile = null;
  if ($u['role'] === 'Supplier') {
    $p = $pdo->prepare('SELECT supplierId, companyName, companyAddress,
                               bankName, bankAccountName, bankAccountNumber
                          FROM supplier WHERE userId = :id');
  } elseif ($u['role'] === 'Customer') {
    $p = $pdo->prepare('SELECT customerId, shippingAddress FROM customer WHERE userId = :id');
  } elseif ($u['role'] === 'DeliveryPersonnel') {
    $p = $pdo->prepare('SELECT deliveryPersonnelId, vehicleInfo FROM delivery_personnel WHERE userId = :id');
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

  sendJson(200, true, ['fullName' => $fullName, 'phoneNumber' => $phone, 'username' => $username]);
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
