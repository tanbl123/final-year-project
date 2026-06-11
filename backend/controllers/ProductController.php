<?php
// Product endpoints for the Supplier portal. A supplier only ever sees /
// touches their OWN products (ownership enforced in every query).

// GET /products  — list this supplier's products (newest first).
function handleListProducts(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT productId AS id, productName AS name, productBrand AS brand, productPrice AS price
     FROM product
     WHERE supplierId = :sid AND productStatus <> "Removed"
     ORDER BY created_at DESC'
  );
  $stmt->execute(['sid' => $supplierId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['price'] = (float) $r['price']; }
  sendJson(200, true, $rows);
}

// POST /products  — create a new product for this supplier.
function handleCreateProduct(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body       = getJsonBody();
  $name       = trim($body['name'] ?? '');
  $brand      = trim($body['brand'] ?? '');
  $price      = $body['price'] ?? null;
  $categoryId = trim($body['categoryId'] ?? '');

  if ($name === '' || $brand === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Name and brand are required.']);
  }
  if (!is_numeric($price) || (float) $price <= 0) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Price must be a number greater than 0.']);
  }
  if ($categoryId === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Category is required.']);
  }
  // make sure the category actually exists (don't trust the client)
  $chk = $pdo->prepare('SELECT 1 FROM category WHERE categoryId = :cid');
  $chk->execute(['cid' => $categoryId]);
  if (!$chk->fetch()) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid category.']);
  }

  $id = nextId($pdo, 'product', 'productId', 'PRD');
  $stmt = $pdo->prepare(
    'INSERT INTO product (productId, supplierId, categoryId, productName, productBrand, productPrice, productStatus)
     VALUES (:id, :sid, :cat, :name, :brand, :price, "Pending")'
  );
  $stmt->execute([
    'id'    => $id,
    'sid'   => $supplierId,
    'cat'   => $categoryId,
    'name'  => $name,
    'brand' => $brand,
    'price' => (float) $price,
  ]);

  sendJson(201, true, ['id' => $id, 'name' => $name, 'brand' => $brand, 'price' => (float) $price]);
}

// GET /products/{id}  — one product (must belong to this supplier).
function handleGetProduct(PDO $pdo, array $auth, string $id): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT productId AS id, productName AS name, productBrand AS brand, productPrice AS price
     FROM product WHERE productId = :id AND supplierId = :sid'
  );
  $stmt->execute(['id' => $id, 'sid' => $supplierId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  $row['price'] = (float) $row['price'];
  sendJson(200, true, $row);
}

// DELETE /products/{id}  — soft-delete (mark Removed), only if it's this supplier's.
function handleDeleteProduct(PDO $pdo, array $auth, string $id): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'UPDATE product SET productStatus = "Removed"
     WHERE productId = :id AND supplierId = :sid AND productStatus <> "Removed"'
  );
  $stmt->execute(['id' => $id, 'sid' => $supplierId]);
  if ($stmt->rowCount() === 0) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  sendJson(200, true, ['id' => $id, 'deleted' => true]);
}
