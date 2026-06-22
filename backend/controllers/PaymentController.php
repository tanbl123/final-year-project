<?php
// Customer payment + receipt.
//
// For now `POST /orders/{id}/payment` confirms payment directly (a simulated
// gateway success) and runs the REAL post-payment pipeline:
//   atomic stock decrement → payment recorded → order Paid → receipt → order
//   dispatched as one parcel per supplier (the same dispatchOrder() the payout
//   demo uses), each auto-assigned to a courier.
//
// In production this step would create a Stripe PaymentIntent and be confirmed
// by a signed webhook (the payout demo already proves the live Stripe flow);
// that hardening is noted as future work.

// POST /orders/{orderId}/payment-intent — create a Stripe PaymentIntent for a
// Placed order and return its client secret (+ publishable key) so the mobile
// app's Stripe SDK can present the payment sheet.
function handleCreatePaymentIntent(PDO $pdo, array $config, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  if (!stripeConfigured($config)) {
    sendJson(503, false, null, ['code' => 'STRIPE_NOT_CONFIGURED', 'message' => 'Card payment is not configured on the server.']);
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
  $secret = $config['stripe_secret'];

  try {
    $acct = stripeApi($secret, 'GET', '/v1/account');
    $currency = strtolower($acct['default_currency'] ?? 'myr');
    $pi = stripeApi($secret, 'POST', '/v1/payment_intents', [
      'amount'                    => (int) round($amount * 100),
      'currency'                  => $currency,
      'description'               => "ShoeAR order {$orderId}",
      'metadata'                  => ['orderId' => $orderId],
      'automatic_payment_methods' => ['enabled' => 'true'],
    ]);
  } catch (Throwable $e) {
    sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => 'Could not start the payment. Please try again.']);
  }

  sendJson(200, true, [
    'clientSecret'    => $pi['client_secret'] ?? '',
    'paymentIntentId' => $pi['id'] ?? '',
    'publishableKey'  => $config['stripe_publishable'] ?? '',
  ]);
}

// POST /orders/{orderId}/payment — body: { paymentMethod, paymentIntentId? }.
// Pays a Placed order. For Stripe (when configured) the PaymentIntent is
// verified server-side before the order is marked Paid; otherwise (PayPal, or
// no Stripe key) the payment is simulated.
function handlePayOrder(PDO $pdo, array $config, array $auth, string $orderId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body   = getJsonBody();
  $method = trim($body['paymentMethod'] ?? 'Stripe');
  $paymentIntentId = trim($body['paymentIntentId'] ?? '');
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

  // Resolve the transaction reference. Real Stripe payments are verified with
  // the gateway; everything else is a simulated success.
  $txn = 'sim_' . strtolower($method) . '_' . $orderId;
  if ($method === 'Stripe' && stripeConfigured($config) && $paymentIntentId !== '') {
    try {
      $pi = stripeApi($config['stripe_secret'], 'GET', '/v1/payment_intents/' . urlencode($paymentIntentId));
    } catch (Throwable $e) {
      sendJson(502, false, null, ['code' => 'STRIPE_ERROR', 'message' => 'Could not verify the payment with Stripe.']);
    }
    if (($pi['status'] ?? '') !== 'succeeded') {
      sendJson(402, false, null, ['code' => 'PAYMENT_FAILED', 'message' => 'Payment was not completed.']);
    }
    if (($pi['metadata']['orderId'] ?? '') !== $orderId) {
      sendJson(400, false, null, ['code' => 'PI_MISMATCH', 'message' => 'Payment does not match this order.']);
    }
    if ((int) ($pi['amount'] ?? 0) !== (int) round($amount * 100)) {
      sendJson(400, false, null, ['code' => 'AMOUNT_MISMATCH', 'message' => 'Payment amount does not match the order total.']);
    }
    $txn = $paymentIntentId;
  }

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

    // record the successful payment (real Stripe ref, or a simulated one)
    $payId = nextId($pdo, 'payment', 'paymentId', 'PAY');
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

    // auto-dispatch the order: one parcel per supplier, each auto-assigned to
    // the least-loaded courier (same helper as the demo / a real webhook)
    $dispatch = dispatchOrder($pdo, $orderId);

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    if ($e->getMessage() === 'OUT_OF_STOCK') {
      sendJson(409, false, null, ['code' => 'OUT_OF_STOCK', 'message' => 'Sorry — an item just sold out. You were not charged.']);
    }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Payment could not be completed.']);
  }

  // notify the buyer their payment went through (best-effort; after commit)
  if (function_exists('notifyOrderStatusChange')) {
    notifyOrderStatusChange($pdo, $orderId, 'Paid');
  }

  sendJson(200, true, [
    'orderId'       => $orderId,
    'status'        => 'Paid',
    'paymentId'     => $payId,
    'paymentMethod' => $method,
    'amount'        => $amount,
    'deliveries'    => $dispatch,
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
