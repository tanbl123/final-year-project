<?php
// Courier-facing self-service for the verified vehicle/licence fields. The
// plate number and driving-licence details decide who is legally allowed to
// deliver, so (like the supplier KYB fields) an approved courier can't edit
// them directly — they propose a change here and an admin re-approves. The
// account stays Active and keeps delivering while a request is pending.
//
// Operational fields (name, phone, vehicle type/brand/model, coverage zones)
// are NOT handled here — those stay instantly editable via PUT /auth/me.

const COURIER_LICENSE_CLASSES = ['B2', 'B', 'D', 'DA', 'E', 'E1', 'E2'];

// Resolve the caller's delivery_personnel id, or 404.
function courierIdForAuth(PDO $pdo, array $auth): string {
  $stmt = $pdo->prepare('SELECT deliveryPersonnelId FROM delivery_personnel WHERE userId = :uid');
  $stmt->execute(['uid' => $auth['userId']]);
  $id = $stmt->fetchColumn();
  if (!$id) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Courier profile not found.']);
  }
  return (string) $id;
}

// Validate the proposed plate + licence values. Returns an error message or null.
function courierVerificationError(string $plate, string $licenseNumber, array $classes, string $licenseExpiry, string $licensePhotoUrl): ?string {
  if (mb_strlen($plate) < 3 || !preg_match('/^[A-Za-z0-9 \-]+$/', $plate)) {
    return 'Enter a valid plate number (letters, numbers, spaces or hyphens).';
  }
  if ($licenseNumber === '') {
    return 'Driving licence number is required.';
  }
  if (mb_strlen($licenseNumber) > 20) {
    return 'Licence number is too long (max 20 characters).';
  }
  if (count($classes) === 0) {
    return 'Please select at least one driving licence class.';
  }
  foreach ($classes as $lc) {
    if (!in_array($lc, COURIER_LICENSE_CLASSES, true)) {
      return 'One of the selected licence classes is invalid.';
    }
  }
  $exp = DateTime::createFromFormat('Y-m-d', $licenseExpiry);
  if (!$exp || $exp->format('Y-m-d') !== $licenseExpiry) {
    return 'Please provide a valid licence expiry date.';
  }
  if ($exp <= new DateTime('today')) {
    return 'Your driving licence has expired — please renew it before updating.';
  }
  if ($licensePhotoUrl === '') {
    return 'Please upload a photo of your driving licence.';
  }
  return null;
}

// GET /courier/verification — the courier's current verified vehicle/licence
// fields plus the latest change request (Pending → live banner; Rejected → why
// the last attempt was turned down).
function handleGetCourierVerification(PDO $pdo, array $auth): void {
  $courierId = courierIdForAuth($pdo, $auth);

  $cur = $pdo->prepare(
    'SELECT vehiclePlate, licenseNumber, licenseClass, licenseExpiry, licensePhotoUrl
       FROM delivery_personnel WHERE deliveryPersonnelId = :id'
  );
  $cur->execute(['id' => $courierId]);
  $current = $cur->fetch();

  $req = $pdo->prepare(
    'SELECT requestId, vehiclePlate, licenseNumber, licenseClass, licenseExpiry, licensePhotoUrl,
            requestStatus, reviewNote, created_at, reviewed_at
       FROM courier_change_request
      WHERE deliveryPersonnelId = :id
      ORDER BY created_at DESC LIMIT 1'
  );
  $req->execute(['id' => $courierId]);
  $latest = $req->fetch() ?: null;

  sendJson(200, true, ['current' => $current, 'latestRequest' => $latest]);
}

// POST /courier/verification/change-request — propose new plate/licence values.
function handleSubmitCourierChangeRequest(PDO $pdo, array $auth): void {
  $courierId = courierIdForAuth($pdo, $auth);
  $body = getJsonBody();

  $plate    = strtoupper(trim((string) ($body['vehiclePlate'] ?? '')));
  $licNo    = trim((string) ($body['licenseNumber'] ?? ''));
  $licPhoto = trim((string) ($body['licensePhotoUrl'] ?? ''));
  $licExp   = trim((string) ($body['licenseExpiry'] ?? ''));
  $rawCls   = $body['licenseClass'] ?? [];
  if (is_string($rawCls)) { $rawCls = explode(',', $rawCls); }
  $classes  = is_array($rawCls)
    ? array_values(array_unique(array_filter(array_map('trim', $rawCls)))) : [];

  $err = courierVerificationError($plate, $licNo, $classes, $licExp, $licPhoto);
  if ($err !== null) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $err]);
  }

  // one open request at a time
  $open = $pdo->prepare(
    "SELECT 1 FROM courier_change_request WHERE deliveryPersonnelId = :id AND requestStatus = 'Pending'"
  );
  $open->execute(['id' => $courierId]);
  if ($open->fetch()) {
    sendJson(409, false, null, ['code' => 'PENDING_EXISTS', 'message' => 'You already have a change pending review.']);
  }

  $requestId = nextId($pdo, 'courier_change_request', 'requestId', 'CCR');
  $pdo->prepare(
    'INSERT INTO courier_change_request
       (requestId, deliveryPersonnelId, vehiclePlate, licenseNumber, licenseClass, licenseExpiry, licensePhotoUrl)
     VALUES (:rid, :id, :plate, :ln, :lc, :le, :lp)'
  )->execute([
    'rid' => $requestId, 'id' => $courierId, 'plate' => $plate,
    'ln' => $licNo, 'lc' => implode(',', $classes), 'le' => $licExp, 'lp' => $licPhoto,
  ]);

  sendJson(201, true, ['requestId' => $requestId, 'status' => 'Pending',
    'message' => 'Your changes were submitted for admin review.']);
}
