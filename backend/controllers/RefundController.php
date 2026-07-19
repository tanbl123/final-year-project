<?php
// Refund processing (Admin web). Customers submit refund requests in the mobile
// app; the admin reviews them here. Suppliers see refunds on their own orders
// via the order detail (OrderController), not here.

// GET /admin/refunds — all refund requests. Optional ?status= filter.
// Pending first so the work queue is front-and-centre.
function handleListRefunds(PDO $pdo): void {
  $status  = trim($_GET['status'] ?? '');
  $allowed = ['Pending', 'Approved', 'Rejected', 'Completed'];

  $where  = [];
  $params = [];
  if (in_array($status, $allowed, true)) {
    $where[] = 'r.refundStatus = :st'; $params['st'] = $status;
  }

  $sql =
    "SELECT r.refundId, r.orderId, r.refundReason, r.refundAmount, r.refundStatus,
            r.requestDate, r.refundProof,
            buyer.fullName AS customerName,
            o.orderTotalAmount, o.orderStatus
       FROM refund r
       JOIN `order` o    ON o.orderId = r.orderId
       JOIN customer c   ON c.customerId = r.customerId
       JOIN `user` buyer ON buyer.userId = c.userId";
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .=
    " ORDER BY FIELD(r.refundStatus, 'Pending','Approved','Rejected','Completed'),
               r.requestDate DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['refundAmount']     = (float) $r['refundAmount'];
    $r['orderTotalAmount'] = (float) $r['orderTotalAmount'];
  }
  unset($r);
  sendJson(200, true, ['refunds' => $rows]);
}

// PATCH /admin/refunds/{refundId}/status — body: { status }.
// Allowed transitions: Pending → Approved | Rejected; Approved → Completed.
// Completing a refund marks the order's payment as Refunded (money returned).
function handleSetRefundStatus(PDO $pdo, string $refundId, array $config = []): void {
  $body   = getJsonBody();
  $status = trim($body['status'] ?? '');
  if (!in_array($status, ['Approved', 'Rejected', 'Completed'], true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid status.']);
  }

  $stmt = $pdo->prepare('SELECT orderId, customerId, refundStatus FROM refund WHERE refundId = :id');
  $stmt->execute(['id' => $refundId]);
  $refund = $stmt->fetch();
  if (!$refund) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Refund not found.']);
  }

  $current = $refund['refundStatus'];
  $okTransitions = [
    'Pending'  => ['Approved', 'Rejected'],
    'Approved' => ['Completed'],
  ];
  if (!in_array($status, $okTransitions[$current] ?? [], true)) {
    sendJson(409, false, null, [
      'code' => 'CONFLICT',
      'message' => "Cannot change a {$current} refund to {$status}.",
    ]);
  }

  // Completing a refund returns the money for real via Stripe FIRST, so we only
  // record 'Refunded' when money has actually gone back. Skips silently for
  // non-Stripe/unconfigured demos; aborts if Stripe rejects the refund.
  if ($status === 'Completed') {
    try {
      refundOrderPayment($pdo, $refund['orderId'], $config, 'requested_by_customer');
    } catch (Throwable $e) {
      sendJson(502, false, null, ['code' => 'REFUND_FAILED',
        'message' => 'Could not process the refund with Stripe: ' . $e->getMessage()]);
    }
  }

  try {
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE refund SET refundStatus = :s WHERE refundId = :id')
        ->execute(['s' => $status, 'id' => $refundId]);

    // money actually returned → reflect it on the payment record
    if ($status === 'Completed') {
      $pdo->prepare("UPDATE payment SET paymentStatus = 'Refunded' WHERE orderId = :oid")
          ->execute(['oid' => $refund['orderId']]);
    }
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not update the refund.']);
  }

  // notify the buyer of the outcome (best-effort; after commit)
  if (function_exists('notifyRefundStatusChange')) {
    notifyRefundStatusChange($pdo, $refund['customerId'], $refund['orderId'], $status);
  }

  sendJson(200, true, ['refundId' => $refundId, 'status' => $status]);
}

// GET /supplier/refunds — refunds on orders that contain this supplier's
// products (read-only). Optional ?status=. No customer PII (PDPA) — suppliers
// monitor refunds but the admin processes them.
function handleListSupplierRefunds(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $status     = trim($_GET['status'] ?? '');
  $allowed    = ['Pending', 'Approved', 'Rejected', 'Completed'];

  $where  = ['EXISTS (
               SELECT 1 FROM order_item oi
               JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
               JOIN product p          ON p.productId = pv.productId
              WHERE oi.orderId = r.orderId AND p.supplierId = :sid)'];
  $params = ['sid' => $supplierId];
  if (in_array($status, $allowed, true)) {
    $where[] = 'r.refundStatus = :st'; $params['st'] = $status;
  }

  $sql =
    "SELECT r.refundId, r.orderId, r.refundReason, r.refundAmount,
            r.refundStatus, r.requestDate, r.refundProof
       FROM refund r
      WHERE " . implode(' AND ', $where) . "
      ORDER BY FIELD(r.refundStatus, 'Pending','Approved','Rejected','Completed'),
               r.requestDate DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['refundAmount'] = (float) $r['refundAmount']; }
  unset($r);
  sendJson(200, true, ['refunds' => $rows]);
}

// ── Customer refund requests (Customer token) ────────────────────────────────

// POST /orders/{orderId}/refund — request a refund on a PAID order. Body:
// { refundReason, refundAmount?, refundProof? }. Creates a Pending refund that
// then flows to the admin processing queue + the supplier's refund views.
function handleCreateRefund(PDO $pdo, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body   = getJsonBody();
  $reason = trim($body['refundReason'] ?? '');
  // refundProof may be a single URL (legacy) or an array of URLs (multiple
  // evidence photos). Store one URL as-is, or a JSON array for several.
  $proofRaw = $body['refundProof'] ?? null;
  if (is_array($proofRaw)) {
    $urls  = array_values(array_filter(array_map(fn($u) => trim((string) $u), $proofRaw)));
    $proof = $urls ? (count($urls) === 1 ? $urls[0] : json_encode($urls)) : '';
  } else {
    $proof = trim((string) $proofRaw);
  }
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A refund reason is required.']);
  }
  if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }

  $o = $pdo->prepare("SELECT orderStatus, orderTotalAmount, orderDate FROM `order` WHERE orderId = :oid AND customerId = :cid");
  $o->execute(['oid' => $orderId, 'cid' => $customerId]);
  $order = $o->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  // Policy: a refund can only be requested AFTER every parcel is delivered,
  // and within the refund window. (Before delivery the customer cancels.)
  // Fulfilment lives on the parcels, not orderStatus.
  if ($order['orderStatus'] !== 'Paid') {
    sendJson(409, false, null, ['code' => 'NOT_REFUNDABLE', 'message' => 'This order is not refundable.']);
  }
  $ds = $pdo->prepare("SELECT deliveryStatus FROM delivery WHERE orderId = :oid");
  $ds->execute(['oid' => $orderId]);
  $statuses = array_column($ds->fetchAll(), 'deliveryStatus');
  $allDelivered = count($statuses) > 0
      && count(array_filter($statuses, fn($s) => $s === 'Delivered')) === count($statuses);
  if (!$allDelivered) {
    sendJson(409, false, null, ['code' => 'NOT_REFUNDABLE',
      'message' => 'You can request a refund only after the order is delivered. To cancel a paid order before it ships, use Cancel order.']);
  }
  $delivered = $pdo->prepare("SELECT MAX(deliveryDate) FROM delivery WHERE orderId = :oid");
  $delivered->execute(['oid' => $orderId]);
  $ref = $delivered->fetchColumn() ?: $order['orderDate'];
  $window = defined('REFUND_WINDOW_DAYS') ? REFUND_WINDOW_DAYS : 7;
  if (time() > strtotime($ref) + $window * 86400) {
    sendJson(409, false, null, ['code' => 'WINDOW_CLOSED',
      'message' => "The $window-day refund window for this order has closed."]);
  }
  $orderTotal = (float) $order['orderTotalAmount'];

  $amount = $body['refundAmount'] ?? $orderTotal;       // default: full refund
  if (!is_numeric($amount) || (float) $amount <= 0 || (float) $amount > $orderTotal) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Refund amount must be between 0 and the order total.']);
  }
  $amount = round((float) $amount, 2);

  // don't allow a second active refund on the same order
  $ex = $pdo->prepare("SELECT 1 FROM refund WHERE orderId = :oid AND refundStatus IN ('Pending','Approved','Completed') LIMIT 1");
  $ex->execute(['oid' => $orderId]);
  if ($ex->fetch()) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'A refund for this order is already in progress.']);
  }

  $id = nextId($pdo, 'refund', 'refundId', 'REF');
  $pdo->prepare(
    "INSERT INTO refund (refundId, orderId, customerId, refundReason, refundAmount, refundStatus, requestDate, refundProof)
     VALUES (:id, :oid, :cid, :reason, :amt, 'Pending', NOW(), :proof)"
  )->execute([
    'id' => $id, 'oid' => $orderId, 'cid' => $customerId,
    'reason' => $reason, 'amt' => $amount, 'proof' => $proof !== '' ? $proof : null,
  ]);

  // confirm receipt of the request (admin reviews it next)
  if (function_exists('notifyRefundRequested')) {
    notifyRefundRequested($pdo, $customerId, $orderId);
  }

  sendJson(201, true, ['refundId' => $id, 'orderId' => $orderId, 'refundAmount' => $amount, 'refundStatus' => 'Pending']);
}

// GET /refunds — the customer's own refund requests + status.
function handleListCustomerRefunds(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT r.refundId, r.orderId, r.refundReason, r.refundAmount, r.refundStatus,
            r.requestDate, r.refundProof, o.orderTotalAmount
       FROM refund r
       JOIN `order` o ON o.orderId = r.orderId
      WHERE r.customerId = :cid
      ORDER BY FIELD(r.refundStatus, 'Pending','Approved','Rejected','Completed'), r.requestDate DESC"
  );
  $stmt->execute(['cid' => $customerId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['refundAmount']     = (float) $r['refundAmount'];
    $r['orderTotalAmount'] = (float) $r['orderTotalAmount'];
  }
  unset($r);
  sendJson(200, true, ['refunds' => $rows]);
}
