<?php
// Product endpoints for the Supplier portal. A supplier only ever sees /
// touches their OWN products (ownership enforced in every query).

// Max product images per listing (kept in sync with the ProductForm cap).
const MAX_PRODUCT_IMAGES = 8;

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
function handleCreateProduct(PDO $pdo, array $auth, array $config = []): void {
  $supplierId  = requireSupplierId($pdo, $auth);

  // Payout gate: a supplier must have a connected + verified Stripe payout
  // account before listing products. This guarantees every seller with live
  // products can actually receive their sales income, so the platform never
  // holds orphaned funds for an unconnected seller — i.e. no escrow needed.
  // Only enforced when Stripe is configured (skipped in demo/no-Stripe setups).
  if (!empty($config['stripe_secret'])) {
    $st = $pdo->prepare('SELECT payoutsEnabled FROM supplier WHERE supplierId = :id');
    $st->execute(['id' => $supplierId]);
    if ((int) $st->fetchColumn() !== 1) {
      sendJson(403, false, null, ['code' => 'PAYOUT_REQUIRED',
        'message' => 'Connect your payout account (Payouts → Connect with Stripe) before listing products.']);
    }
  }

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
  if (count($cleanImages) > MAX_PRODUCT_IMAGES) {
    sendJson(400, false, null, ['code' => 'VALIDATION',
      'message' => 'A product can have at most ' . MAX_PRODUCT_IMAGES . ' images.']);
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

  $mdl = $pdo->prepare('SELECT productModelUrl, arLensId FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $mdl->execute(['id' => $id]);
  $modelRow = $mdl->fetch();
  $row['modelUrl'] = $modelRow ? $modelRow['productModelUrl'] : null;
  $row['arLensId'] = $modelRow ? $modelRow['arLensId'] : null;   // Camera Kit lens id (AR try-on)

  $vars = $pdo->prepare('SELECT size, stockQuantity AS stock FROM product_variant WHERE productId = :id ORDER BY productVariantId');
  $vars->execute(['id' => $id]);
  $row['variants'] = array_map(
    fn ($v) => ['size' => $v['size'], 'stock' => (int) $v['stock']],
    $vars->fetchAll()
  );
  $row['totalStock'] = array_sum(array_column($row['variants'], 'stock'));

  // published reviews + a rating summary (reviews live on the product, so the
  // supplier sees them here rather than on a separate page)
  $rev = $pdo->prepare(
    "SELECT r.reviewId, r.ratingScore, r.reviewComment, r.reviewDate,
            r.supplierReply, r.supplierReplyDate,
            buyer.fullName AS customerName
       FROM review r
       JOIN customer c   ON c.customerId = r.customerId
       JOIN `user` buyer ON buyer.userId = c.userId
      WHERE r.productId = :id AND r.reviewStatus = 'Published'
      ORDER BY r.reviewDate DESC"
  );
  $rev->execute(['id' => $id]);
  $reviews = $rev->fetchAll();
  foreach ($reviews as &$rv) { $rv['ratingScore'] = (int) $rv['ratingScore']; }
  unset($rv);
  $row['reviews']       = $reviews;
  $row['ratingCount']   = count($reviews);
  $row['ratingAverage'] = $reviews
    ? round(array_sum(array_column($reviews, 'ratingScore')) / count($reviews), 1)
    : 0;

  sendJson(200, true, $row);
}

// GET /admin/products/{id} — full product detail for the ADMIN (any product,
// any status, any supplier) so they can actually SEE a product — images,
// description, sizes/stock, 3D model — before approving or rejecting it.
function handleGetAdminProduct(PDO $pdo, string $id): void {
  $stmt = $pdo->prepare(
    'SELECT p.productId AS id, p.productName AS name, p.productBrand AS brand,
            p.productDescription AS description, p.productPrice AS price,
            p.productStatus AS status, p.virtualTryOnEnable AS virtualTryOnEnable,
            p.categoryId AS categoryId, c.categoryName AS categoryName,
            s.companyName AS supplierName
     FROM product p
     JOIN category c ON c.categoryId = p.categoryId
     JOIN supplier s ON s.supplierId = p.supplierId
     WHERE p.productId = :id'
  );
  $stmt->execute(['id' => $id]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  $row['price']              = (float) $row['price'];
  $row['virtualTryOnEnable'] = (bool) $row['virtualTryOnEnable'];

  $imgs = $pdo->prepare('SELECT productImageUrl FROM product_image WHERE productId = :id ORDER BY productImageId');
  $imgs->execute(['id' => $id]);
  $row['images'] = array_column($imgs->fetchAll(), 'productImageUrl');

  $mdl = $pdo->prepare('SELECT productModelUrl, arLensId FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $mdl->execute(['id' => $id]);
  $modelRow = $mdl->fetch();
  $row['modelUrl'] = $modelRow ? $modelRow['productModelUrl'] : null;
  $row['arLensId'] = $modelRow ? $modelRow['arLensId'] : null;   // Camera Kit lens id (AR try-on)

  $vars = $pdo->prepare('SELECT size, stockQuantity AS stock FROM product_variant WHERE productId = :id ORDER BY productVariantId');
  $vars->execute(['id' => $id]);
  $row['variants'] = array_map(
    fn ($v) => ['size' => $v['size'], 'stock' => (int) $v['stock']],
    $vars->fetchAll()
  );
  $row['totalStock'] = array_sum(array_column($row['variants'], 'stock'));

  sendJson(200, true, $row);
}

// PUT /admin/products/{id}/ar-lens  — admin records (or clears) the Snapchat
// Camera Kit LENS ID for a product's 3D model, after building the foot-tracking
// lens in Lens Studio. When set, the customer app offers AR try-on for the
// product; sending an empty/null value removes it. The lens GROUP id is a single
// app-level constant, so only the per-product lens id is stored here.
function handleSetAdminProductArLens(PDO $pdo, string $id): void {
  $body   = getJsonBody();
  $lensId = trim((string) ($body['arLensId'] ?? ''));

  // Camera Kit lens ids are short, UUID-like tokens.
  if ($lensId !== '' && !preg_match('/^[A-Za-z0-9._-]{1,64}$/', $lensId)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid lens id.']);
  }

  $chk = $pdo->prepare('SELECT 1 FROM product WHERE productId = :id');
  $chk->execute(['id' => $id]);
  if (!$chk->fetch()) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }

  // The lens is attached to the product's 3D model row, so one must exist.
  $mdl = $pdo->prepare('SELECT productModelId FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $mdl->execute(['id' => $id]);
  $modelId = $mdl->fetchColumn();
  if (!$modelId) {
    sendJson(400, false, null, ['code' => 'NO_MODEL',
      'message' => 'This product has no 3D model to attach an AR lens to.']);
  }

  $upd = $pdo->prepare('UPDATE product_model SET arLensId = :lens WHERE productModelId = :mid');
  $upd->execute(['lens' => $lensId !== '' ? $lensId : null, 'mid' => $modelId]);

  sendJson(200, true, ['productId' => $id, 'arLensId' => $lensId !== '' ? $lensId : null]);
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
  if (count($cleanImages) > MAX_PRODUCT_IMAGES) {
    sendJson(400, false, null, ['code' => 'VALIDATION',
      'message' => 'A product can have at most ' . MAX_PRODUCT_IMAGES . ' images.']);
  }

  // Current images + model, so we can tell whether *content* really changed.
  $curImgs = $pdo->prepare('SELECT productImageUrl FROM product_image WHERE productId = :id ORDER BY productImageId');
  $curImgs->execute(['id' => $id]);
  $currentImages = array_column($curImgs->fetchAll(), 'productImageUrl');

  $curMdl = $pdo->prepare('SELECT productModelId, productModelUrl, arLensId FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $curMdl->execute(['id' => $id]);
  $curModelRow  = $curMdl->fetch();
  $currentModel = (string) ($curModelRow['productModelUrl'] ?? '');

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

  // Pre-update snapshot, so we can fire wishlist nudges (price drop / back in
  // stock) after the commit. New total stock = sum of the incoming variants.
  $oldPrice = (float) $current['productPrice'];
  $oldStockStmt = $pdo->prepare('SELECT COALESCE(SUM(stockQuantity),0) FROM product_variant WHERE productId = :id');
  $oldStockStmt->execute(['id' => $id]);
  $oldTotalStock = (int) $oldStockStmt->fetchColumn();
  $newTotalStock = array_sum(array_column($cleanVariants, 'stock'));

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

    // ── 3D model: preserve the admin-set AR lens when the model is unchanged ──
    // The Camera Kit lens is built FROM a specific 3D model, so a blind
    // delete+reinsert would wipe the admin's arLensId on every supplier edit.
    //   • model URL unchanged → keep the row + its arLensId
    //   • model URL changed   → update the URL, clear arLensId (old lens is stale)
    //   • model removed        → drop the row (and its lens)
    if ($modelUrl === '') {
      $pdo->prepare('DELETE FROM product_model WHERE productId = :id')->execute(['id' => $id]);
    } elseif ($curModelRow) {
      $keepLens = ($currentModel === $modelUrl) ? ($curModelRow['arLensId'] ?? null) : null;
      $pdo->prepare(
        'UPDATE product_model SET productModelUrl = :url, arLensId = :lens WHERE productModelId = :mid'
      )->execute(['url' => $modelUrl, 'lens' => $keepLens, 'mid' => $curModelRow['productModelId']]);
    } else {
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

  // Wishlist nudges (best-effort, after commit) — only for a still-visible
  // product, so we never ping shoppers about something they can't see.
  if ($newStatus === 'Approved') {
    if (function_exists('notifyWishlistPriceDrop')) {
      notifyWishlistPriceDrop($pdo, $id, $oldPrice, (float) $price);
    }
    if ($oldTotalStock === 0 && $newTotalStock > 0 && function_exists('notifyWishlistBackInStock')) {
      notifyWishlistBackInStock($pdo, $id);
    }
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

// GET /supplier/badge-counts — sidebar work-queue counts for a supplier:
//   inventory — variants that need restocking (low OR out of stock), matching
//               the Inventory page (stock <= 10, excluding Removed products);
//   orders    — Standard (3PL) parcels still Pending, i.e. the supplier needs
//               to ship them (book a courier / enter tracking).
const SUPPLIER_LOW_STOCK = 10;
function handleSupplierBadgeCounts(PDO $pdo, array $auth): void {
  $supplierId = requireSupplierId($pdo, $auth);

  $lowStock = $pdo->prepare(
    'SELECT COUNT(*) FROM product p
       JOIN product_variant pv ON pv.productId = p.productId
      WHERE p.supplierId = :sid AND p.productStatus <> "Removed" AND pv.stockQuantity <= :thr'
  );
  $lowStock->execute(['sid' => $supplierId, 'thr' => SUPPLIER_LOW_STOCK]);

  $toShip = $pdo->prepare(
    "SELECT COUNT(*) FROM delivery
      WHERE supplierId = :sid AND deliveryMethod = 'Standard' AND deliveryStatus = 'Pending'"
  );
  $toShip->execute(['sid' => $supplierId]);

  sendJson(200, true, ['counts' => [
    'inventory' => (int) $lowStock->fetchColumn(),
    'orders'    => (int) $toShip->fetchColumn(),
  ]]);
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

  // Pre-update total stock per affected product, so we can detect a 0→>0
  // restock after the commit and nudge wishlisters.
  $prodStmt = $pdo->prepare("SELECT DISTINCT productId FROM product_variant WHERE productVariantId IN ($placeholders)");
  $prodStmt->execute($ids);
  $productIds = $prodStmt->fetchAll(PDO::FETCH_COLUMN);
  $totStmt = $pdo->prepare('SELECT COALESCE(SUM(stockQuantity),0) FROM product_variant WHERE productId = :pid');
  $oldTotals = [];
  foreach ($productIds as $pid) {
    $totStmt->execute(['pid' => $pid]);
    $oldTotals[$pid] = (int) $totStmt->fetchColumn();
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

  // back-in-stock nudges (best-effort) for products that went 0 → in stock
  if (function_exists('notifyWishlistBackInStock')) {
    foreach ($productIds as $pid) {
      $totStmt->execute(['pid' => $pid]);
      $newTot = (int) $totStmt->fetchColumn();
      if (($oldTotals[$pid] ?? 0) === 0 && $newTot > 0) {
        notifyWishlistBackInStock($pdo, $pid);  // checks 'Approved' internally
      }
    }
  }

  sendJson(200, true, ['updated' => count($clean)]);
}

// GET /admin/inventory — product inventory across ALL suppliers (read-only).
// Filters: ?search= (product/supplier) ?status=. Covers FR 906 / UC 3.25.
function handleListAdminInventory(PDO $pdo): void {
  $search  = trim($_GET['search'] ?? '');
  $status  = trim($_GET['status'] ?? '');
  $allowed = ['Pending', 'Approved', 'Rejected'];

  $where  = ['p.productStatus <> "Removed"'];
  $params = [];
  if (in_array($status, $allowed, true)) { $where[] = 'p.productStatus = :st'; $params['st'] = $status; }
  if ($search !== '') {
    $where[] = '(p.productName LIKE :q1 OR s.companyName LIKE :q2)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
  }

  $sql =
    "SELECT p.productId, p.productName, p.productBrand AS brand, p.productStatus AS status,
            s.companyName AS supplierName,
            (SELECT COALESCE(SUM(pv.stockQuantity), 0) FROM product_variant pv WHERE pv.productId = p.productId) AS totalStock,
            (SELECT COUNT(*) FROM product_variant pv WHERE pv.productId = p.productId) AS sizeCount
       FROM product p
       JOIN supplier s ON s.supplierId = p.supplierId
      WHERE " . implode(' AND ', $where) . "
      ORDER BY p.productName";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['totalStock'] = (int) $r['totalStock'];
    $r['sizeCount']  = (int) $r['sizeCount'];
  }
  unset($r);
  sendJson(200, true, ['inventory' => $rows]);
}
