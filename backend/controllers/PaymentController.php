<?php
// Customer payment + receipt.
//
// For now `POST /orders/{id}/payment` confirms payment directly (a simulated
// gateway success) and runs the REAL post-payment pipeline:
//   atomic stock decrement → payment recorded → order Paid → receipt → courier
//   auto-assigned (the same assignDelivery() the payout demo uses).
//
// In production this step would create a Stripe PaymentIntent and be confirmed
// by a signed webhook (the payout demo already proves the live Stripe flow);
// that hardening is noted as future work.

// POST /orders/{orderId}/payment — body: { paymentMethod }. Pays a Placed order.
function handlePayOrder(PDO $pdo, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body   = getJsonBody();
  $method = trim($body['paymentMethod'] ?? 'Stripe');
  if (!in_array($method, ['Stripe', 'PayPal'], true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Payment method must be Stripe or PayPal.']);
  }

  $o = $pdo->prepare("SELECT orderStatus, orderTotalAmount FROM `order` WHERE orderId = :oid AND customerId = :cid");
  $o->execute(['oid' => $orderId, 'cid' => $customerId]);
  $order = $o->fetch();
  if (!$order) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Order not found.']);
  }
  if ($order['orderStatus'] !== 'Placed') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This order is not awaiting payment.']);
  }
  $amount = (float) $order['orderTotalAmount'];

  $itStmt = $pdo->prepare('SELECT productVariantId, orderQuantity FROM order_item WHERE orderId = :oid');
  $itStmt->execute(['oid' => $orderId]);
  $lines = $itStmt->fetchAll();

  $payId = null;
  $dispatch = null;
  try {
    $pdo->beginTransaction();

    // ── atomic stock decrement: the oversell guard (Model A) ──
    // Only succeeds while enough stock remains; 0 rows affected = sold out.
    $dec = $pdo->prepare(
      "UPDATE product_variant SET stockQuantity = stockQuantity - :q
        WHERE productVariantId = :v AND stockQuantity >= :q2"
    );
    foreach ($lines as $ln) {
      $q = (int) $ln['orderQuantity'];
      $dec->execute(['q' => $q, 'v' => $ln['productVariantId'], 'q2' => $q]);
      if ($dec->rowCount() === 0) {
        throw new RuntimeException('OUT_OF_STOCK');
      }
    }

    // record the (simulated) successful payment
    $payId = nextId($pdo, 'payment', 'paymentId', 'PAY');
    $txn   = 'sim_' . strtolower($method) . '_' . $orderId;
    $pdo->prepare(
      "INSERT INTO payment (paymentId, orderId, transactionId, paymentMethod, paymentAmount, paymentDate, paymentStatus)
       VALUES (:pid, :oid, :txn, :method, :amt, NOW(), 'Successful')"
    )->execute(['pid' => $payId, 'oid' => $orderId, 'txn' => $txn, 'method' => $method, 'amt' => $amount]);

    // order → Paid
    $pdo->prepare("UPDATE `order` SET orderStatus = 'Paid' WHERE orderId = :oid")->execute(['oid' => $orderId]);

    // receipt
    $rcptId = nextId($pdo, 'receipt', 'receiptId', 'RCP');
    $pdo->prepare('INSERT INTO receipt (receiptId, orderId) VALUES (:rid, :oid)')
        ->execute(['rid' => $rcptId, 'oid' => $orderId]);

    // auto-assign a courier (same helper as the demo / a real webhook)
    $dispatch = assignDelivery($pdo, $orderId);

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    if ($e->getMessage() === 'OUT_OF_STOCK') {
      sendJson(409, false, null, ['code' => 'OUT_OF_STOCK', 'message' => 'Sorry — an item just sold out. You were not charged.']);
    }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Payment could not be completed.']);
  }

  sendJson(200, true, [
    'orderId'       => $orderId,
    'status'        => 'Paid',
    'paymentId'     => $payId,
    'paymentMethod' => $method,
    'amount'        => $amount,
    'delivery'      => $dispatch,
  ]);
}

// GET /orders/{orderId}/receipt — receipt for a paid order (the customer's own).
function handleGetReceipt(PDO $pdo, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT r.receiptId, r.receiptGeneratedDate, o.orderId, o.orderDate,
            o.orderTotalAmount, o.orderDeliveryAddress,
            pay.paymentMethod, pay.transactionId, pay.paymentAmount, pay.paymentDate
       FROM receipt r
       JOIN `order` o        ON o.orderId = r.orderId
       LEFT JOIN payment pay ON pay.orderId = o.orderId
      WHERE r.orderId = :oid AND o.customerId = :cid"
  );
  $stmt->execute(['oid' => $orderId, 'cid' => $customerId]);
  $rcpt = $stmt->fetch();
  if (!$rcpt) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Receipt not found.']);
  }
  $rcpt['orderTotalAmount'] = (float) $rcpt['orderTotalAmount'];
  if ($rcpt['paymentAmount'] !== null) { $rcpt['paymentAmount'] = (float) $rcpt['paymentAmount']; }

  $it = $pdo->prepare(
    "SELECT p.productName, p.productBrand AS brand, oi.orderSize AS size, oi.orderQuantity AS qty,
            oi.orderUnitPrice AS unitPrice, oi.orderSubtotal AS subtotal
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :oid
      ORDER BY oi.orderItemId"
  );
  $it->execute(['oid' => $orderId]);
  $items = $it->fetchAll();
  foreach ($items as &$x) {
    $x['qty']       = (int) $x['qty'];
    $x['unitPrice'] = (float) $x['unitPrice'];
    $x['subtotal']  = (float) $x['subtotal'];
  }
  unset($x);
  $rcpt['items'] = $items;

  sendJson(200, true, $rcpt);
}
