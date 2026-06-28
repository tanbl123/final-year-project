<?php
// Customer wishlist (saved products). One wishlist per customer; items are at
// the PRODUCT level (no size). All endpoints require a Customer token.

function getOrCreateWishlistId(PDO $pdo, string $customerId): string {
  $stmt = $pdo->prepare('SELECT wishlistId FROM wishlist WHERE customerId = :cid');
  $stmt->execute(['cid' => $customerId]);
  $id = $stmt->fetchColumn();
  if ($id) { return $id; }
  $id = nextId($pdo, 'wishlist', 'wishlistId', 'WLT');
  $pdo->prepare('INSERT INTO wishlist (wishlistId, customerId) VALUES (:id, :cid)')
      ->execute(['id' => $id, 'cid' => $customerId]);
  return $id;
}

// Returns one PAGE of wishlist items, plus the FULL set of saved product ids
// (so the app's heart icons everywhere stay correct) and the total count.
function wishlistPayload(PDO $pdo, string $wishlistId, int $page = 1, int $limit = 20): array {
  $page   = max(1, $page);
  $limit  = min(60, max(1, $limit));
  $offset = ($page - 1) * $limit;

  $total = (int) $pdo->query(
    "SELECT COUNT(*) FROM wishlist_item WHERE wishlistId = " . $pdo->quote($wishlistId)
  )->fetchColumn();

  // every saved product id (lightweight) — drives hearts across the app
  $idsStmt = $pdo->prepare('SELECT productId FROM wishlist_item WHERE wishlistId = :wid');
  $idsStmt->execute(['wid' => $wishlistId]);
  $savedIds = array_column($idsStmt->fetchAll(), 'productId');

  $stmt = $pdo->prepare(
    "SELECT wi.wishlistItemId, p.productId, p.productName AS name, p.productBrand AS brand,
            p.productPrice AS price, p.productStatus AS status, c.categoryName AS categoryName,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl,
            (SELECT ROUND(AVG(r.ratingScore), 1) FROM review r
              WHERE r.productId = p.productId AND r.reviewStatus = 'Published') AS ratingAverage,
            (SELECT COUNT(*) FROM review r
              WHERE r.productId = p.productId AND r.reviewStatus = 'Published') AS ratingCount
       FROM wishlist_item wi
       JOIN product p  ON p.productId = wi.productId
       JOIN category c ON c.categoryId = p.categoryId
      WHERE wi.wishlistId = :wid
      ORDER BY wi.wishlistAddedAt DESC
      LIMIT :limit OFFSET :offset"
  );
  $stmt->bindValue(':wid', $wishlistId);
  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
  $stmt->execute();

  $items = [];
  foreach ($stmt->fetchAll() as $r) {
    $items[] = [
      'wishlistItemId' => $r['wishlistItemId'],
      'productId'      => $r['productId'],
      'name'           => $r['name'],
      'brand'          => $r['brand'],
      'price'          => (float) $r['price'],
      'imageUrl'       => $r['imageUrl'],
      'categoryName'   => $r['categoryName'],
      'ratingAverage'  => $r['ratingAverage'] !== null ? (float) $r['ratingAverage'] : 0,
      'ratingCount'    => (int) $r['ratingCount'],
      'available'      => $r['status'] === 'Approved',   // still buyable?
    ];
  }
  // itemCount = TOTAL saved (used for the count badge), not the page size.
  return [
    'wishlistId' => $wishlistId,
    'items'      => $items,
    'itemCount'  => $total,
    'total'      => $total,
    'page'       => $page,
    'savedIds'   => $savedIds,
  ];
}

// GET /wishlist — optional ?page&limit for the wishlist screen's infinite scroll.
function handleGetWishlist(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $wishlistId = getOrCreateWishlistId($pdo, $customerId);
  $page  = (int) ($_GET['page'] ?? 1);
  $limit = (int) ($_GET['limit'] ?? 20);
  sendJson(200, true, wishlistPayload($pdo, $wishlistId, $page, $limit));
}

// POST /wishlist/items — body: { productId }. Idempotent (saving twice is fine).
function handleAddWishlistItem(PDO $pdo, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $body = getJsonBody();
  $productId = trim($body['productId'] ?? '');
  if ($productId === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A product is required.']);
  }

  $chk = $pdo->prepare("SELECT 1 FROM product WHERE productId = :id AND productStatus = 'Approved'");
  $chk->execute(['id' => $productId]);
  if (!$chk->fetch()) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not available.']);
  }

  $wishlistId = getOrCreateWishlistId($pdo, $customerId);
  $ex = $pdo->prepare('SELECT 1 FROM wishlist_item WHERE wishlistId = :wid AND productId = :pid');
  $ex->execute(['wid' => $wishlistId, 'pid' => $productId]);
  if (!$ex->fetch()) {
    $id = nextId($pdo, 'wishlist_item', 'wishlistItemId', 'WLI');
    $pdo->prepare('INSERT INTO wishlist_item (wishlistItemId, wishlistId, productId) VALUES (:id, :wid, :pid)')
        ->execute(['id' => $id, 'wid' => $wishlistId, 'pid' => $productId]);
  }

  sendJson(200, true, wishlistPayload($pdo, $wishlistId));
}

// DELETE /wishlist/items/{productId} — remove by product (the app's heart-toggle).
function handleRemoveWishlistItem(PDO $pdo, array $auth, string $productId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $wishlistId = getOrCreateWishlistId($pdo, $customerId);
  $pdo->prepare('DELETE FROM wishlist_item WHERE wishlistId = :wid AND productId = :pid')
      ->execute(['wid' => $wishlistId, 'pid' => $productId]);
  sendJson(200, true, wishlistPayload($pdo, $wishlistId));
}
