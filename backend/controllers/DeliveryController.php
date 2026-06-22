<?php
// Admin delivery dispatch: view deliveries, the unassigned queue, and the
// courier roster (with live load), plus manually (re)assign a courier.
// The auto-assign logic itself lives in lib/delivery.php.

// GET /admin/deliveries — every delivery with its order + customer + courier.
// Filters: ?status=<deliveryStatus>, ?unassigned=1 (Pending + no courier).
// Unassigned/Pending are listed first so the queue is front-and-centre.
function handleListDeliveries(PDO $pdo): void {
  $status     = trim($_GET['status'] ?? '');
  $unassigned = !empty($_GET['unassigned']);

  $allowed = ['Pending', 'Assigned', 'PickedUp', 'OutForDelivery', 'Delivered', 'Failed'];

  $where  = [];
  $params = [];
  if ($status !== '' && in_array($status, $allowed, true)) {
    $where[] = 'd.deliveryStatus = :status';
    $params['status'] = $status;
  }
  if ($unassigned) {
    $where[] = 'd.deliveryPersonnelId IS NULL';
  }

  $sql =
    "SELECT d.deliveryId, d.orderId, d.supplierId, d.deliveryStatus, d.deliveryPersonnelId,
            d.deliveryDate, d.estimatedDeliveryTime,
            cu.fullName  AS courierName,
            s.companyName AS supplierName, s.operationalAddress AS pickupAddress,
            o.orderDate, o.orderStatus, o.orderTotalAmount, o.orderDeliveryAddress,
            buyer.fullName AS customerName
       FROM delivery d
       JOIN `order` o          ON o.orderId = d.orderId
       JOIN supplier s         ON s.supplierId = d.supplierId
       JOIN customer c         ON c.customerId = o.customerId
       JOIN `user` buyer       ON buyer.userId = c.userId
       LEFT JOIN delivery_personnel dp ON dp.deliveryPersonnelId = d.deliveryPersonnelId
       LEFT JOIN `user` cu     ON cu.userId = dp.userId";
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  // Queue first (unassigned, then Pending), then most recent orders.
  $sql .=
    " ORDER BY (d.deliveryPersonnelId IS NULL) DESC,
               FIELD(d.deliveryStatus, 'Pending','Assigned','PickedUp','OutForDelivery','Delivered','Failed'),
               o.orderDate DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['orderTotalAmount'] = (float) $r['orderTotalAmount']; }
  unset($r);

  sendJson(200, true, ['deliveries' => $rows]);
}

// GET /admin/couriers — the Active courier roster, ranked best-first by the
// same scoring function the auto-assigner uses, each with its current load.
// Powers the manual-assign dropdown (admin sees who is least loaded).
function handleListCouriers(PDO $pdo): void {
  $couriers = scoreCouriers($pdo);
  sendJson(200, true, ['couriers' => $couriers]);
}

// POST /admin/deliveries/{deliveryId}/assign — body: { deliveryPersonnelId }.
// Manually assign or reassign a courier. Allowed while the delivery has not yet
// reached a terminal state (Delivered/Failed).
function handleAssignDelivery(PDO $pdo, string $deliveryId): void {
  $body     = getJsonBody();
  $courierId = trim($body['deliveryPersonnelId'] ?? '');
  if ($courierId === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A courier is required.']);
  }

  $stmt = $pdo->prepare('SELECT deliveryStatus FROM delivery WHERE deliveryId = :id');
  $stmt->execute(['id' => $deliveryId]);
  $del = $stmt->fetch();
  if (!$del) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Delivery not found.']);
  }
  if (in_array($del['deliveryStatus'], ['Delivered', 'Failed'], true)) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This delivery is already closed.']);
  }

  // The courier must exist and be an Active delivery person.
  $stmt = $pdo->prepare(
    "SELECT dp.deliveryPersonnelId
       FROM delivery_personnel dp
       JOIN `user` u ON u.userId = dp.userId AND u.status = 'Active'
      WHERE dp.deliveryPersonnelId = :id"
  );
  $stmt->execute(['id' => $courierId]);
  if (!$stmt->fetch()) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown or inactive courier.']);
  }

  // Assigning from the queue moves Pending → Assigned; reassigning an already
  // in-progress delivery keeps its current status (the courier just changes).
  $newStatus = $del['deliveryStatus'] === 'Pending' ? 'Assigned' : $del['deliveryStatus'];
  $pdo->prepare(
    "UPDATE delivery
        SET deliveryPersonnelId = :dp, deliveryStatus = :s
      WHERE deliveryId = :id"
  )->execute(['dp' => $courierId, 's' => $newStatus, 'id' => $deliveryId]);

  sendJson(200, true, [
    'deliveryId'          => $deliveryId,
    'deliveryPersonnelId' => $courierId,
    'deliveryStatus'      => $newStatus,
  ]);
}

// ── Delivery personnel (courier) endpoints ───────────────────────────────────
// The courier works their assigned deliveries: pick up → out for delivery →
// confirm with the customer's OTP (or mark failed), and attach proof.

// GET /delivery/assignments — this courier's ACTIVE deliveries. Couriers DO get
// the customer's address + phone (they need it to deliver).
function handleListAssignments(PDO $pdo, array $auth): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT d.deliveryId, d.orderId, d.deliveryStatus, d.estimatedDeliveryTime,
            o.orderDeliveryAddress, buyer.fullName AS customerName, buyer.phoneNumber AS customerPhone,
            s.companyName AS supplierName, s.operationalAddress AS pickupAddress,
            (SELECT COUNT(*) FROM order_item oi
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p          ON p.productId = pv.productId
              WHERE oi.orderId = o.orderId AND p.supplierId = d.supplierId) AS itemCount
       FROM delivery d
       JOIN `order` o    ON o.orderId = d.orderId
       JOIN supplier s   ON s.supplierId = d.supplierId
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
      WHERE d.deliveryPersonnelId = :dp
        AND d.deliveryStatus IN ('Assigned', 'PickedUp', 'OutForDelivery')
      ORDER BY FIELD(d.deliveryStatus, 'OutForDelivery','PickedUp','Assigned'), d.deliveryId"
  );
  $stmt->execute(['dp' => $courierId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['itemCount'] = (int) $r['itemCount']; }
  unset($r);
  sendJson(200, true, ['deliveries' => $rows]);
}

// GET /delivery/history — this courier's finished deliveries (Delivered/Failed).
function handleListDeliveryHistory(PDO $pdo, array $auth): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT d.deliveryId, d.orderId, d.deliveryStatus, d.deliveryDate,
            o.orderDeliveryAddress, buyer.fullName AS customerName,
            s.companyName AS supplierName
       FROM delivery d
       JOIN `order` o    ON o.orderId = d.orderId
       JOIN supplier s   ON s.supplierId = d.supplierId
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
      WHERE d.deliveryPersonnelId = :dp AND d.deliveryStatus IN ('Delivered', 'Failed')
      ORDER BY d.deliveryDate DESC"
  );
  $stmt->execute(['dp' => $courierId]);
  sendJson(200, true, ['deliveries' => $stmt->fetchAll()]);
}

// Shared: load one of this courier's deliveries (or 404).
function requireOwnDelivery(PDO $pdo, string $courierId, string $deliveryId): array {
  $stmt = $pdo->prepare(
    'SELECT deliveryId, orderId, supplierId, deliveryStatus, otpCode FROM delivery
      WHERE deliveryId = :id AND deliveryPersonnelId = :dp'
  );
  $stmt->execute(['id' => $deliveryId, 'dp' => $courierId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Delivery not found.']);
  }
  return $row;
}

// GET /deliveries/{deliveryId} — full detail for the courier (customer contact,
// address, items). The OTP is NOT returned — the customer holds it; the courier
// enters it to confirm.
function handleGetCourierDelivery(PDO $pdo, array $auth, string $deliveryId): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  // Pull this parcel's supplier (the pickup point) alongside the delivery. The
  // courier collects ONLY this supplier's items, from the supplier's operational
  // (pickup) address, and drops them at the customer's address.
  $h = $pdo->prepare(
    "SELECT d.deliveryId, d.orderId, d.supplierId, d.deliveryStatus, d.deliveryDate,
            d.estimatedDeliveryTime, d.proofOfDelivery,
            o.orderDeliveryAddress, o.orderTotalAmount,
            buyer.fullName AS customerName, buyer.phoneNumber AS customerPhone,
            s.companyName AS supplierName, s.operationalAddress AS pickupAddress
       FROM delivery d
       JOIN `order` o    ON o.orderId = d.orderId
       JOIN supplier s   ON s.supplierId = d.supplierId
       JOIN customer c   ON c.customerId = o.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
      WHERE d.deliveryId = :id AND d.deliveryPersonnelId = :dp"
  );
  $h->execute(['id' => $deliveryId, 'dp' => $courierId]);
  $del = $h->fetch();
  if (!$del) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Delivery not found.']);
  }
  $del['orderTotalAmount'] = (float) $del['orderTotalAmount'];

  // only the items from THIS parcel's supplier (an order may have other parcels)
  $it = $pdo->prepare(
    "SELECT p.productName, p.productBrand AS brand, oi.orderSize AS size, oi.orderQuantity AS qty
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :oid AND p.supplierId = :sid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $del['orderId'], 'sid' => $del['supplierId']]);
  $items = $it->fetchAll();
  foreach ($items as &$x) { $x['qty'] = (int) $x['qty']; }
  unset($x);
  $del['items'] = $items;

  sendJson(200, true, $del);
}

// PATCH /deliveries/{deliveryId}/status — body: { status }. Transitions:
// Assigned→PickedUp, PickedUp→OutForDelivery, OutForDelivery→Failed.
// (Delivered is reached only through verify-otp.) The order status is kept in
// step; going OutForDelivery generates the customer's confirmation OTP.
function handleUpdateDeliveryStatus(PDO $pdo, array $auth, string $deliveryId): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  $body   = getJsonBody();
  $status = trim($body['status'] ?? '');

  $del = requireOwnDelivery($pdo, $courierId, $deliveryId);
  $allowed = [
    'Assigned'       => ['PickedUp'],
    'PickedUp'       => ['OutForDelivery'],
    'OutForDelivery' => ['Failed'],
  ];
  if (!in_array($status, $allowed[$del['deliveryStatus']] ?? [], true)) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => "Cannot move a {$del['deliveryStatus']} delivery to {$status}."]);
  }

  try {
    $pdo->beginTransaction();
    if ($status === 'OutForDelivery') {
      $otp = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
      $pdo->prepare("UPDATE delivery SET deliveryStatus = 'OutForDelivery', otpCode = :otp WHERE deliveryId = :id")
          ->execute(['otp' => $otp, 'id' => $deliveryId]);
    } else {
      $pdo->prepare('UPDATE delivery SET deliveryStatus = :s WHERE deliveryId = :id')
          ->execute(['s' => $status, 'id' => $deliveryId]);
    }
    // roll the order status up from all its parcels (an order is only as far
    // along as its least-progressed parcel)
    recomputeOrderStatus($pdo, $del['orderId']);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not update the delivery.']);
  }

  sendJson(200, true, ['deliveryId' => $deliveryId, 'deliveryStatus' => $status]);
}

// POST /deliveries/{deliveryId}/verify-otp — body: { otpCode }. On a match
// (delivery must be OutForDelivery) → Delivered, order → Delivered.
function handleVerifyOtp(PDO $pdo, array $auth, string $deliveryId): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  $body = getJsonBody();
  $otp  = trim($body['otpCode'] ?? '');

  $del = requireOwnDelivery($pdo, $courierId, $deliveryId);
  if ($del['deliveryStatus'] !== 'OutForDelivery') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This delivery is not out for delivery.']);
  }
  if ($otp === '' || $otp !== (string) $del['otpCode']) {
    sendJson(400, false, null, ['code' => 'BAD_OTP', 'message' => 'Incorrect OTP. Ask the customer for the code shown in their app.']);
  }

  try {
    $pdo->beginTransaction();
    $pdo->prepare("UPDATE delivery SET deliveryStatus = 'Delivered', deliveryDate = NOW() WHERE deliveryId = :id")
        ->execute(['id' => $deliveryId]);
    // order becomes Delivered only once EVERY parcel is delivered
    recomputeOrderStatus($pdo, $del['orderId']);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not confirm the delivery.']);
  }

  sendJson(200, true, ['deliveryId' => $deliveryId, 'deliveryStatus' => 'Delivered']);
}

// POST /deliveries/{deliveryId}/proof — attach a proof-of-delivery photo.
// Accepts EITHER a direct multipart upload (field `file`) — what the courier
// app sends — OR a JSON `{ proofUrl }` that was already uploaded elsewhere.
function handleUploadProof(PDO $pdo, array $auth, string $deliveryId): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  requireOwnDelivery($pdo, $courierId, $deliveryId);

  if (isset($_FILES['file'])) {
    // courier snapped/picked a photo → store it, then attach
    $url = storeUploadedFile($_FILES['file'], 'image');
  } else {
    $body = getJsonBody();
    $url  = trim($body['proofUrl'] ?? '');
    if ($url === '') {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A proof photo is required.']);
    }
  }

  $pdo->prepare('UPDATE delivery SET proofOfDelivery = :url WHERE deliveryId = :id')
      ->execute(['url' => $url, 'id' => $deliveryId]);
  sendJson(200, true, ['deliveryId' => $deliveryId, 'proofOfDelivery' => $url]);
}

// Reasons a courier can report, mapped to what happens to the parcel:
//   'fail'     → the delivery is marked Failed
//   'reassign' → the parcel returns to the dispatch queue (Pending, unassigned)
//   'none'     → just recorded for the admin to action
const DELIVERY_ISSUE_REASONS = [
  'customer_unreachable' => 'fail',
  'customer_unavailable' => 'fail',
  'customer_refused'     => 'fail',
  'wrong_address'        => 'fail',
  'package_damaged'      => 'fail',
  'vehicle_emergency'    => 'reassign',
  'other'                => 'none',
];

// POST /deliveries/{deliveryId}/report-issue — courier reports a problem.
// Accepts multipart (reason, note, optional file) OR JSON { reason, note }.
// Records the issue, applies the outcome, and notifies the customer.
function handleReportIssue(PDO $pdo, array $auth, string $deliveryId): void {
  $courierId = requireDeliveryPersonnelId($pdo, $auth);
  $del = requireOwnDelivery($pdo, $courierId, $deliveryId);

  if (in_array($del['deliveryStatus'], ['Delivered', 'Failed'], true)) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This delivery is already closed.']);
  }

  // fields come via multipart ($_POST) when a photo is attached, else JSON
  $reason = $_POST['reason'] ?? null;
  $note   = $_POST['note'] ?? null;
  if ($reason === null) {
    $body   = getJsonBody();
    $reason = $body['reason'] ?? '';
    $note   = $body['note'] ?? '';
  }
  $reason = trim((string) $reason);
  $note   = trim((string) ($note ?? ''));
  if ($note !== '') { $note = mb_substr($note, 0, 255); }

  if (!isset(DELIVERY_ISSUE_REASONS[$reason])) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please choose a valid reason.']);
  }

  $photoUrl = isset($_FILES['file']) ? storeUploadedFile($_FILES['file'], 'image') : null;
  $outcome  = DELIVERY_ISSUE_REASONS[$reason];

  try {
    $pdo->beginTransaction();

    $id = nextId($pdo, 'delivery_issue', 'issueId', 'ISS');
    $pdo->prepare(
      "INSERT INTO delivery_issue (issueId, deliveryId, orderId, deliveryPersonnelId, reason, note, photoUrl, issueStatus, createdAt)
       VALUES (:id, :did, :oid, :dp, :reason, :note, :photo, 'Open', NOW())"
    )->execute([
      'id' => $id, 'did' => $deliveryId, 'oid' => $del['orderId'], 'dp' => $courierId,
      'reason' => $reason, 'note' => $note !== '' ? $note : null, 'photo' => $photoUrl,
    ]);

    if ($outcome === 'fail') {
      $pdo->prepare("UPDATE delivery SET deliveryStatus = 'Failed' WHERE deliveryId = :id")
          ->execute(['id' => $deliveryId]);
      recomputeOrderStatus($pdo, $del['orderId']);
    } elseif ($outcome === 'reassign') {
      // hand the parcel back to dispatch (clears OTP + courier)
      $pdo->prepare("UPDATE delivery SET deliveryStatus = 'Pending', deliveryPersonnelId = NULL, otpCode = NULL WHERE deliveryId = :id")
          ->execute(['id' => $deliveryId]);
    }

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not report the issue.']);
  }

  // tell the buyer there's a problem (best-effort; never blocks)
  if (function_exists('notifyOrderCustomer')) {
    notifyOrderCustomer($pdo, $del['orderId'], 'delivery', 'Delivery issue',
      "There was a problem delivering order {$del['orderId']}. Our team is looking into it.");
  }

  sendJson(201, true, ['issueId' => $id, 'deliveryId' => $deliveryId, 'reason' => $reason, 'outcome' => $outcome]);
}

// GET /admin/delivery-issues — the issue queue (Open first). Optional ?status=.
function handleListDeliveryIssues(PDO $pdo): void {
  $status  = trim($_GET['status'] ?? '');
  $where   = [];
  $params  = [];
  if (in_array($status, ['Open', 'Resolved'], true)) {
    $where[] = 'i.issueStatus = :st'; $params['st'] = $status;
  }

  $sql =
    "SELECT i.issueId, i.deliveryId, i.orderId, i.reason, i.note, i.photoUrl,
            i.issueStatus, i.createdAt, i.resolvedAt,
            d.deliveryStatus,
            i.deliveryPersonnelId, courier.fullName AS courierName,
            buyer.fullName AS customerName, s.companyName AS supplierName
       FROM delivery_issue i
       JOIN delivery d              ON d.deliveryId = i.deliveryId
       JOIN `order` o               ON o.orderId = i.orderId
       JOIN customer c              ON c.customerId = o.customerId
       JOIN `user` buyer            ON buyer.userId = c.userId
       JOIN supplier s              ON s.supplierId = d.supplierId
       LEFT JOIN delivery_personnel dp ON dp.deliveryPersonnelId = i.deliveryPersonnelId
       LEFT JOIN `user` courier        ON courier.userId = dp.userId";
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= " ORDER BY FIELD(i.issueStatus, 'Open','Resolved'), i.createdAt DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  sendJson(200, true, ['issues' => $stmt->fetchAll()]);
}

// PATCH /admin/delivery-issues/{issueId}/resolve — close an issue.
function handleResolveDeliveryIssue(PDO $pdo, string $issueId): void {
  $stmt = $pdo->prepare("UPDATE delivery_issue SET issueStatus = 'Resolved', resolvedAt = NOW() WHERE issueId = :id");
  $stmt->execute(['id' => $issueId]);
  if ($stmt->rowCount() === 0) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Issue not found.']);
  }
  sendJson(200, true, ['issueId' => $issueId, 'issueStatus' => 'Resolved']);
}
