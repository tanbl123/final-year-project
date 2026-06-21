<?php
// Supplier self-service for the registration application itself — used by the
// "fix & resubmit" flow after a (curable) rejection. Approving/rejecting lives
// in AdminController; this is the supplier's own side.

// GET /supplier/application — the caller's own application, for prefilling the
// resubmission form. Returns the editable business fields plus the account
// status and any rejection reason so the supplier knows what to fix.
function handleGetApplication(PDO $pdo, array $auth): void {
  requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT u.username, u.email, u.phoneNumber, u.status, u.rejectionReason,
            s.companyName, s.companyAddress, s.operationalAddress, s.businessRegNo,
            s.businessLicenseUrl, s.taxNumber
       FROM `user` u
       JOIN supplier s ON s.userId = u.userId
      WHERE u.userId = :id'
  );
  $stmt->execute(['id' => $auth['userId']]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Application not found.']);
  }
  sendJson(200, true, $row);
}

// PUT /supplier/bank-account — the supplier sets/updates the bank account their
// payouts are sent to. All three fields go together (you can't have a partial
// account); the account number is digits only, 5–20 long.
function handleUpdateBankAccount(PDO $pdo, array $auth): void {
  requireSupplierId($pdo, $auth);

  $body       = getJsonBody();
  $bankName    = trim($body['bankName'] ?? '');
  $accountName = trim($body['bankAccountName'] ?? '');
  $accountNo   = trim($body['bankAccountNumber'] ?? '');

  if ($bankName === '' || $accountName === '' || $accountNo === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Bank name, account holder name and account number are all required.']);
  }
  if (!preg_match('/^\d{5,20}$/', $accountNo)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Account number must be 5–20 digits.']);
  }

  $upd = $pdo->prepare(
    'UPDATE supplier
        SET bankName = :bn, bankAccountName = :an, bankAccountNumber = :no
      WHERE userId = :id'
  );
  $upd->execute(['bn' => $bankName, 'an' => $accountName, 'no' => $accountNo, 'id' => $auth['userId']]);

  sendJson(200, true, [
    'bankName'          => $bankName,
    'bankAccountName'   => $accountName,
    'bankAccountNumber' => $accountNo,
  ]);
}

// POST /supplier/application/resubmit — the supplier corrects the details an
// admin flagged and resubmits. Only allowed from the 'Rejected' state; flips the
// account back to 'Pending' for re-review and clears the old rejection reason.
// Login email + username are identity and stay fixed; everything else is editable.
function handleResubmitApplication(PDO $pdo, array $auth): void {
  requireSupplierId($pdo, $auth);

  // must currently be a rejected (curable) application
  $cur = $pdo->prepare('SELECT status FROM `user` WHERE userId = :id');
  $cur->execute(['id' => $auth['userId']]);
  $status = $cur->fetchColumn();
  if ($status !== 'Rejected') {
    sendJson(409, false, null, ['code' => 'NOT_REJECTED', 'message' => 'Only a rejected application can be resubmitted.']);
  }

  $body               = getJsonBody();
  $phoneNumber        = trim($body['phoneNumber'] ?? '');
  $companyName        = trim($body['companyName'] ?? '');
  $companyAddress     = trim($body['companyAddress'] ?? '');
  $operationalAddress = trim($body['operationalAddress'] ?? '');
  if ($operationalAddress === '') $operationalAddress = $companyAddress;
  $businessRegNo      = trim($body['businessRegNo'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');
  $taxNumber          = trim($body['taxNumber'] ?? '');     // optional

  if ($companyName === '' || $companyAddress === '' || $phoneNumber === ''
      || $businessRegNo === '' || $businessLicenseUrl === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'All fields are required.']);
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
  if (mb_strlen($operationalAddress) > 255) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Operational address is too long.']);
  }

  // the supplier's display name IS their company name (mirrors registration)
  $pdo->beginTransaction();
  try {
    $pdo->prepare(
      'UPDATE `user`
          SET fullName = :fn, phoneNumber = :ph, status = "Pending", rejectionReason = NULL
        WHERE userId = :id'
    )->execute(['fn' => $companyName, 'ph' => $phoneNumber, 'id' => $auth['userId']]);

    $pdo->prepare(
      'UPDATE supplier
          SET companyName = :cn, companyAddress = :ca, operationalAddress = :oa,
              businessRegNo = :brn, businessLicenseUrl = :blu, taxNumber = :tax
        WHERE userId = :id'
    )->execute([
      'cn' => $companyName, 'ca' => $companyAddress, 'oa' => $operationalAddress,
      'brn' => $businessRegNo,
      'blu' => $businessLicenseUrl, 'tax' => ($taxNumber === '' ? null : $taxNumber),
      'id' => $auth['userId'],
    ]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not resubmit. Please try again.']);
  }

  sendJson(200, true, ['status' => 'Pending', 'message' => 'Application resubmitted for review.']);
}

// ── business details (post-approval changes via admin re-approval) ──────
// Shared validation for the sensitive business fields. Returns an error
// message, or null when everything is valid. (Mirrors the registration rules.)
function businessDetailsError(string $companyName, string $businessRegNo, string $businessLicenseUrl, string $taxNumber): ?string {
  if ($companyName === '' || $businessRegNo === '' || $businessLicenseUrl === '') {
    return 'Company name, SSM number and the registration document are required.';
  }
  if (!preg_match('/^(\d{12}|\d{6,8}-?[A-Za-z])$/', $businessRegNo)) {
    return 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.';
  }
  if ($taxNumber !== '' && !preg_match('/^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/', $taxNumber)) {
    return 'Enter a valid SST number, e.g. W10-1808-32000001.';
  }
  return null;
}

// GET /supplier/business-details — the supplier's current verified business
// fields plus any open (Pending) change request, so the profile can show the
// live values and a "changes pending review" banner.
function handleGetBusinessDetails(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $cur = $pdo->prepare(
    'SELECT companyName, companyAddress, operationalAddress, businessRegNo, taxNumber, businessLicenseUrl
       FROM supplier WHERE supplierId = :sid'
  );
  $cur->execute(['sid' => $supplierId]);
  $current = $cur->fetch();

  // the most recent request (Pending shows as a live banner; Rejected lets the
  // supplier see why their last attempt was turned down)
  $req = $pdo->prepare(
    'SELECT requestId, companyName, businessRegNo, taxNumber, businessLicenseUrl,
            requestStatus, reviewNote, created_at, reviewed_at
       FROM supplier_change_request
      WHERE supplierId = :sid
      ORDER BY created_at DESC LIMIT 1'
  );
  $req->execute(['sid' => $supplierId]);
  $latest = $req->fetch() ?: null;

  sendJson(200, true, ['current' => $current, 'latestRequest' => $latest]);
}

// PUT /supplier/company-address — company address is operational (not part of
// verified identity), so the supplier can change it freely, no review needed.
function handleUpdateCompanyAddress(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body    = getJsonBody();
  $address = trim($body['companyAddress'] ?? '');
  if ($address === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Company address is required.']);
  }
  if (mb_strlen($address) > 255) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Company address is too long.']);
  }
  $pdo->prepare('UPDATE supplier SET companyAddress = :ca WHERE supplierId = :sid')
      ->execute(['ca' => $address, 'sid' => $supplierId]);
  sendJson(200, true, ['companyAddress' => $address]);
}

// PUT /supplier/operational-address — the operational (pickup) address is where
// couriers collect orders. It's logistics, not verified identity, so the
// supplier can change it freely with no admin review.
function handleUpdateOperationalAddress(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body    = getJsonBody();
  $address = trim($body['operationalAddress'] ?? '');
  if ($address === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Operational address is required.']);
  }
  if (mb_strlen($address) > 255) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Operational address is too long.']);
  }
  $pdo->prepare('UPDATE supplier SET operationalAddress = :oa WHERE supplierId = :sid')
      ->execute(['oa' => $address, 'sid' => $supplierId]);
  sendJson(200, true, ['operationalAddress' => $address]);
}

// POST /supplier/business-details/change-request — propose new values for the
// verified fields (company name, SSM, SST, document). The account stays Active;
// an admin reviews and approves/rejects. Only one open request at a time.
function handleSubmitChangeRequest(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $body               = getJsonBody();
  $companyName        = trim($body['companyName'] ?? '');
  $businessRegNo      = trim($body['businessRegNo'] ?? '');
  $taxNumber          = trim($body['taxNumber'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');

  $err = businessDetailsError($companyName, $businessRegNo, $businessLicenseUrl, $taxNumber);
  if ($err !== null) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $err]);
  }

  // one open request at a time
  $open = $pdo->prepare(
    "SELECT 1 FROM supplier_change_request WHERE supplierId = :sid AND requestStatus = 'Pending'"
  );
  $open->execute(['sid' => $supplierId]);
  if ($open->fetch()) {
    sendJson(409, false, null, ['code' => 'PENDING_EXISTS', 'message' => 'You already have a change pending review.']);
  }

  $requestId = nextId($pdo, 'supplier_change_request', 'requestId', 'SCR');
  $pdo->prepare(
    'INSERT INTO supplier_change_request
       (requestId, supplierId, companyName, businessRegNo, taxNumber, businessLicenseUrl)
     VALUES (:rid, :sid, :cn, :brn, :tax, :blu)'
  )->execute([
    'rid' => $requestId, 'sid' => $supplierId, 'cn' => $companyName,
    'brn' => $businessRegNo, 'tax' => ($taxNumber === '' ? null : $taxNumber),
    'blu' => $businessLicenseUrl,
  ]);

  sendJson(201, true, ['requestId' => $requestId, 'status' => 'Pending',
    'message' => 'Your changes were submitted for admin review.']);
}
