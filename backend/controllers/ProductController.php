<?php
// Product endpoints for the Supplier portal. A supplier only ever sees /
// touches their OWN products (ownership enforced in every query).

// GET /products  — list this supplier's products (newest first).
// Returns the fields the portal needs to render cards AND filter the list:
// category, status, a primary image, and total stock (summed across sizes).
function handleListProducts(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT p.productId    AS id,
            p.productName   AS name,
            p.productBrand  AS brand,
            p.productPrice  AS price,
            p.productStatus AS status,
            p.categoryId    AS categoryId,
            c.categoryName  AS categoryName,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl,
            (SELECT COALESCE(SUM(pv.stockQuantity), 0) FROM product_variant pv
              WHERE pv.productId = p.productId) AS totalStock
     FROM product p
     JOIN category c ON c.categoryId = p.categoryId
     WHERE p.supplierId = :sid AND p.productStatus <> "Removed"
     ORDER BY p.created_at DESC'
  );
  $stmt->execute(['sid' => $supplierId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['price']      = (float) $r['price'];
    $r['totalStock'] = (int) $r['totalStock'];
  }
  sendJson(200, true, $rows);
}

// POST /products  — create a new product (with description, images, a 3D model
// and per-size stock) for this supplier. Everything is written in one
// transaction so a half-created product can never be left behind.
function handleCreateProduct(PDO $pdo, array $auth): void {
  $supplierId  = requireSupplierId($pdo, $auth);
  $body        = getJsonBody();
  $name        = trim($body['name'] ?? '');
  $brand       = trim($body['brand'] ?? '');
  $price       = $body['price'] ?? null;
  $categoryId  = trim($body['categoryId'] ?? '');
  $description = trim($body['description'] ?? '');
  $tryOn       = !empty($body['virtualTryOnEnable']);
  $variants    = is_array($body['variants'] ?? null) ? $body['variants'] : [];
  $images      = is_array($body['images'] ?? null) ? $body['images'] : [];
  $modelUrl    = trim($body['modelUrl'] ?? '');

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

  // Normalise sizes: trim, drop blanks, reject duplicate sizes and bad stock.
  $cleanVariants = [];
  $seenSizes     = [];
  foreach ($variants as $v) {
    $size  = trim($v['size'] ?? '');
    $stock = $v['stock'] ?? 0;
    if ($size === '') { continue; }
    if (isset($seenSizes[strtolower($size)])) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => "Duplicate size: {$size}."]);
    }
    if (!is_numeric($stock) || (int) $stock < 0) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Stock must be 0 or more.']);
    }
    $seenSizes[strtolower($size)] = true;
    $cleanVariants[] = ['size' => $size, 'stock' => (int) $stock];
  }

  $cleanImages = [];
  foreach ($images as $url) {
    $url = trim($url);
    if ($url !== '') { $cleanImages[] = $url; }
  }

  try {
    $pdo->beginTransaction();

    $id   = nextId($pdo, 'product', 'productId', 'PRD');
    $stmt = $pdo->prepare(
      'INSERT INTO product
         (productId, supplierId, categoryId, productName, productBrand,
          productDescription, productPrice, productStatus, virtualTryOnEnable)
       VALUES (:id, :sid, :cat, :name, :brand, :desc, :price, "Pending", :tryon)'
    );
    $stmt->execute([
      'id'    => $id,
      'sid'   => $supplierId,
      'cat'   => $categoryId,
      'name'  => $name,
      'brand' => $brand,
      'desc'  => $description !== '' ? $description : null,
      'price' => (float) $price,
      'tryon' => $tryOn ? 1 : 0,
    ]);

    foreach ($cleanVariants as $v) {
      $vid = nextId($pdo, 'product_variant', 'productVariantId', 'VAR');
      $pdo->prepare(
        'INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
         VALUES (:vid, :pid, :size, :stock)'
      )->execute(['vid' => $vid, 'pid' => $id, 'size' => $v['size'], 'stock' => $v['stock']]);
    }

    foreach ($cleanImages as $url) {
      $iid = nextId($pdo, 'product_image', 'productImageId', 'IMG');
      $pdo->prepare(
        'INSERT INTO product_image (productImageId, productId, productImageUrl)
         VALUES (:iid, :pid, :url)'
      )->execute(['iid' => $iid, 'pid' => $id, 'url' => $url]);
    }

    if ($modelUrl !== '') {
      $mid = nextId($pdo, 'product_model', 'productModelId', 'MOD');
      $pdo->prepare(
        'INSERT INTO product_model (productModelId, productId, productModelUrl)
         VALUES (:mid, :pid, :url)'
      )->execute(['mid' => $mid, 'pid' => $id, 'url' => $modelUrl]);
    }

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not create the product.']);
  }

  sendJson(201, true, [
    'id'         => $id,
    'name'       => $name,
    'brand'      => $brand,
    'price'      => (float) $price,
    'status'     => 'Pending',
    'categoryId' => $categoryId,
    'imageUrl'   => $cleanImages[0] ?? null,
    'totalStock' => array_sum(array_column($cleanVariants, 'stock')),
  ]);
}

// GET /products/{id}  — one product, in full (must belong to this supplier).
function handleGetProduct(PDO $pdo, array $auth, string $id): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT p.productId AS id, p.productName AS name, p.productBrand AS brand,
            p.productDescription AS description, p.productPrice AS price,
            p.productStatus AS status, p.virtualTryOnEnable AS virtualTryOnEnable,
            p.categoryId AS categoryId, c.categoryName AS categoryName
     FROM product p
     JOIN category c ON c.categoryId = p.categoryId
     WHERE p.productId = :id AND p.supplierId = :sid'
  );
  $stmt->execute(['id' => $id, 'sid' => $supplierId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  $row['price']              = (float) $row['price'];
  $row['virtualTryOnEnable'] = (bool) $row['virtualTryOnEnable'];

  $imgs = $pdo->prepare('SELECT productImageUrl FROM product_image WHERE productId = :id ORDER BY productImageId');
  $imgs->execute(['id' => $id]);
  $row['images'] = array_column($imgs->fetchAll(), 'productImageUrl');

  $mdl = $pdo->prepare('SELECT productModelUrl FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $mdl->execute(['id' => $id]);
  $modelRow = $mdl->fetch();
  $row['modelUrl'] = $modelRow ? $modelRow['productModelUrl'] : null;

  $vars = $pdo->prepare('SELECT size, stockQuantity AS stock FROM product_variant WHERE productId = :id ORDER BY productVariantId');
  $vars->execute(['id' => $id]);
  $row['variants'] = array_map(
    fn ($v) => ['size' => $v['size'], 'stock' => (int) $v['stock']],
    $vars->fetchAll()
  );
  $row['totalStock'] = array_sum(array_column($row['variants'], 'stock'));

  sendJson(200, true, $row);
}

// PUT /products/{id}  — edit one of this supplier's products. Mirrors create:
// same validation, same one-transaction write. Two behaviours worth noting:
//
//  1. RE-APPROVAL: changing a product's *identity* (name/brand/category/
//     description/images/3D model/try-on) sends an Approved or Rejected product
//     back to `Pending` so an admin re-checks it — this guards against
//     bait-and-switch, the same reason real marketplaces re-review these fields.
//     PRICE and STOCK are commercial/inventory fields and apply instantly
//     (no re-approval), matching how Amazon/Shopee/Lazada handle live edits.
//  2. SIZES are reconciled, not wiped: existing sizes have their stock updated,
//     new sizes are inserted, and a removed size is deleted — unless it has
//     already been ordered (order_item FK is RESTRICT), in which case it is kept
//     but set to 0 stock so order history is preserved.
function handleUpdateProduct(PDO $pdo, array $auth, string $id): void {
  $supplierId  = requireSupplierId($pdo, $auth);
  $body        = getJsonBody();
  $name        = trim($body['name'] ?? '');
  $brand       = trim($body['brand'] ?? '');
  $price       = $body['price'] ?? null;
  $categoryId  = trim($body['categoryId'] ?? '');
  $description = trim($body['description'] ?? '');
  $tryOn       = !empty($body['virtualTryOnEnable']);
  $variants    = is_array($body['variants'] ?? null) ? $body['variants'] : [];
  $images      = is_array($body['images'] ?? null) ? $body['images'] : [];
  $modelUrl    = trim($body['modelUrl'] ?? '');

  // The product must exist and belong to this supplier.
  $cur = $pdo->prepare(
    'SELECT productName, productBrand, productDescription, productPrice,
            categoryId, productStatus, virtualTryOnEnable
       FROM product WHERE productId = :id AND supplierId = :sid'
  );
  $cur->execute(['id' => $id, 'sid' => $supplierId]);
  $current = $cur->fetch();
  if (!$current) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  if ($current['productStatus'] === 'Removed') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This product has been removed.']);
  }

  if ($name === '' || $brand === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Name and brand are required.']);
  }
  if (!is_numeric($price) || (float) $price <= 0) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Price must be a number greater than 0.']);
  }
  if ($categoryId === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Category is required.']);
  }
  $chk = $pdo->prepare('SELECT 1 FROM category WHERE categoryId = :cid');
  $chk->execute(['cid' => $categoryId]);
  if (!$chk->fetch()) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid category.']);
  }

  // Normalise sizes (same rules as create).
  $cleanVariants = [];
  $seenSizes     = [];
  foreach ($variants as $v) {
    $size  = trim($v['size'] ?? '');
    $stock = $v['stock'] ?? 0;
    if ($size === '') { continue; }
    if (isset($seenSizes[strtolower($size)])) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => "Duplicate size: {$size}."]);
    }
    if (!is_numeric($stock) || (int) $stock < 0) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Stock must be 0 or more.']);
    }
    $seenSizes[strtolower($size)] = true;
    $cleanVariants[] = ['size' => $size, 'stock' => (int) $stock];
  }

  $cleanImages = [];
  foreach ($images as $url) {
    $url = trim($url);
    if ($url !== '') { $cleanImages[] = $url; }
  }

  // Current images + model, so we can tell whether *content* really changed.
  $curImgs = $pdo->prepare('SELECT productImageUrl FROM product_image WHERE productId = :id ORDER BY productImageId');
  $curImgs->execute(['id' => $id]);
  $currentImages = array_column($curImgs->fetchAll(), 'productImageUrl');

  $curMdl = $pdo->prepare('SELECT productModelUrl FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $curMdl->execute(['id' => $id]);
  $currentModel = (string) ($curMdl->fetchColumn() ?: '');

  // Did any *identity* field change? PRICE and STOCK are deliberately excluded
  // here — they're commercial/inventory fields that apply instantly with no
  // re-approval (matching real marketplaces).
  $identityChanged =
       $name        !== $current['productName']
    || $brand       !== $current['productBrand']
    || $description !== (string) ($current['productDescription'] ?? '')
    || $categoryId  !== $current['categoryId']
    || ($tryOn ? 1 : 0) !== (int) $current['virtualTryOnEnable']
    || $cleanImages !== $currentImages
    || $modelUrl    !== $currentModel;

  // Re-approval: an Approved/Rejected product goes back to Pending on an
  // identity change; a Pending product stays Pending. Price/stock-only edits
  // keep the current status.
  $newStatus = $current['productStatus'];
  if ($identityChanged && in_array($current['productStatus'], ['Approved', 'Rejected'], true)) {
    $newStatus = 'Pending';
  }

  try {
    $pdo->beginTransaction();

    $pdo->prepare(
      'UPDATE product
          SET productName = :name, productBrand = :brand, productDescription = :desc,
              productPrice = :price, categoryId = :cat, virtualTryOnEnable = :tryon,
              productStatus = :status
        WHERE productId = :id AND supplierId = :sid'
    )->execute([
      'name'   => $name,
      'brand'  => $brand,
      'desc'   => $description !== '' ? $description : null,
      'price'  => (float) $price,
      'cat'    => $categoryId,
      'tryon'  => $tryOn ? 1 : 0,
      'status' => $newStatus,
      'id'     => $id,
      'sid'    => $supplierId,
    ]);

    // ── reconcile sizes (match existing by size, case-insensitively) ──
    $existing = $pdo->prepare('SELECT productVariantId, size, stockQuantity FROM product_variant WHERE productId = :id');
    $existing->execute(['id' => $id]);

    $incoming = [];                                   // lower(size) → stock
    foreach ($cleanVariants as $v) { $incoming[strtolower($v['size'])] = $v['stock']; }

    $refChk  = $pdo->prepare('SELECT 1 FROM order_item WHERE productVariantId = :vid LIMIT 1');
    $updStk  = $pdo->prepare('UPDATE product_variant SET stockQuantity = :stock WHERE productVariantId = :vid');
    $delVar  = $pdo->prepare('DELETE FROM product_variant WHERE productVariantId = :vid');

    foreach ($existing->fetchAll() as $e) {
      $key = strtolower($e['size']);
      if (array_key_exists($key, $incoming)) {
        $updStk->execute(['stock' => $incoming[$key], 'vid' => $e['productVariantId']]);
        unset($incoming[$key]);                       // handled
      } else {
        // removed by the supplier — keep it (stock 0) if it has been ordered
        $refChk->execute(['vid' => $e['productVariantId']]);
        if ($refChk->fetch()) {
          $updStk->execute(['stock' => 0, 'vid' => $e['productVariantId']]);
        } else {
          $delVar->execute(['vid' => $e['productVariantId']]);
        }
      }
    }
    // whatever is left in $incoming is a brand-new size
    foreach ($incoming as $sizeLower => $stock) {
      // recover the original (un-lowercased) size text
      $size = '';
      foreach ($cleanVariants as $v) { if (strtolower($v['size']) === $sizeLower) { $size = $v['size']; break; } }
      $vid  = nextId($pdo, 'product_variant', 'productVariantId', 'VAR');
      $pdo->prepare(
        'INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
         VALUES (:vid, :pid, :size, :stock)'
      )->execute(['vid' => $vid, 'pid' => $id, 'size' => $size, 'stock' => $stock]);
    }

    // ── images: full replace (no other table references product_image) ──
    $pdo->prepare('DELETE FROM product_image WHERE productId = :id')->execute(['id' => $id]);
    foreach ($cleanImages as $url) {
      $iid = nextId($pdo, 'product_image', 'productImageId', 'IMG');
      $pdo->prepare(
        'INSERT INTO product_image (productImageId, productId, productImageUrl) VALUES (:iid, :pid, :url)'
      )->execute(['iid' => $iid, 'pid' => $id, 'url' => $url]);
    }

    // ── 3D model: full replace ──
    $pdo->prepare('DELETE FROM product_model WHERE productId = :id')->execute(['id' => $id]);
    if ($modelUrl !== '') {
      $mid = nextId($pdo, 'product_model', 'productModelId', 'MOD');
      $pdo->prepare(
        'INSERT INTO product_model (productModelId, productId, productModelUrl) VALUES (:mid, :pid, :url)'
      )->execute(['mid' => $mid, 'pid' => $id, 'url' => $modelUrl]);
    }

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not update the product.']);
  }

  sendJson(200, true, [
    'id'           => $id,
    'name'         => $name,
    'brand'        => $brand,
    'price'        => (float) $price,
    'status'       => $newStatus,
    'categoryId'   => $categoryId,
    'imageUrl'     => $cleanImages[0] ?? null,
    'totalStock'   => array_sum(array_column($cleanVariants, 'stock')),
    'reapproval'   => $newStatus === 'Pending' && $current['productStatus'] !== 'Pending',
  ]);
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

// ── Inventory (quick stock management) ───────────────────────────────
// A flat, size-level view so a supplier can adjust quantities across their
// whole catalogue in one screen, without opening each product's full editor.

// GET /supplier/inventory — every size (variant) of this supplier's products.
function handleListInventory(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $stmt = $pdo->prepare(
    'SELECT pv.productVariantId AS variantId,
            p.productId         AS productId,
            p.productName       AS productName,
            p.productBrand      AS brand,
            p.productStatus     AS status,
            pv.size             AS size,
            pv.stockQuantity    AS stock,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl
       FROM product p
       JOIN product_variant pv ON pv.productId = p.productId
      WHERE p.supplierId = :sid AND p.productStatus <> "Removed"
      ORDER BY p.productName, pv.productVariantId'
  );
  $stmt->execute(['sid' => $supplierId]);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['stock'] = (int) $r['stock']; }
  unset($r);
  sendJson(200, true, ['inventory' => $rows]);
}

// PATCH /supplier/inventory — bulk stock update. Body: { updates: [ { variantId,
// stock }, ... ] }. Stock-only, so it never changes product approval status.
// Every variant must belong to the caller; all rows are written in one
// transaction (all-or-nothing).
function handleUpdateInventory(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body    = getJsonBody();
  $updates = is_array($body['updates'] ?? null) ? $body['updates'] : [];
  if (count($updates) === 0) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'No stock changes provided.']);
  }

  // Validate + de-dupe (last value wins) into variantId => stock.
  $clean = [];
  foreach ($updates as $u) {
    $vid   = trim($u['variantId'] ?? '');
    $stock = filter_var($u['stock'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($vid === '') { continue; }
    if ($stock === false) {
      sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Stock must be a whole number of 0 or more.']);
    }
    $clean[$vid] = $stock;
  }
  if (count($clean) === 0) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'No valid stock changes provided.']);
  }

  // Ownership: every variant must belong to one of this supplier's products.
  $ids          = array_keys($clean);
  $placeholders = implode(',', array_fill(0, count($ids), '?'));
  $own = $pdo->prepare(
    "SELECT pv.productVariantId
       FROM product_variant pv
       JOIN product p ON p.productId = pv.productId
      WHERE p.supplierId = ? AND pv.productVariantId IN ($placeholders)"
  );
  $own->execute(array_merge([$supplierId], $ids));
  if (count($own->fetchAll()) !== count($ids)) {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'One or more sizes are not yours.']);
  }

  try {
    $pdo->beginTransaction();
    $upd = $pdo->prepare('UPDATE product_variant SET stockQuantity = :stock WHERE productVariantId = :vid');
    foreach ($clean as $vid => $stock) {
      $upd->execute(['stock' => $stock, 'vid' => $vid]);
    }
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not update stock.']);
  }

  sendJson(200, true, ['updated' => count($clean)]);
}
