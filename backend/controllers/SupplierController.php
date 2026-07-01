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
            s.companyName, s.companyAddress,
            s.companyLine1, s.companyPostcode, s.companyCity, s.companyState,
            s.operationalAddress,
            s.operationalLine1, s.operationalPostcode, s.operationalCity, s.operationalState,
            s.businessRegNo, s.businessLicenseUrl, s.taxNumber
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
  // structured business address (new client) → compose; else combined string
  $coAddr = readStructuredAddress($body, 'company');
  $coStructured = hasStructuredAddress($coAddr);
  if ($coStructured) {
    $coErr = structuredAddressError($coAddr);
    if ($coErr) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $coErr]);
    }
    $companyAddress = composeAddress($coAddr);
  } else {
    $companyAddress = trim($body['companyAddress'] ?? '');
  }
  // structured operational (pickup) address (new client) → compose; else combined
  $opAddr = readStructuredAddress($body, 'operational');
  $opStructured = hasStructuredAddress($opAddr);
  if ($opStructured) {
    $opErr = structuredAddressError($opAddr);
    if ($opErr) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $opErr]);
    }
    $operationalAddress = composeAddress($opAddr);
  } else {
    $operationalAddress = trim($body['operationalAddress'] ?? '');
    if ($operationalAddress === '') $operationalAddress = $companyAddress;
  }
  $businessRegNo      = trim($body['businessRegNo'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');
  $taxNumber          = trim($body['taxNumber'] ?? '');     // optional

  if ($companyName === '' || $companyAddress === '' || $phoneNumber === ''
      || $businessRegNo === '' || $businessLicenseUrl === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'All fields are required.']);
  }
  // Malaysian phone: local (0XX...) or international (+60.../60...)
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
          SET companyName = :cn, companyAddress = :ca,
              companyLine1 = :cl1, companyPostcode = :cpc, companyCity = :cc, companyState = :cst,
              operationalAddress = :oa,
              operationalLine1 = :ol1, operationalPostcode = :opc, operationalCity = :oc, operationalState = :ost,
              businessRegNo = :brn, businessLicenseUrl = :blu, taxNumber = :tax
        WHERE userId = :id'
    )->execute([
      'cn' => $companyName, 'ca' => $companyAddress,
      'cl1' => $coStructured ? $coAddr['line1'] : null,
      'cpc' => $coStructured ? $coAddr['postcode'] : null,
      'cc'  => $coStructured ? $coAddr['city'] : null,
      'cst' => $coStructured ? $coAddr['state'] : null,
      'oa' => $operationalAddress,
      'ol1' => $opStructured ? $opAddr['line1'] : null,
      'opc' => $opStructured ? $opAddr['postcode'] : null,
      'oc'  => $opStructured ? $opAddr['city'] : null,
      'ost' => $opStructured ? $opAddr['state'] : null,
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
function businessDetailsError(string $companyName, string $companyAddress, string $businessRegNo, string $businessLicenseUrl, string $taxNumber): ?string {
  if ($companyName === '' || $companyAddress === '' || $businessRegNo === '' || $businessLicenseUrl === '') {
    return 'Company name, business address, SSM number and the registration document are required.';
  }
  if (mb_strlen($companyAddress) > 255) {
    return 'Business address is too long.';
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
    'SELECT companyName, companyAddress,
            companyLine1, companyPostcode, companyCity, companyState,
            operationalAddress,
            operationalLine1, operationalPostcode, operationalCity, operationalState,
            businessRegNo, taxNumber, businessLicenseUrl
       FROM supplier WHERE supplierId = :sid'
  );
  $cur->execute(['sid' => $supplierId]);
  $current = $cur->fetch();

  // the most recent request (Pending shows as a live banner; Rejected lets the
  // supplier see why their last attempt was turned down)
  $req = $pdo->prepare(
    'SELECT requestId, companyName, companyAddress,
            companyLine1, companyPostcode, companyCity, companyState,
            businessRegNo, taxNumber, businessLicenseUrl,
            requestStatus, reviewNote, created_at, reviewed_at
       FROM supplier_change_request
      WHERE supplierId = :sid
      ORDER BY created_at DESC LIMIT 1'
  );
  $req->execute(['sid' => $supplierId]);
  $latest = $req->fetch() ?: null;

  sendJson(200, true, ['current' => $current, 'latestRequest' => $latest]);
}

// PUT /supplier/operational-address — the operational (pickup) address is where
// couriers collect orders. It's logistics, not verified identity, so the
// supplier can change it freely with no admin review.
function handleUpdateOperationalAddress(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body = getJsonBody();

  // New client sends a STRUCTURED address; store the parts (routing source of
  // truth) plus the composed single line. Older clients send only the combined
  // string, which still works but leaves the structured columns untouched.
  $opAddr = readStructuredAddress($body, 'operational');
  if (hasStructuredAddress($opAddr)) {
    $err = structuredAddressError($opAddr);
    if ($err) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $err]);
    }
    $combined = composeAddress($opAddr);
    $pdo->prepare(
      'UPDATE supplier
          SET operationalAddress = :oa, operationalLine1 = :ol1,
              operationalPostcode = :opc, operationalCity = :oc, operationalState = :ost
        WHERE supplierId = :sid'
    )->execute([
      'oa'  => $combined,
      'ol1' => $opAddr['line1'],
      'opc' => $opAddr['postcode'],
      'oc'  => $opAddr['city'],
      'ost' => $opAddr['state'],
      'sid' => $supplierId,
    ]);
    sendJson(200, true, array_merge(['operationalAddress' => $combined], $opAddr));
  }

  // ── legacy combined-only path ──
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
// verified fields (company name, business address, SSM, SST, document). The
// account stays Active; an admin reviews and approves/rejects. One open request
// at a time.
function handleSubmitChangeRequest(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $body               = getJsonBody();
  $companyName        = trim($body['companyName'] ?? '');
  // structured business address (new client) → compose; else combined string
  $coAddr = readStructuredAddress($body, 'company');
  if (hasStructuredAddress($coAddr)) {
    $coErr = structuredAddressError($coAddr);
    if ($coErr) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => $coErr]);
    }
    $companyAddress = composeAddress($coAddr);
  } else {
    $companyAddress = trim($body['companyAddress'] ?? '');
  }
  // The SSM registration number is the legal-identity ANCHOR — immutable after
  // approval. Ignore any submitted value and keep the current one: a different
  // SSM means a different registered company, which must register fresh (not
  // edit), so an approved account can never be re-pointed to another entity.
  $curSsm = $pdo->prepare('SELECT businessRegNo FROM supplier WHERE supplierId = :sid');
  $curSsm->execute(['sid' => $supplierId]);
  $businessRegNo      = (string) ($curSsm->fetchColumn() ?: '');
  $taxNumber          = trim($body['taxNumber'] ?? '');
  $businessLicenseUrl = trim($body['businessLicenseUrl'] ?? '');

  $err = businessDetailsError($companyName, $companyAddress, $businessRegNo, $businessLicenseUrl, $taxNumber);
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
       (requestId, supplierId, companyName, companyAddress,
        companyLine1, companyPostcode, companyCity, companyState,
        businessRegNo, taxNumber, businessLicenseUrl)
     VALUES (:rid, :sid, :cn, :ca, :cl1, :cpc, :cc, :cst, :brn, :tax, :blu)'
  )->execute([
    'rid' => $requestId, 'sid' => $supplierId, 'cn' => $companyName, 'ca' => $companyAddress,
    'cl1' => hasStructuredAddress($coAddr) ? $coAddr['line1'] : null,
    'cpc' => hasStructuredAddress($coAddr) ? $coAddr['postcode'] : null,
    'cc'  => hasStructuredAddress($coAddr) ? $coAddr['city'] : null,
    'cst' => hasStructuredAddress($coAddr) ? $coAddr['state'] : null,
    'brn' => $businessRegNo, 'tax' => ($taxNumber === '' ? null : $taxNumber),
    'blu' => $businessLicenseUrl,
  ]);

  sendJson(201, true, ['requestId' => $requestId, 'status' => 'Pending',
    'message' => 'Your changes were submitted for admin review.']);
}

// How long a supplier must wait between store-name changes (deters a seller
// building trust as one brand then switching to impersonate another).
const SUPPLIER_DISPLAY_NAME_COOLDOWN_DAYS = 30;

// PATCH /supplier/display-name — body { displayName }. The customer-facing store
// name is self-editable (unlike the verified legal company name) but throttled
// by a cooldown, mirroring Shopee/Etsy. Returns the new name + when it can next
// be changed.
function handleUpdateDisplayName(PDO $pdo, array $auth): void {
  $supplierId  = requireSupplierId($pdo, $auth);
  $body        = getJsonBody();
  $displayName = trim($body['displayName'] ?? '');

  if ($displayName === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Store name is required.']);
  }
  if (mb_strlen($displayName) < 2 || mb_strlen($displayName) > 60) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Store name must be 2–60 characters.']);
  }
  // letters/numbers to start, then letters/numbers/spaces and a little punctuation
  if (!preg_match('/^[\p{L}\p{N}][\p{L}\p{N} .,&\'\-]*$/u', $displayName)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Store name can only use letters, numbers, spaces and . , & \' -']);
  }

  $cur = $pdo->prepare('SELECT displayName, displayNameUpdatedAt FROM supplier WHERE supplierId = :sid');
  $cur->execute(['sid' => $supplierId]);
  $row         = $cur->fetch() ?: [];
  $currentName = (string) ($row['displayName'] ?? '');

  // unchanged → no-op (don't consume the cooldown)
  if ($displayName === $currentName) {
    sendJson(200, true, ['displayName' => $displayName, 'nextChangeAt' => null]);
  }

  // enforce the cooldown against the last change
  if (!empty($row['displayNameUpdatedAt'])) {
    $nextAllowed = (new DateTime((string) $row['displayNameUpdatedAt']))
      ->modify('+' . SUPPLIER_DISPLAY_NAME_COOLDOWN_DAYS . ' days');
    if (new DateTime() < $nextAllowed) {
      sendJson(429, false, null, ['code' => 'COOLDOWN',
        'message' => 'You can change your store name again on ' . $nextAllowed->format('j M Y') . '.']);
    }
  }

  $pdo->prepare('UPDATE supplier SET displayName = :dn, displayNameUpdatedAt = NOW() WHERE supplierId = :sid')
      ->execute(['dn' => $displayName, 'sid' => $supplierId]);

  $next = (new DateTime())->modify('+' . SUPPLIER_DISPLAY_NAME_COOLDOWN_DAYS . ' days')->format('Y-m-d H:i:s');
  sendJson(200, true, ['displayName' => $displayName, 'nextChangeAt' => $next]);
}

// ── standard shipping (3PL) — supplier ships the parcel themselves ──────────
// Carriers a supplier can pick when shipping a Standard parcel.
const STANDARD_CARRIERS = ['J&T Express', 'Pos Laju', 'Ninja Van', 'DHL eCommerce', 'GDEX', 'City-Link', 'Other'];

// Load one of this supplier's Standard deliveries (or 404/409). Returns the row.
function requireSupplierStandardDelivery(PDO $pdo, string $supplierId, string $deliveryId): array {
  $stmt = $pdo->prepare(
    'SELECT deliveryId, orderId, deliveryMethod, deliveryStatus
       FROM delivery WHERE deliveryId = :id AND supplierId = :sid'
  );
  $stmt->execute(['id' => $deliveryId, 'sid' => $supplierId]);
  $del = $stmt->fetch();
  if (!$del) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Delivery not found.']);
  }
  if ($del['deliveryMethod'] !== 'Standard') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This parcel is handled by an in-house courier, not standard shipping.']);
  }
  return $del;
}

// Gather the EasyParcel sender (supplier pickup) + receiver (customer) parties
// and parcel details for a delivery, from the structured addresses.
function shipmentPartiesFor(PDO $pdo, array $config, string $deliveryId): array {
  $stmt = $pdo->prepare(
    'SELECT s.companyName AS company, su.phoneNumber AS pickPhone,
            s.operationalLine1 AS pickLine1, s.operationalCity AS pickCity,
            s.operationalPostcode AS pickCode, s.operationalState AS pickState,
            buyer.fullName AS sendName, buyer.phoneNumber AS sendPhone, buyer.email AS sendEmail,
            o.deliveryLine1 AS sendLine1, o.deliveryCity AS sendCity,
            o.deliveryPostcode AS sendCode, o.deliveryState AS sendState,
            o.orderTotalAmount AS value
       FROM delivery d
       JOIN supplier s    ON s.supplierId = d.supplierId
       JOIN `user` su     ON su.userId = s.userId
       JOIN `order` o     ON o.orderId = d.orderId
       JOIN customer c    ON c.customerId = o.customerId
       JOIN `user` buyer  ON buyer.userId = c.userId
      WHERE d.deliveryId = :id'
  );
  $stmt->execute(['id' => $deliveryId]);
  $r = $stmt->fetch() ?: [];
  $sender = [
    'name' => $r['company'] ?? '', 'company' => $r['company'] ?? '', 'phone' => $r['pickPhone'] ?? '',
    'line1' => $r['pickLine1'] ?? '', 'line2' => '', 'city' => $r['pickCity'] ?? '',
    'state' => $r['pickState'] ?? '', 'code' => $r['pickCode'] ?? '',
  ];
  $receiver = [
    'name' => $r['sendName'] ?? '', 'company' => '', 'phone' => $r['sendPhone'] ?? '',
    'email' => $r['sendEmail'] ?? '',
    'line1' => $r['sendLine1'] ?? '', 'line2' => '', 'city' => $r['sendCity'] ?? '',
    'state' => $r['sendState'] ?? '', 'code' => $r['sendCode'] ?? '',
  ];
  $parcel = [
    'weight' => (string) ($config['easyparcel_default_weight'] ?? 1),
    'content' => 'Footwear', 'value' => (string) ($r['value'] ?? '0'),
  ];
  return [$sender, $receiver, $parcel];
}

// POST /supplier/deliveries/{deliveryId}/ship — record the shipment and move the
// parcel Pending → OutForDelivery. Two modes:
//   • { auto: true }  → auto-book via EasyParcel (Shopee-style): generates the
//     carrier + tracking number for the supplier (when EasyParcel is configured).
//   • { carrier, trackingNumber } → the supplier shipped it themselves and types
//     the details in (the always-available fallback).
function handleShipStandardDelivery(PDO $pdo, array $config, array $auth, string $deliveryId): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $del = requireSupplierStandardDelivery($pdo, $supplierId, $deliveryId);
  if ($del['deliveryStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This parcel has already been shipped.']);
  }

  $body     = getJsonBody();
  $carrier  = trim($body['carrier'] ?? '');
  $tracking = trim($body['trackingNumber'] ?? '');
  $auto     = !empty($body['auto']);

  if ($auto) {
    if (!easyParcelEnabled($config)) {
      sendJson(409, false, null, ['code' => 'NOT_CONFIGURED', 'message' => 'Auto-booking is not set up. Enter the carrier and tracking number manually.']);
    }
    [$sender, $receiver, $parcel] = shipmentPartiesFor($pdo, $config, $deliveryId);
    $booked = easyParcelBook($pdo, $config, $sender, $receiver, $parcel);
    if (!$booked) {
      $detail = function_exists('easyParcelError') ? easyParcelError() : '';
      sendJson(502, false, null, [
        'code'    => 'BOOKING_FAILED',
        'message' => 'Could not auto-book the shipment. Please enter the carrier and tracking number manually.',
        'detail'  => $detail,   // EasyParcel's reason — surfaced to help diagnose during setup/testing
      ]);
    }
    $carrier  = $booked['carrier'];
    $tracking = $booked['tracking'];
  } else {
    if (!in_array($carrier, STANDARD_CARRIERS, true)) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please choose a valid courier.']);
    }
    if ($tracking === '' || mb_strlen($tracking) > 64) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A tracking number is required (max 64 characters).']);
    }
  }

  $pdo->prepare(
    "UPDATE delivery
        SET trackingCarrier = :c, trackingNumber = :t, deliveryStatus = 'OutForDelivery'
      WHERE deliveryId = :id"
  )->execute(['c' => $carrier, 't' => $tracking, 'id' => $deliveryId]);

  if (function_exists('recomputeOrderStatus')) { recomputeOrderStatus($pdo, $del['orderId']); }
  if (function_exists('notifyOrderCustomer')) {
    notifyOrderCustomer($pdo, (string) $del['orderId'], 'shipped', 'Your order has shipped 📦',
      "Shipped via {$carrier}. Tracking number: {$tracking}.");
  }

  sendJson(200, true, [
    'deliveryId' => $deliveryId, 'deliveryStatus' => 'OutForDelivery',
    'trackingCarrier' => $carrier, 'trackingNumber' => $tracking, 'auto' => $auto,
  ]);
}

// POST /supplier/deliveries/{deliveryId}/delivered — supplier confirms a shipped
// Standard parcel has arrived (their 3PL tracking shows delivered). In production
// this would be driven by a carrier webhook or the customer's "order received".
function handleDeliverStandardDelivery(PDO $pdo, array $auth, string $deliveryId): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $del = requireSupplierStandardDelivery($pdo, $supplierId, $deliveryId);
  if ($del['deliveryStatus'] !== 'OutForDelivery') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'Only a shipped parcel can be marked delivered.']);
  }

  $pdo->prepare("UPDATE delivery SET deliveryStatus = 'Delivered', deliveryDate = NOW() WHERE deliveryId = :id")
      ->execute(['id' => $deliveryId]);
  if (function_exists('recomputeOrderStatus')) { recomputeOrderStatus($pdo, $del['orderId']); }

  sendJson(200, true, ['deliveryId' => $deliveryId, 'deliveryStatus' => 'Delivered']);
}
