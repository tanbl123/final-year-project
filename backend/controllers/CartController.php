<?php
// Customer shopping cart. One cart per customer; each line references a specific
// product_variant (size). All endpoints require a Customer token. Subtotals are
// always computed from the CURRENT product price so the cart can't go stale.

// Find the customer's cart, creating an empty one on first use.
function getOrCreateCartId(PDO $pdo, string $customerId): string {
  $stmt = $pdo->prepare('SELECT cartId FROM cart WHERE customerId = :cid');
  $stmt->execute(['cid' => $customerId]);
  $id = $stmt->fetchColumn();
  if ($id) { return $id; }
  $id = nextId($pdo, 'cart', 'cartId', 'CRT');
  $pdo->prepare('INSERT INTO cart (cartId, customerId) VALUES (:id, :cid)')
      ->execute(['id' => $id, 'cid' => $customerId]);
  return $id;
}

// Stamp the cart's last-activity time. Drives the abandoned-cart sweep (and
// re-arms a previously-sent reminder, since the sweep only skips carts reminded
// since their last change).
function touchCart(PDO $pdo, string $cartId): void {
  try {
    $pdo->prepare('UPDATE cart SET cartUpdatedAt = NOW() WHERE cartId = :id')->execute(['id' => $cartId]);
  } catch (Throwable $e) {/* column may not exist yet on un-migrated DBs */}
}

// Build the cart response: its items (with live price/subtotal) + the total.
function cartPayload(PDO $pdo, string $cartId): array {
  $stmt = $pdo->prepare(
    "SELECT ci.cartItemId, ci.cartItemQuantity AS quantity,
            pv.productVariantId AS variantId, pv.size, pv.stockQuantity AS stock,
            p.productId, p.productName, p.productBrand AS brand, p.productPrice AS price,
            p.supplierId, COALESCE(NULLIF(s.displayName, ''), s.companyName) AS supplierName,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl
       FROM cart_item ci
       JOIN product_variant pv ON pv.productVariantId = ci.productVariantId
       JOIN product p          ON p.productId = pv.productId
       JOIN supplier s         ON s.supplierId = p.supplierId
      WHERE ci.cartId = :cid
      ORDER BY COALESCE(NULLIF(s.displayName, ''), s.companyName), ci.cartItemId"
  );
  $stmt->execute(['cid' => $cartId]);

  $items = [];
  $total = 0.0;
  foreach ($stmt->fetchAll() as $r) {
    $price = (float) $r['price'];
    $qty   = (int) $r['quantity'];
    $sub   = round($price * $qty, 2);
    $total += $sub;
    $items[] = [
      'cartItemId'   => $r['cartItemId'],
      'variantId'    => $r['variantId'],
      'productId'    => $r['productId'],
      'productName'  => $r['productName'],
      'brand'        => $r['brand'],
      'supplierId'   => $r['supplierId'],
      'supplierName' => $r['supplierName'],
      'imageUrl'     => $r['imageUrl'],
      'size'         => $r['size'],
      'unitPrice'    => $price,
      'quantity'     => $qty,
      'stock'        => (int) $r['stock'],
      'subtotal'     => $sub,
    ];
  }
  return [
    'cartId'    => $cartId,
    'items'     => $items,
    'itemCount' => count($items),
    'total'     => round($total, 2),
  ];
}

// GET /cart
function handleGetCart(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $cartId = getOrCreateCartId($pdo, $customerId);
  sendJson(200, true, cartPayload($pdo, $cartId));
}

// POST /cart/items — body: { variantId, quantity }. Adds, or tops up an existing
// line for the same size. Never lets the line exceed available stock.
function handleAddCartItem(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body = getJsonBody();
  $variantId = trim($body['variantId'] ?? '');
  $qty = filter_var($body['quantity'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
  if ($variantId === '' || $qty === false) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A size and a quantity of 1 or more are required.']);
  }

  $v = $pdo->prepare(
    "SELECT pv.stockQuantity, p.productStatus, p.productPrice
       FROM product_variant pv JOIN product p ON p.productId = pv.productId
      WHERE pv.productVariantId = :vid"
  );
  $v->execute(['vid' => $variantId]);
  $row = $v->fetch();
  if (!$row || $row['productStatus'] !== 'Approved') {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not available.']);
  }
  $stock = (int) $row['stockQuantity'];
  $price = (float) $row['productPrice'];

  $cartId = getOrCreateCartId($pdo, $customerId);
  $ex = $pdo->prepare('SELECT cartItemId, cartItemQuantity FROM cart_item WHERE cartId = :cid AND productVariantId = :vid');
  $ex->execute(['cid' => $cartId, 'vid' => $variantId]);
  $existing = $ex->fetch();

  $newQty = ($existing ? (int) $existing['cartItemQuantity'] : 0) + $qty;
  if ($newQty > $stock) {
    sendJson(409, false, null, ['code' => 'OUT_OF_STOCK', 'message' => "Only {$stock} left in stock for this size."]);
  }
  $subtotal = round($price * $newQty, 2);

  if ($existing) {
    $pdo->prepare('UPDATE cart_item SET cartItemQuantity = :q, cartItemSubtotal = :s WHERE cartItemId = :id')
        ->execute(['q' => $newQty, 's' => $subtotal, 'id' => $existing['cartItemId']]);
  } else {
    $cid = nextId($pdo, 'cart_item', 'cartItemId', 'CIT');
    $pdo->prepare(
      'INSERT INTO cart_item (cartItemId, cartId, productVariantId, cartItemQuantity, cartItemSubtotal)
       VALUES (:id, :cart, :vid, :q, :s)'
    )->execute(['id' => $cid, 'cart' => $cartId, 'vid' => $variantId, 'q' => $newQty, 's' => $subtotal]);
  }

  touchCart($pdo, $cartId);
  sendJson(200, true, cartPayload($pdo, $cartId));
}

// PUT /cart/items/{cartItemId} — body: { quantity }. Sets the exact quantity.
function handleUpdateCartItem(PDO $pdo, array $auth, string $cartItemId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body = getJsonBody();
  $qty = filter_var($body['quantity'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
  if ($qty === false) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Quantity must be 1 or more.']);
  }

  // ownership (the item's cart must be this customer's) + stock + price
  $stmt = $pdo->prepare(
    "SELECT ci.cartItemId, pv.stockQuantity, p.productPrice
       FROM cart_item ci
       JOIN cart c            ON c.cartId = ci.cartId
       JOIN product_variant pv ON pv.productVariantId = ci.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE ci.cartItemId = :id AND c.customerId = :cid"
  );
  $stmt->execute(['id' => $cartItemId, 'cid' => $customerId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Cart item not found.']);
  }
  if ($qty > (int) $row['stockQuantity']) {
    sendJson(409, false, null, ['code' => 'OUT_OF_STOCK', 'message' => "Only {$row['stockQuantity']} left in stock for this size."]);
  }
  $subtotal = round((float) $row['productPrice'] * $qty, 2);
  $pdo->prepare('UPDATE cart_item SET cartItemQuantity = :q, cartItemSubtotal = :s WHERE cartItemId = :id')
      ->execute(['q' => $qty, 's' => $subtotal, 'id' => $cartItemId]);

  $cartId = getOrCreateCartId($pdo, $customerId);
  touchCart($pdo, $cartId);
  sendJson(200, true, cartPayload($pdo, $cartId));
}

// DELETE /cart/items/{cartItemId}
function handleRemoveCartItem(PDO $pdo, array $auth, string $cartItemId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $del = $pdo->prepare(
    "DELETE ci FROM cart_item ci
       JOIN cart c ON c.cartId = ci.cartId
      WHERE ci.cartItemId = :id AND c.customerId = :cid"
  );
  $del->execute(['id' => $cartItemId, 'cid' => $customerId]);
  if ($del->rowCount() === 0) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Cart item not found.']);
  }
  $cartId = getOrCreateCartId($pdo, $customerId);
  touchCart($pdo, $cartId);
  sendJson(200, true, cartPayload($pdo, $cartId));
}
