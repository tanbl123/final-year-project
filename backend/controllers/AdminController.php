<?php
// Admin-only endpoints. For now: the supplier approval queue.

// GET /admin/suppliers/pending — list supplier accounts awaiting approval.
// Includes the business-verification fields + document URL so the admin can
// actually review the application before approving or rejecting it.
function handleListPendingSuppliers(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT u.userId, s.supplierId, s.companyName, s.displayName,
            s.companyAddress, s.companyLine1, s.companyPostcode, s.companyCity, s.companyState,
            s.operationalAddress, s.operationalLine1, s.operationalPostcode, s.operationalCity, s.operationalState,
            s.businessRegNo, s.businessLicenseUrl, s.taxNumber,
            u.username, u.email, u.phoneNumber, u.avatarUrl, u.created_at
       FROM `user` u
       JOIN supplier s ON s.userId = u.userId
      WHERE u.role = 'Supplier' AND u.status = 'Pending'
      ORDER BY u.created_at ASC"
  );
  sendJson(200, true, ['suppliers' => $stmt->fetchAll()]);
}

// Shared: move a currently-Pending supplier to a new status. Optionally records
// a rejection reason (shown to the supplier) — passing null clears any old one.
function setSupplierStatus(PDO $pdo, string $userId, string $newStatus, ?string $reason = null, array $config = []): void {
  $stmt = $pdo->prepare("SELECT status, role, email, fullName FROM `user` WHERE userId = :id");
  $stmt->execute(['id' => $userId]);
  $row = $stmt->fetch();

  if (!$row || $row['role'] !== 'Supplier') {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Supplier not found.']);
  }
  // guard against double-reviewing (e.g. two admins, or a stale page)
  if ($row['status'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This account has already been reviewed.']);
  }

  $upd = $pdo->prepare("UPDATE `user` SET status = :s, rejectionReason = :r WHERE userId = :id");
  $upd->execute(['s' => $newStatus, 'r' => $reason, 'id' => $userId]);

  // Email the supplier the decision (reliable for a web-portal applicant).
  // Best-effort: a mail hiccup must not fail the admin's action.
  if (function_exists('sendSupplierDecisionEmail') && function_exists('mailConfigured')
      && mailConfigured($config) && !empty($row['email'])) {
    try {
      sendSupplierDecisionEmail($config, $row['email'], $row['fullName'] ?? '', $newStatus, $reason);
    } catch (Throwable $e) { /* ignore — the status change still stands */ }
  }

  sendJson(200, true, ['userId' => $userId, 'status' => $newStatus]);
}

// POST /admin/suppliers/{userId}/approve — clears any past rejection reason.
function handleApproveSupplier(PDO $pdo, string $userId, array $config = []): void {
  setSupplierStatus($pdo, $userId, 'Active', null, $config);
}

// POST /admin/suppliers/{userId}/reject — body: { reason, terminal? }.
// terminal=true bans the applicant permanently; otherwise they may fix the
// stated reason and resubmit. A reason is required so the supplier knows why.
function handleRejectSupplier(PDO $pdo, string $userId, array $config = []): void {
  $body     = getJsonBody();
  $reason   = trim($body['reason'] ?? '');
  $terminal = !empty($body['terminal']);

  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A rejection reason is required.']);
  }
  if (mb_strlen($reason) > 255) {
    $reason = mb_substr($reason, 0, 255);
  }
  setSupplierStatus($pdo, $userId, $terminal ? 'Banned' : 'Rejected', $reason, $config);
}

// ── Courier (delivery personnel) approvals ───────────────────────────
// Same self-apply → admin-approve flow as suppliers, for DeliveryPersonnel.

// GET /admin/couriers/pending — list courier accounts awaiting approval.
function handleListPendingCouriers(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT u.userId, d.deliveryPersonnelId, d.vehicleType, d.vehicleBrand, d.vehicleModel, d.vehiclePlate,
            d.licenseNumber, d.licensePhotoUrl, d.licensePhotoBackUrl, d.licenseIsDigital, d.eLicenseUrl,
            d.licenseClass, d.licenseExpiry,
            d.icNumber, d.icPhotoUrl, d.icPhotoBackUrl, d.dateOfBirth, d.termsAcceptedAt, d.coverageZones,
            u.username, u.email, u.fullName, u.phoneNumber, u.avatarUrl, u.created_at
       FROM `user` u
       JOIN delivery_personnel d ON d.userId = u.userId
      WHERE u.role = 'DeliveryPersonnel' AND u.status = 'Pending'
      ORDER BY u.created_at ASC"
  );
  sendJson(200, true, ['couriers' => $stmt->fetchAll()]);
}

// Shared: move a currently-Pending courier to a new status. Optionally records a
// rejection reason (shown to the courier at login) — passing null clears it.
function setCourierStatus(PDO $pdo, string $userId, string $newStatus, ?string $reason = null, array $config = []): void {
  $stmt = $pdo->prepare("SELECT status, role, email, fullName FROM `user` WHERE userId = :id");
  $stmt->execute(['id' => $userId]);
  $row = $stmt->fetch();

  if (!$row || $row['role'] !== 'DeliveryPersonnel') {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Courier not found.']);
  }
  if ($row['status'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This account has already been reviewed.']);
  }

  $upd = $pdo->prepare("UPDATE `user` SET status = :s, rejectionReason = :r WHERE userId = :id");
  $upd->execute(['s' => $newStatus, 'r' => $reason, 'id' => $userId]);

  // Tell the courier the outcome (in-app notification + best-effort FCM push).
  if (function_exists('createNotification')) {
    $reasonBit = ($reason !== null && $reason !== '') ? 'Reason: ' . $reason . ' ' : '';
    if ($newStatus === 'Active') {
      createNotification($pdo, $userId, 'CourierApproved', 'Application approved 🎉',
        'Your courier account is approved. Sign in to set up your payout account and start delivering.');
    } elseif ($newStatus === 'Rejected') {
      createNotification($pdo, $userId, 'CourierRejected', 'Application needs changes',
        $reasonBit . 'Sign in to fix your details and resubmit your application.');
    } elseif ($newStatus === 'Banned') {
      createNotification($pdo, $userId, 'CourierBanned', 'Application declined',
        $reasonBit . 'Your application was declined and cannot be resubmitted.');
    }
  }

  // Email the applicant the decision — the reliable channel for someone who
  // hasn't logged in yet. Best-effort: a mail hiccup must not fail the action.
  if (function_exists('sendCourierDecisionEmail') && function_exists('mailConfigured')
      && mailConfigured($config) && !empty($row['email'])) {
    try {
      sendCourierDecisionEmail($config, $row['email'], $row['fullName'] ?? '', $newStatus, $reason);
    } catch (Throwable $e) { /* ignore — the in-app notification still stands */ }
  }

  sendJson(200, true, ['userId' => $userId, 'status' => $newStatus]);
}

// POST /admin/couriers/{userId}/approve — clears any past rejection reason.
function handleApproveCourier(PDO $pdo, string $userId, array $config = []): void {
  setCourierStatus($pdo, $userId, 'Active', null, $config);
}

// POST /admin/couriers/{userId}/reject — body: { reason, terminal? }.
// terminal=true bans the applicant permanently; otherwise they're Rejected and
// see the reason at login. A reason is required so the courier knows why.
function handleRejectCourier(PDO $pdo, string $userId, array $config = []): void {
  $body     = getJsonBody();
  $reason   = trim($body['reason'] ?? '');
  $terminal = !empty($body['terminal']);

  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A rejection reason is required.']);
  }
  if (mb_strlen($reason) > 255) {
    $reason = mb_substr($reason, 0, 255);
  }
  setCourierStatus($pdo, $userId, $terminal ? 'Banned' : 'Rejected', $reason, $config);
}

// ── Product approvals ────────────────────────────────────────────────

// GET /admin/products/pending — list products awaiting approval.
function handleListPendingProducts(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT p.productId, p.productName, p.productBrand, p.productPrice,
            p.productDescription, c.categoryName, s.companyName, p.created_at,
            p.virtualTryOnEnable,
            (SELECT pm.arLensId FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arLensId,
            (SELECT pm.arReadyAt IS NOT NULL FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arReady,
            (SELECT pm.arFlaggedAt IS NOT NULL FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arFlagged,
            (SELECT pm.arFlagNote FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arFlagNote
       FROM product p
       JOIN supplier s ON s.supplierId = p.supplierId
       JOIN category c ON c.categoryId = p.categoryId
      WHERE p.productStatus = 'Pending'
      ORDER BY p.created_at ASC"
  );
  $rows = $stmt->fetchAll();
  // virtualTryOnEnable + arLensId let the approvals page warn when a try-on
  // product is about to be approved without a Camera Kit lens (AR won't work);
  // arReady drives the Virtual try-on filter; arFlagged/arFlagNote show when an
  // AR Specialist reported the model as unusable so the admin can reject it.
  foreach ($rows as &$r) {
    $r['productPrice']       = (float) $r['productPrice'];
    $r['virtualTryOnEnable'] = (bool) $r['virtualTryOnEnable'];
    $r['arReady']            = (bool) $r['arReady'];
    $r['arFlagged']          = (bool) $r['arFlagged'];
  }
  unset($r);
  sendJson(200, true, ['products' => $rows]);
}

// Shared: move a currently-Pending product to a new status (Approved/Rejected).
// On rejection we store the admin's reason and email the supplier a formal
// notice (mirroring supplier/courier decisions); on approval we clear any
// previous reason.
function setProductStatus(PDO $pdo, string $productId, string $newStatus, ?string $reason = null, array $config = []): void {
  // Pull the product + the supplier's contact so we can notify them.
  $stmt = $pdo->prepare(
    "SELECT p.productStatus, p.productName, p.virtualTryOnEnable, u.email, s.companyName,
            (SELECT pm.arLensId FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arLensId
       FROM product p
       JOIN supplier s ON s.supplierId = p.supplierId
       JOIN `user`  u ON u.userId    = s.userId
      WHERE p.productId = :id"
  );
  $stmt->execute(['id' => $productId]);
  $row = $stmt->fetch();

  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  if ($row['productStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This product has already been reviewed.']);
  }

  // A try-on product must have its Camera Kit lens recorded before going live —
  // otherwise AR would be advertised to customers but never appear. The admin
  // sets the lens in the review panel; this mirrors the client guard as
  // defence in depth (direct API calls can't bypass it).
  if ($newStatus === 'Approved'
      && (int) $row['virtualTryOnEnable'] === 1
      && empty($row['arLensId'])) {
    sendJson(409, false, null, ['code' => 'LENS_REQUIRED',
      'message' => 'This product has virtual try-on enabled but no AR lens set. Add a Camera Kit lens id before approving.']);
  }

  // Approve clears any prior reason; Reject stores it.
  $storedReason = ($newStatus === 'Rejected') ? $reason : null;
  $upd = $pdo->prepare("UPDATE product SET productStatus = :s, rejectionReason = :r WHERE productId = :id");
  $upd->execute(['s' => $newStatus, 'r' => $storedReason, 'id' => $productId]);

  // Best-effort email to the supplier (never block the API on mail failure).
  if ($newStatus === 'Rejected' && !empty($row['email']) && function_exists('sendProductDecisionEmail')) {
    try {
      sendProductDecisionEmail($config, $row['email'], $row['companyName'] ?? '', $row['productName'] ?? '', (string) $reason);
    } catch (Throwable $e) { /* best effort */ }
  }

  sendJson(200, true, ['productId' => $productId, 'status' => $newStatus]);
}

// POST /admin/products/{productId}/approve
function handleApproveProduct(PDO $pdo, string $productId): void {
  setProductStatus($pdo, $productId, 'Approved');
}

// POST /admin/products/{productId}/reject — requires a reason (shown to the
// supplier in-app and emailed to them).
function handleRejectProduct(PDO $pdo, string $productId, array $config = []): void {
  $body   = getJsonBody();
  $reason = trim($body['reason'] ?? '');
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A rejection reason is required.']);
  }
  if (mb_strlen($reason) > 255) {
    $reason = mb_substr($reason, 0, 255);
  }
  setProductStatus($pdo, $productId, 'Rejected', $reason, $config);
}

// ── User management ──────────────────────────────────────────────────

// GET /admin/users — list/filter all users (?role=, ?status=, ?search=).
function handleListUsers(PDO $pdo): void {
  $role   = $_GET['role']   ?? '';
  $status = $_GET['status'] ?? '';
  $search = trim($_GET['search'] ?? '');

  $allowedRoles    = ['Admin', 'Supplier', 'Customer', 'DeliveryPersonnel', 'ArSpecialist'];
  $allowedStatuses = ['Pending', 'Active', 'Rejected', 'Suspended', 'Deleted'];

  $where = [];
  $params = [];
  if ($role !== '' && in_array($role, $allowedRoles, true)) {
    $where[] = 'role = :role'; $params['role'] = $role;
  }
  if ($status !== '' && in_array($status, $allowedStatuses, true)) {
    $where[] = 'status = :status'; $params['status'] = $status;
  }
  if ($search !== '') {
    $where[] = '(fullName LIKE :q1 OR username LIKE :q2 OR email LIKE :q3)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
    $params['q3'] = '%' . $search . '%';
  }

  // pendingSetup = an invited staff account that hasn't set its password yet
  // (the one-time token is cleared on activation), so the UI can flag it.
  $sql = 'SELECT userId, username, fullName, email, phoneNumber, role, status, created_at,
                 (setPasswordToken IS NOT NULL) AS pendingSetup
            FROM `user`';
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' ORDER BY created_at DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['pendingSetup'] = (bool) $r['pendingSetup']; }
  unset($r);
  sendJson(200, true, ['users' => $rows]);
}

// GET /admin/users/{userId} — one user with their role-specific profile.
function handleGetUser(PDO $pdo, string $userId): void {
  $stmt = $pdo->prepare(
    'SELECT userId, username, fullName, email, phoneNumber, avatarUrl, role, status, created_at, updated_at,
            (setPasswordToken IS NOT NULL) AS pendingSetup
       FROM `user` WHERE userId = :id'
  );
  $stmt->execute(['id' => $userId]);
  $u = $stmt->fetch();
  if (!$u) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'User not found.']);
  }
  $u['pendingSetup'] = (bool) $u['pendingSetup'];

  $profile = null;
  if ($u['role'] === 'Supplier') {
    $p = $pdo->prepare('SELECT supplierId, companyName, displayName, companyAddress, operationalAddress,
                               businessRegNo, businessLicenseUrl,
                               companyPhotoUrl, companyPhotoStatus
                          FROM supplier WHERE userId = :id');
  } elseif ($u['role'] === 'Customer') {
    $p = $pdo->prepare('SELECT customerId, shippingAddress FROM customer WHERE userId = :id');
  } elseif ($u['role'] === 'DeliveryPersonnel') {
    $p = $pdo->prepare('SELECT deliveryPersonnelId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate,
                               licenseNumber, licensePhotoUrl, licensePhotoBackUrl, licenseIsDigital, eLicenseUrl,
                               licenseClass, licenseExpiry,
                               icNumber, icPhotoUrl, icPhotoBackUrl, dateOfBirth, coverageZones
                          FROM delivery_personnel WHERE userId = :id');
  } elseif ($u['role'] === 'ArSpecialist') {
    $p = $pdo->prepare('SELECT arSpecialistId, icNumber FROM ar_specialist WHERE userId = :id');
  } else {
    $p = null;
  }
  if ($p) { $p->execute(['id' => $userId]); $profile = $p->fetch() ?: null; }
  $u['profile'] = $profile;

  sendJson(200, true, $u);
}

// PATCH /admin/users/{userId}/status — change a user's status. Body: { status }.
function handleSetUserStatus(PDO $pdo, array $auth, string $userId): void {
  $body   = getJsonBody();
  $status = trim($body['status'] ?? '');
  $allowed = ['Active', 'Suspended', 'Rejected', 'Deleted'];
  if (!in_array($status, $allowed, true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid status.']);
  }
  // safety: an admin can't lock themselves out or touch other admins here
  if (($auth['userId'] ?? '') === $userId) {
    sendJson(409, false, null, ['code' => 'SELF', 'message' => 'You cannot change your own account status.']);
  }

  $stmt = $pdo->prepare('SELECT role, status FROM `user` WHERE userId = :id');
  $stmt->execute(['id' => $userId]);
  $target = $stmt->fetch();
  if (!$target) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'User not found.']);
  }
  if ($target['role'] === 'Admin') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Admin accounts cannot be changed here.']);
  }

  // Only allow sensible transitions, so e.g. a Rejected/Banned applicant can't be
  // flipped to Active/Suspended by mistake (they resubmit + get re-reviewed).
  $allowedFrom = [
    'Active'    => ['Pending', 'Suspended'],                          // approve a pending applicant, or un-suspend
    'Suspended' => ['Active'],                                        // suspend an active account
    'Rejected'  => ['Pending'],                                       // reject a pending applicant
    'Deleted'   => ['Pending', 'Active', 'Suspended', 'Rejected', 'Banned'], // soft-delete anything live
  ];
  $current = $target['status'];
  if (!in_array($current, $allowedFrom[$status] ?? [], true)) {
    sendJson(409, false, null, ['code' => 'INVALID_TRANSITION',
      'message' => "Can't change a {$current} account to {$status} here."]);
  }

  $upd = $pdo->prepare('UPDATE `user` SET status = :s WHERE userId = :id');
  $upd->execute(['s' => $status, 'id' => $userId]);
  sendJson(200, true, ['userId' => $userId, 'status' => $status]);
}

// Generate a unique, readable username for a provisioned staff account from
// their full name (letters/digits only), appending a number on collision.
function generateStaffUsername(PDO $pdo, string $fullName): string {
  $base = strtolower(preg_replace('/[^a-z0-9]/i', '', $fullName));
  if ($base === '') { $base = 'arspecialist'; }
  $base = substr($base, 0, 20);
  $chk  = $pdo->prepare('SELECT 1 FROM `user` WHERE username = :u LIMIT 1');
  $candidate = $base;
  $n = 1;
  while (true) {
    $chk->execute(['u' => $candidate]);
    if (!$chk->fetchColumn()) { return $candidate; }
    $n++;
    $candidate = $base . $n;
  }
}

// POST /admin/staff — an admin provisions an internal-staff account. There is no
// public sign-up for staff (admins are seeded, suppliers self-register), so this
// is the only creation path. Currently the sole staff role is AR Specialist.
// Body: { fullName, email, role? }.
//
// No credential is ever emailed. The account is created with a random, unusable
// password; we email a ONE-TIME set-password LINK (a 48h token) and the staff
// member chooses their own password before they can sign in. The SYSTEM also
// generates the username (login is by email). So nothing sensitive is exposed
// in the email and the admin never knows the password.
function handleCreateStaff(PDO $pdo, array $config): void {
  $body     = getJsonBody();
  $email    = trim($body['email'] ?? '');
  $fullName = trim($body['fullName'] ?? '');
  $role     = trim($body['role'] ?? 'ArSpecialist');
  // optional identity fields (make the account clearly a real person)
  $phone    = trim($body['phoneNumber'] ?? '');
  $icNumber = trim($body['icNumber'] ?? '');

  // Only AR Specialist is provisionable here for now (guard against creating
  // Admins or anything else through this endpoint).
  if ($role !== 'ArSpecialist') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unsupported staff role.']);
  }
  if ($fullName === '' || mb_strlen($fullName) > 120) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is required and must be 120 characters or fewer.']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A valid email is required.']);
  }
  // light bounds on the optional fields (all may be left blank)
  if ($phone !== '' && mb_strlen($phone) > 20) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Phone number must be 20 characters or fewer.']);
  }
  if ($icNumber !== '' && mb_strlen($icNumber) > 20) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'IC / NRIC number must be 20 characters or fewer.']);
  }
  // We email the set-password link, so email must be configured.
  if (!mailConfigured($config)) {
    sendJson(503, false, null, ['code' => 'MAIL_NOT_CONFIGURED',
      'message' => 'Email sending is not configured, so the set-password invite cannot be sent. Configure SMTP before adding staff.']);
  }

  // email must be unique (username is generated, so it can't collide)
  $chk = $pdo->prepare('SELECT userId FROM `user` WHERE email = :e LIMIT 1');
  $chk->execute(['e' => $email]);
  if ($chk->fetchColumn()) {
    sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already in use.']);
  }

  $userId   = nextId($pdo, 'user', 'userId', 'USR');
  $arsId    = nextId($pdo, 'ar_specialist', 'arSpecialistId', 'ARS');
  $username = generateStaffUsername($pdo, $fullName);
  // Random, unusable password — nobody knows it. The staff member sets their own
  // via the emailed one-time link before they can sign in.
  $hash  = password_hash(bin2hex(random_bytes(18)), PASSWORD_BCRYPT);
  // One-time set-password token (unguessable). We store only its hash; the raw
  // token travels only in the emailed link. Reuse the password_reset store.
  $token = bin2hex(random_bytes(32));

  $pdo->beginTransaction();
  try {
    // Store the token HASH + a 48h expiry on the user row (isolated from the
    // forgot-password flow); the raw token travels only in the emailed link.
    $pdo->prepare(
      "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status, setPasswordToken, setPasswordExpires)
       VALUES (:id, :u, :pw, :e, :fn, :ph, 'ArSpecialist', 'Active', :tok, DATE_ADD(NOW(), INTERVAL 48 HOUR))"
    )->execute(['id' => $userId, 'u' => $username, 'pw' => $hash, 'e' => $email, 'fn' => $fullName,
                'ph' => $phone !== '' ? $phone : null,
                'tok' => password_hash($token, PASSWORD_BCRYPT)]);

    $pdo->prepare(
      'INSERT INTO ar_specialist (arSpecialistId, userId, icNumber) VALUES (:aid, :uid, :ic)'
    )->execute([
      'aid' => $arsId, 'uid' => $userId,
      'ic'  => $icNumber !== '' ? $icNumber : null,
    ]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'CREATE_FAILED', 'message' => 'Could not create the staff account.']);
  }

  // Build the set-password link (frontend route) and email it. No credential is
  // included. If the email fails, the account still exists — tell the admin.
  $appUrl  = rtrim((string) ($config['app_url'] ?? 'http://localhost:5173'), '/');
  $setUrl  = $appUrl . '/set-password?email=' . rawurlencode($email) . '&token=' . $token;
  $emailSent = true;
  try {
    sendStaffInviteEmail($config, $email, $fullName, $setUrl, 'ArSpecialist');
  } catch (Throwable $e) {
    $emailSent = false;
  }

  sendJson(201, true, [
    'userId'          => $userId,
    'arSpecialistId'  => $arsId,
    'username'        => $username,
    'email'           => $email,
    'fullName'        => $fullName,
    'role'            => 'ArSpecialist',
    'status'          => 'Active',
    'inviteEmailSent' => $emailSent,
  ]);
}

// PUT /admin/staff/{userId}/resend-invite — re-send the set-password invite for a
// staff account that hasn't activated yet, optionally correcting the email/name
// first (fixes a mistyped address). Issues a FRESH 48h token so any earlier link
// is invalidated. Only valid while the account is still pending (token present);
// once the staff member has set their password there's nothing to resend.
function handleResendStaffInvite(PDO $pdo, array $config, string $userId): void {
  $stmt = $pdo->prepare('SELECT userId, email, fullName, role, setPasswordToken FROM `user` WHERE userId = :id');
  $stmt->execute(['id' => $userId]);
  $u = $stmt->fetch();
  if (!$u) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'User not found.']);
  }
  if ($u['role'] !== 'ArSpecialist') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Only staff invites can be resent.']);
  }
  if (empty($u['setPasswordToken'])) {
    sendJson(409, false, null, ['code' => 'ALREADY_ACTIVE', 'message' => 'This account has already set its password — nothing to resend.']);
  }
  if (!mailConfigured($config)) {
    sendJson(503, false, null, ['code' => 'MAIL_NOT_CONFIGURED',
      'message' => 'Email sending is not configured, so the invite cannot be sent.']);
  }

  $body     = getJsonBody();
  $email    = array_key_exists('email', $body) ? trim((string) $body['email']) : (string) $u['email'];
  $fullName = array_key_exists('fullName', $body) ? trim((string) $body['fullName']) : (string) $u['fullName'];
  if ($fullName === '' || mb_strlen($fullName) > 120) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Full name is required and must be 120 characters or fewer.']);
  }
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A valid email is required.']);
  }
  if ($email !== $u['email']) {
    $chk = $pdo->prepare('SELECT userId FROM `user` WHERE email = :e AND userId <> :id LIMIT 1');
    $chk->execute(['e' => $email, 'id' => $userId]);
    if ($chk->fetchColumn()) {
      sendJson(409, false, null, ['code' => 'DUPLICATE', 'message' => 'That email is already in use.']);
    }
  }

  // Fresh one-time token (invalidates any earlier link) + apply the corrections.
  $token = bin2hex(random_bytes(32));
  $pdo->prepare(
    "UPDATE `user`
        SET email = :e, fullName = :fn,
            setPasswordToken = :tok, setPasswordExpires = DATE_ADD(NOW(), INTERVAL 48 HOUR)
      WHERE userId = :id"
  )->execute(['e' => $email, 'fn' => $fullName, 'tok' => password_hash($token, PASSWORD_BCRYPT), 'id' => $userId]);

  $appUrl = rtrim((string) ($config['app_url'] ?? 'http://localhost:5173'), '/');
  $setUrl = $appUrl . '/set-password?email=' . rawurlencode($email) . '&token=' . $token;
  $emailSent = true;
  try {
    sendStaffInviteEmail($config, $email, $fullName, $setUrl, 'ArSpecialist');
  } catch (Throwable $e) {
    $emailSent = false;
  }

  sendJson(200, true, [
    'userId'          => $userId,
    'email'           => $email,
    'fullName'        => $fullName,
    'inviteEmailSent' => $emailSent,
  ]);
}

// GET /ar/queue — try-on products still awaiting AR preparation: virtual try-on
// is enabled, a 3D model exists, and no AR-ready marker is set yet. This is the
// AR Specialist's work inbox (Admins can see it too). Approved products that
// already have their lens are excluded (their model row is stamped arReadyAt).
function handleListArQueue(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT p.productId, p.productName, p.productBrand, c.categoryName,
            s.companyName, p.productStatus, p.created_at,
            COALESCE(p.submittedAt, p.created_at) AS submittedAt,
            (SELECT pm.arLensId FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arLensId,
            (SELECT pm.arFlaggedAt IS NOT NULL FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arFlagged,
            (SELECT pm.arFlagNote FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) AS arFlagNote
       FROM product p
       JOIN supplier s ON s.supplierId = p.supplierId
       JOIN category c ON c.categoryId = p.categoryId
      WHERE p.virtualTryOnEnable = 1
        AND p.productStatus IN ('Pending', 'Approved')
        AND EXISTS (SELECT 1 FROM product_model pm WHERE pm.productId = p.productId)
        AND (SELECT pm.arReadyAt FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) IS NULL
      ORDER BY COALESCE(p.submittedAt, p.created_at) ASC"
  );
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['arFlagged'] = (bool) $r['arFlagged']; }
  unset($r);
  sendJson(200, true, ['products' => $rows]);
}

// GET /ar/stats — headline numbers for the AR Specialist dashboard + the sidebar
// badge: how many try-on products are awaiting prep, how many have been prepared
// in total, and how many in the last 7 days.
function handleArStats(PDO $pdo): void {
  // "Awaiting prep" = real AR work still to do, so flagged models (handed off to
  // the admin to reject) are excluded from the badge count.
  $awaiting = (int) $pdo->query(
    "SELECT COUNT(*) FROM product p
      WHERE p.virtualTryOnEnable = 1
        AND p.productStatus IN ('Pending', 'Approved')
        AND EXISTS (SELECT 1 FROM product_model pm WHERE pm.productId = p.productId)
        AND (SELECT pm.arReadyAt FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) IS NULL
        AND (SELECT pm.arFlaggedAt FROM product_model pm
              WHERE pm.productId = p.productId ORDER BY pm.productModelId LIMIT 1) IS NULL"
  )->fetchColumn();
  $prepared = (int) $pdo->query(
    "SELECT COUNT(*) FROM product_model WHERE arReadyAt IS NOT NULL"
  )->fetchColumn();
  $thisWeek = (int) $pdo->query(
    "SELECT COUNT(*) FROM product_model
      WHERE arReadyAt IS NOT NULL AND arReadyAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
  )->fetchColumn();
  sendJson(200, true, ['awaiting' => $awaiting, 'prepared' => $prepared, 'preparedThisWeek' => $thisWeek]);
}

// GET /ar/completed — the AR "Completed" history: products that have been made
// AR-ready, newest first, with when and which staff member prepared them.
function handleListArCompleted(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT p.productId, p.productName, p.productBrand, c.categoryName, p.productStatus,
            pm.arLensId, pm.arReadyAt, pm.arReadyBy AS preparedById, u.fullName AS preparedBy
       FROM product_model pm
       JOIN product p  ON p.productId  = pm.productId
       JOIN category c ON c.categoryId = p.categoryId
       LEFT JOIN `user` u ON u.userId = pm.arReadyBy
      WHERE pm.arReadyAt IS NOT NULL
      ORDER BY pm.arReadyAt DESC"
  );
  sendJson(200, true, ['products' => $stmt->fetchAll()]);
}

// ── supplier business-detail change requests ─────────────────────────
// GET /admin/supplier-changes — pending change requests with the current
// (live) values alongside the proposed ones, so the admin can see the diff.
function handleListChangeRequests(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT r.requestId, r.created_at,
            r.companyName AS newCompanyName, r.companyAddress AS newCompanyAddress,
            r.businessRegNo AS newBusinessRegNo,
            r.taxNumber AS newTaxNumber, r.businessLicenseUrl AS newBusinessLicenseUrl,
            s.supplierId, u.email, u.username,
            s.companyName AS curCompanyName, s.companyAddress AS curCompanyAddress,
            s.businessRegNo AS curBusinessRegNo,
            s.taxNumber AS curTaxNumber, s.businessLicenseUrl AS curBusinessLicenseUrl
       FROM supplier_change_request r
       JOIN supplier s ON s.supplierId = r.supplierId
       JOIN `user` u   ON u.userId = s.userId
      WHERE r.requestStatus = 'Pending'
      ORDER BY r.created_at ASC"
  );
  sendJson(200, true, ['requests' => $stmt->fetchAll()]);
}

// Load a still-Pending change request, or 404/409. Returns the request row.
function loadPendingChangeRequest(PDO $pdo, string $requestId): array {
  $stmt = $pdo->prepare('SELECT * FROM supplier_change_request WHERE requestId = :id');
  $stmt->execute(['id' => $requestId]);
  $req = $stmt->fetch();
  if (!$req) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Change request not found.']);
  }
  if ($req['requestStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This request has already been reviewed.']);
  }
  return $req;
}

// POST /admin/supplier-changes/{requestId}/approve — copy the proposed values
// onto the live supplier row (and mirror the company name onto user.fullName).
function handleApproveChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req = loadPendingChangeRequest($pdo, $requestId);

  $pdo->beginTransaction();
  try {
    $pdo->prepare(
      'UPDATE supplier
          SET companyName = :cn, companyAddress = :ca,
              companyLine1 = :cl1, companyPostcode = :cpc, companyCity = :cc, companyState = :cst,
              businessRegNo = :brn, taxNumber = :tax, businessLicenseUrl = :blu
        WHERE supplierId = :sid'
    )->execute([
      'cn' => $req['companyName'], 'ca' => $req['companyAddress'],
      'cl1' => $req['companyLine1'] ?? null, 'cpc' => $req['companyPostcode'] ?? null,
      'cc' => $req['companyCity'] ?? null, 'cst' => $req['companyState'] ?? null,
      'brn' => $req['businessRegNo'],
      'tax' => $req['taxNumber'], 'blu' => $req['businessLicenseUrl'],
      'sid' => $req['supplierId'],
    ]);

    // the supplier's display name mirrors the company name (as at registration)
    $pdo->prepare(
      'UPDATE `user` u
         JOIN supplier s ON s.userId = u.userId
          SET u.fullName = :cn
        WHERE s.supplierId = :sid'
    )->execute(['cn' => $req['companyName'], 'sid' => $req['supplierId']]);

    $pdo->prepare(
      "UPDATE supplier_change_request
          SET requestStatus = 'Approved', reviewedBy = :by, reviewed_at = NOW()
        WHERE requestId = :id"
    )->execute(['by' => $auth['userId'], 'id' => $requestId]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not apply the change. Please try again.']);
  }

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Approved']);
}

// POST /admin/supplier-changes/{requestId}/reject — body: { reason }.
// Leaves the live supplier row untouched; the supplier sees the reason.
function handleRejectChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req    = loadPendingChangeRequest($pdo, $requestId);
  $body   = getJsonBody();
  $reason = trim($body['reason'] ?? '');
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A reason is required so the supplier knows what to fix.']);
  }
  if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }

  $pdo->prepare(
    "UPDATE supplier_change_request
        SET requestStatus = 'Rejected', reviewNote = :rn, reviewedBy = :by, reviewed_at = NOW()
      WHERE requestId = :id"
  )->execute(['rn' => $reason, 'by' => $auth['userId'], 'id' => $requestId]);

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Rejected']);
}

// ── supplier company logo moderation ─────────────────────────────────
// GET /admin/company-photos — suppliers whose newly-uploaded company logo is
// awaiting review (the current approved logo, if any, is shown for comparison).
function handleListPendingCompanyPhotos(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT s.supplierId, s.companyName, s.displayName, u.email,
            s.companyPhotoUrl AS currentUrl, s.companyPhotoPendingUrl AS pendingUrl
       FROM supplier s JOIN `user` u ON u.userId = s.userId
      WHERE s.companyPhotoStatus = 'Pending'
      ORDER BY s.supplierId ASC"
  );
  sendJson(200, true, ['photos' => $stmt->fetchAll()]);
}

// POST /admin/suppliers/{supplierId}/company-photo/review — body { decision, reason? }.
// 'approve' → the pending logo becomes the live one; 'reject' → the upload is
// discarded (the previously-approved logo, if any, stays live) and a reason is
// recorded so the supplier knows why.
function handleReviewCompanyPhoto(PDO $pdo, array $auth, string $supplierId): void {
  $body     = getJsonBody();
  $decision = trim($body['decision'] ?? '');

  $stmt = $pdo->prepare('SELECT companyPhotoStatus FROM supplier WHERE supplierId = :sid');
  $stmt->execute(['sid' => $supplierId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Supplier not found.']);
  }
  if ($row['companyPhotoStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'There is no pending company logo to review.']);
  }

  if ($decision === 'approve') {
    $pdo->prepare(
      "UPDATE supplier
          SET companyPhotoUrl = companyPhotoPendingUrl, companyPhotoPendingUrl = NULL,
              companyPhotoStatus = 'Approved', companyPhotoNote = NULL
        WHERE supplierId = :sid"
    )->execute(['sid' => $supplierId]);
    sendJson(200, true, ['supplierId' => $supplierId, 'companyPhotoStatus' => 'Approved']);
  } elseif ($decision === 'reject') {
    $reason = trim($body['reason'] ?? '');
    if ($reason === '') {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A reason is required so the supplier knows what to fix.']);
    }
    if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }
    $pdo->prepare(
      "UPDATE supplier
          SET companyPhotoPendingUrl = NULL, companyPhotoStatus = 'Rejected', companyPhotoNote = :rn
        WHERE supplierId = :sid"
    )->execute(['rn' => $reason, 'sid' => $supplierId]);
    sendJson(200, true, ['supplierId' => $supplierId, 'companyPhotoStatus' => 'Rejected']);
  } else {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Decision must be approve or reject.']);
  }
}

// ── content flags (reactive moderation of public review avatars) ─────
// GET /admin/flags — open flags with reporter, target (name + avatar + status)
// and the reported review's text for context.
function handleListFlags(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT f.flagId, f.reason, f.created_at, f.reviewId,
            rep.userId    AS reporterUserId, rep.fullName AS reporterName,
            rep.email     AS reporterEmail,  rep.role     AS reporterRole,
            tgt.userId    AS targetUserId,   tgt.fullName AS targetName,
            tgt.email     AS targetEmail,    tgt.role     AS targetRole,
            tgt.avatarUrl AS targetAvatar,   tgt.status   AS targetStatus,
            r.reviewComment, r.ratingScore, r.reviewStatus, p.productName
       FROM content_flag f
       JOIN `user` rep ON rep.userId = f.reporterUserId
       JOIN `user` tgt ON tgt.userId = f.targetUserId
       LEFT JOIN review  r ON r.reviewId = f.reviewId
       LEFT JOIN product p ON p.productId = r.productId
      WHERE f.flagStatus = 'Open'
      ORDER BY f.created_at ASC"
  );
  sendJson(200, true, ['flags' => $stmt->fetchAll()]);
}

// POST /admin/flags/{flagId}/resolve — body { action, note? }.
// action: 'remove_avatar' (clear the target's avatar), 'suspend' (suspend the
// target), or 'dismiss' (no action). remove_avatar/suspend also resolve every
// other open flag for the same target so the queue clears.
function handleResolveFlag(PDO $pdo, array $auth, string $flagId): void {
  $body   = getJsonBody();
  $action = trim($body['action'] ?? '');
  $note   = trim($body['note'] ?? '');
  if (mb_strlen($note) > 255) { $note = mb_substr($note, 0, 255); }

  $stmt = $pdo->prepare('SELECT flagStatus, targetUserId, reviewId FROM content_flag WHERE flagId = :id');
  $stmt->execute(['id' => $flagId]);
  $flag = $stmt->fetch();
  if (!$flag) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Flag not found.']);
  }
  if ($flag['flagStatus'] !== 'Open') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This flag has already been handled.']);
  }
  $target = $flag['targetUserId'];

  if ($action === 'dismiss') {
    $pdo->prepare("UPDATE content_flag SET flagStatus='Dismissed', resolutionNote=:n, reviewedBy=:by, reviewed_at=NOW() WHERE flagId=:id")
        ->execute(['n' => $note !== '' ? $note : null, 'by' => $auth['userId'], 'id' => $flagId]);
    sendJson(200, true, ['flagId' => $flagId, 'flagStatus' => 'Dismissed']);
  }

  if ($action === 'remove_avatar' || $action === 'suspend') {
    $pdo->beginTransaction();
    try {
      if ($action === 'remove_avatar') {
        $pdo->prepare("UPDATE `user` SET avatarUrl = NULL WHERE userId = :id")->execute(['id' => $target]);
      } else { // suspend — never an admin
        $pdo->prepare("UPDATE `user` SET status = 'Suspended' WHERE userId = :id AND role <> 'Admin'")->execute(['id' => $target]);
      }
      // resolve this flag + any other open flags for the same target
      $pdo->prepare(
        "UPDATE content_flag SET flagStatus='Resolved', resolutionNote=:n, reviewedBy=:by, reviewed_at=NOW()
          WHERE targetUserId = :tgt AND flagStatus = 'Open'"
      )->execute(['n' => $note !== '' ? $note : $action, 'by' => $auth['userId'], 'tgt' => $target]);
      $pdo->commit();
    } catch (Throwable $e) {
      $pdo->rollBack();
      sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not resolve the flag.']);
    }
    sendJson(200, true, ['flagId' => $flagId, 'flagStatus' => 'Resolved', 'action' => $action]);
  }

  // Take down the flagged REVIEW itself (the proportionate action for a content
  // report — abusive/spam text — vs suspending the whole account). Resolves
  // every open flag on that same review so the queue clears.
  if ($action === 'remove_review') {
    if (empty($flag['reviewId'])) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'This report is not linked to a review.']);
    }
    $pdo->beginTransaction();
    try {
      $pdo->prepare("UPDATE review SET reviewStatus = 'Removed' WHERE reviewId = :rid")
          ->execute(['rid' => $flag['reviewId']]);
      $pdo->prepare(
        "UPDATE content_flag SET flagStatus='Resolved', resolutionNote=:n, reviewedBy=:by, reviewed_at=NOW()
          WHERE reviewId = :rid AND flagStatus = 'Open'"
      )->execute(['n' => $note !== '' ? $note : 'remove_review', 'by' => $auth['userId'], 'rid' => $flag['reviewId']]);
      $pdo->commit();
    } catch (Throwable $e) {
      $pdo->rollBack();
      sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not remove the review.']);
    }
    sendJson(200, true, ['flagId' => $flagId, 'flagStatus' => 'Resolved', 'action' => 'remove_review']);
  }

  sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown action.']);
}

// ── courier vehicle/licence change requests ──────────────────────────
// GET /admin/courier-changes — pending plate/licence change requests with the
// current (live) values alongside the proposed ones, so the admin sees the diff.
function handleListCourierChangeRequests(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT r.requestId, r.created_at,
            r.vehiclePlate AS newPlate, r.licenseNumber AS newLicenseNumber,
            r.licenseClass AS newLicenseClass, r.licenseExpiry AS newLicenseExpiry,
            r.licensePhotoUrl AS newLicensePhotoUrl, r.licensePhotoBackUrl AS newLicensePhotoBackUrl,
            r.licenseIsDigital AS newLicenseIsDigital, r.eLicenseUrl AS newELicenseUrl,
            dp.deliveryPersonnelId, u.fullName, u.email, u.username,
            dp.vehiclePlate AS curPlate, dp.licenseNumber AS curLicenseNumber,
            dp.licenseClass AS curLicenseClass, dp.licenseExpiry AS curLicenseExpiry,
            dp.licensePhotoUrl AS curLicensePhotoUrl, dp.licensePhotoBackUrl AS curLicensePhotoBackUrl,
            dp.licenseIsDigital AS curLicenseIsDigital, dp.eLicenseUrl AS curELicenseUrl
       FROM courier_change_request r
       JOIN delivery_personnel dp ON dp.deliveryPersonnelId = r.deliveryPersonnelId
       JOIN `user` u              ON u.userId = dp.userId
      WHERE r.requestStatus = 'Pending'
      ORDER BY r.created_at ASC"
  );
  sendJson(200, true, ['requests' => $stmt->fetchAll()]);
}

// Load a still-Pending courier change request, or 404/409. Returns the row.
function loadPendingCourierChangeRequest(PDO $pdo, string $requestId): array {
  $stmt = $pdo->prepare('SELECT * FROM courier_change_request WHERE requestId = :id');
  $stmt->execute(['id' => $requestId]);
  $req = $stmt->fetch();
  if (!$req) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Change request not found.']);
  }
  if ($req['requestStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This request has already been reviewed.']);
  }
  return $req;
}

// POST /admin/courier-changes/{requestId}/approve — copy the proposed plate +
// licence values onto the live delivery_personnel row.
function handleApproveCourierChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req = loadPendingCourierChangeRequest($pdo, $requestId);

  $pdo->beginTransaction();
  try {
    // Copy the proposed plate + licence values onto the live courier row. The IC
    // is a fixed identity document and is never part of a change request, so it's
    // left untouched. Resetting the licence-expiry reminder bookkeeping re-arms
    // the reminders for the (possibly new) expiry date.
    $pdo->prepare(
      'UPDATE delivery_personnel
          SET vehiclePlate = :plate, licenseNumber = :ln, licenseClass = :lc,
              licenseExpiry = :le, licensePhotoUrl = :lp, licensePhotoBackUrl = :lpb,
              licenseIsDigital = :lid, eLicenseUrl = :el,
              licenceReminderStage = NULL, licenceReminderFor = NULL
        WHERE deliveryPersonnelId = :id'
    )->execute([
      'plate' => $req['vehiclePlate'], 'ln' => $req['licenseNumber'],
      'lc' => $req['licenseClass'], 'le' => $req['licenseExpiry'],
      'lp' => $req['licensePhotoUrl'], 'lpb' => $req['licensePhotoBackUrl'],
      'lid' => (int) ($req['licenseIsDigital'] ?? 0), 'el' => $req['eLicenseUrl'],
      'id' => $req['deliveryPersonnelId'],
    ]);

    $pdo->prepare(
      "UPDATE courier_change_request
          SET requestStatus = 'Approved', reviewedBy = :by, reviewed_at = NOW()
        WHERE requestId = :id"
    )->execute(['by' => $auth['userId'], 'id' => $requestId]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not apply the change. Please try again.']);
  }

  // Tell the courier the outcome (in-app notification + best-effort FCM push).
  if (function_exists('createNotification')) {
    $uid = courierUserId($pdo, (string) $req['deliveryPersonnelId']);
    if ($uid !== '') {
      createNotification($pdo, $uid, 'system', 'Vehicle & licence change approved ✓',
        'Your updated plate / driving-licence details have been approved and are now active.');
    }
  }

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Approved']);
}

// POST /admin/courier-changes/{requestId}/reject — body: { reason }.
function handleRejectCourierChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req    = loadPendingCourierChangeRequest($pdo, $requestId);
  $body   = getJsonBody();
  $reason = trim($body['reason'] ?? '');
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A reason is required so the courier knows what to fix.']);
  }
  if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }

  $pdo->prepare(
    "UPDATE courier_change_request
        SET requestStatus = 'Rejected', reviewNote = :rn, reviewedBy = :by, reviewed_at = NOW()
      WHERE requestId = :id"
  )->execute(['rn' => $reason, 'by' => $auth['userId'], 'id' => $requestId]);

  // Tell the courier why it was rejected (in-app notification + FCM push) so
  // they can fix it and resubmit without waiting to stumble on the screen.
  if (function_exists('createNotification')) {
    $uid = courierUserId($pdo, (string) $req['deliveryPersonnelId']);
    if ($uid !== '') {
      createNotification($pdo, $uid, 'system', 'Vehicle & licence change rejected',
        'Reason: ' . $reason . ' — open Profile → Vehicle & licence to correct it and resubmit.');
    }
  }

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Rejected']);
}

// Resolve the user behind a delivery_personnel id (for notifications). '' if gone.
function courierUserId(PDO $pdo, string $deliveryPersonnelId): string {
  try {
    $stmt = $pdo->prepare('SELECT userId FROM delivery_personnel WHERE deliveryPersonnelId = :id');
    $stmt->execute(['id' => $deliveryPersonnelId]);
    return (string) ($stmt->fetchColumn() ?: '');
  } catch (Throwable $e) {
    return '';
  }
}

// GET /admin/badge-counts — one cheap call powering the sidebar work-queue
// badges: how many items in each queue are waiting for the admin to act. The
// web app polls this periodically so the admin sees pending work at a glance.
function adminBadgeCounts(PDO $pdo): array {
  $counts = [
    // Main / Moderation approval queues
    'suppliers'  => "SELECT COUNT(*) FROM `user` WHERE role = 'Supplier' AND status = 'Pending'",
    'couriers'   => "SELECT COUNT(*) FROM `user` WHERE role = 'DeliveryPersonnel' AND status = 'Pending'",
    'changes'    => "SELECT (SELECT COUNT(*) FROM supplier_change_request WHERE requestStatus = 'Pending')
                            + (SELECT COUNT(*) FROM supplier WHERE companyPhotoStatus = 'Pending')",
    'courierChanges' => "SELECT COUNT(*) FROM courier_change_request WHERE requestStatus = 'Pending'",
    'products'   => "SELECT COUNT(*) FROM product WHERE productStatus = 'Pending'",
    // Operations queues
    'deliveries' => "SELECT COUNT(*) FROM delivery WHERE deliveryPersonnelId IS NULL AND deliveryMethod = 'InHouse'",
    'issues'     => "SELECT COUNT(*) FROM delivery_issue WHERE issueStatus = 'Open'",
    'refunds'    => "SELECT COUNT(*) FROM refund WHERE refundStatus = 'Pending'",
    'flags'      => "SELECT COUNT(*) FROM content_flag WHERE flagStatus = 'Open'",
    // Finance: approved couriers who still haven't set up a payout account
    'courierPayouts' => "SELECT COUNT(*) FROM delivery_personnel dp JOIN `user` u ON u.userId = dp.userId
                           WHERE u.role = 'DeliveryPersonnel' AND u.status = 'Active' AND dp.payoutsEnabled = 0",
  ];
  $out = [];
  foreach ($counts as $key => $sql) {
    $out[$key] = (int) $pdo->query($sql)->fetchColumn();
  }
  return $out;
}

function handleAdminBadgeCounts(PDO $pdo): void {
  sendJson(200, true, ['counts' => adminBadgeCounts($pdo)]);
}
