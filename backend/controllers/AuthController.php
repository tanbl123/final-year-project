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

// POST /auth/register — create a new SUPPLIER account (status Pending,
// awaiting admin approval). Creates a `user` row + a `supplier` row together.
function handleRegister(PDO $pdo): void {
  $body           = getJsonBody();
  $username       = trim($body['username'] ?? '');
  $email          = trim($body['email'] ?? '');
  $phoneNumber    = trim($body['phoneNumber'] ?? '');
  $companyName    = trim($body['companyName'] ?? '');
  $companyAddress = trim($body['companyAddress'] ?? '');
  $password       = $body['password'] ?? '';

  // business identity + payout details (Stage 1 supplier KYC)
  $businessRegNo      = trim($body['businessRegNo'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');
  $taxNumber          = trim($body['taxNumber'] ?? '');     // optional
  $bankName           = trim($body['bankName'] ?? '');
  $bankAccountName    = trim($body['bankAccountName'] ?? '');
  $bankAccountNo      = trim($body['bankAccountNo'] ?? '');

  // the supplier's display name IS their company name (no separate contact name)
  $fullName = $companyName;

  // every required field must be present (taxNumber is the only optional one)
  if ($username === '' || $email === '' || $phoneNumber === ''
      || $companyName === '' || $companyAddress === ''
      || $businessRegNo === '' || $businessLicenseUrl === ''
      || $bankName === '' || $bankAccountName === '' || $bankAccountNo === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'All fields are required.']);
  }
  // bank account number: digits (and dashes/spaces) only, reasonable length
  if (!preg_match('/^[0-9][0-9 -]{5,33}$/', $bankAccountNo)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid bank account number.']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please enter a valid email.']);
  }
  // E.164: optional leading +, country code, up to 15 digits total
  if (!preg_match('/^\+?[1-9]\d{7,14}$/', $phoneNumber)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Enter a valid phone number in international format, e.g. +60123456789.']);
  }
  // password policy: 8+ chars with lower, upper, digit and special char
  $pwErr = passwordPolicyError($password);
  if ($pwErr) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $pwErr]);
  }

  // friendly duplicate check (the UNIQUE keys also protect us)
  $chk = $pdo->prepare('SELECT email, username FROM `user` WHERE email = :e OR username = :u');
  $chk->execute(['e' => $email, 'u' => $username]);
  foreach ($chk->fetchAll() as $row) {
    if (strcasecmp($row['email'], $email) === 0) {
      sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already registered.']);
    }
    if (strcasecmp($row['username'], $username) === 0) {
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
          businessRegNo, businessLicenseUrl, taxNumber,
          bankName, bankAccountName, bankAccountNo)
       VALUES (:sid, :uid, :cn, :ca, :brn, :blu, :tax, :bn, :ban, :bno)'
    )->execute([
      'sid' => $supplierId, 'uid' => $userId, 'cn' => $companyName, 'ca' => $companyAddress,
      'brn' => $businessRegNo, 'blu' => $businessLicenseUrl,
      'tax' => ($taxNumber === '' ? null : $taxNumber),
      'bn' => $bankName, 'ban' => $bankAccountName, 'bno' => $bankAccountNo,
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
  $email = trim($body['email'] ?? '');
  $password = $body['password'] ?? '';

  if ($email === '' || $password === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Email and password are required.']);
  }

  // look up the user by email (prepared statement → safe from SQL injection)
  $stmt = $pdo->prepare('SELECT userId, password, role, fullName, status FROM `user` WHERE email = :email');
  $stmt->execute(['email' => $email]);
  $user = $stmt->fetch();

  // same message whether the email or password is wrong (don't leak which)
  if (!$user || !password_verify($password, $user['password'])) {
    sendJson(401, false, null, ['code' => 'AUTH', 'message' => 'Invalid email or password.']);
  }

  // only Active accounts may log in (suppliers start as Pending)
  if ($user['status'] !== 'Active') {
    sendJson(403, false, null, ['code' => 'NOT_ACTIVE', 'message' => 'Your account is ' . $user['status'] . '. Please wait for approval.']);
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
    $p = $pdo->prepare('SELECT supplierId, companyName, companyAddress FROM supplier WHERE userId = :id');
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

  if ($fullName === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is required.']);
  }
  if ($phone === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Phone number is required.']);
  }

  $upd = $pdo->prepare('UPDATE `user` SET fullName = :fn, phoneNumber = :ph WHERE userId = :id');
  $upd->execute(['fn' => $fullName, 'ph' => $phone, 'id' => $auth['userId']]);

  sendJson(200, true, ['fullName' => $fullName, 'phoneNumber' => $phone]);
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
