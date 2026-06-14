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
            s.companyName, s.companyAddress, s.businessRegNo,
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
          SET companyName = :cn, companyAddress = :ca, businessRegNo = :brn,
              businessLicenseUrl = :blu, taxNumber = :tax
        WHERE userId = :id'
    )->execute([
      'cn' => $companyName, 'ca' => $companyAddress, 'brn' => $businessRegNo,
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
