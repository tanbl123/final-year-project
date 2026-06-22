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
function handleSetRefundStatus(PDO $pdo, string $refundId): void {
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
            r.refundStatus, r.requestDate
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
  $proof  = trim($body['refundProof'] ?? '');
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A refund reason is required.']);
  }
  if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }

  $o = $pdo->prepare("SELECT orderStatus, orderTotalAmount FROM `order` WHERE orderId = :oid AND customerId = :cid");
  $o->execute(['oid' => $orderId, 'cid' => $customerId]);
  $order = $o->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  $paid = ['Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed'];
  if (!in_array($order['orderStatus'], $paid, true)) {
    sendJson(409, false, null, ['code' => 'NOT_REFUNDABLE', 'message' => 'Only a paid order can be refunded.']);
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
