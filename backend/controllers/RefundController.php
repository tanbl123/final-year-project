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

  $stmt = $pdo->prepare('SELECT orderId, refundStatus FROM refund WHERE refundId = :id');
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

  sendJson(200, true, ['refundId' => $refundId, 'status' => $status]);
}
