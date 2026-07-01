<?php
// Public catalog browsing for the customer app (no login required — guests can
// browse too). Only APPROVED products are ever exposed here. Read-only.

// GET /catalog/products — list approved products. Query params:
//   categoryId, search, minPrice, maxPrice, sort(price_asc|price_desc|newest),
//   page, limit. Returns { items, page, limit, total }.
function handleListCatalog(PDO $pdo): void {
  $categoryId = trim($_GET['categoryId'] ?? '');
  $search     = trim($_GET['search'] ?? '');
  $minPrice   = $_GET['minPrice'] ?? '';
  $maxPrice   = $_GET['maxPrice'] ?? '';
  $sort       = $_GET['sort'] ?? '';
  $page       = max(1, (int) ($_GET['page'] ?? 1));
  $limit      = min(60, max(1, (int) ($_GET['limit'] ?? 20)));
  $offset     = ($page - 1) * $limit;

  $where  = ["p.productStatus = 'Approved'"];
  $params = [];
  if ($categoryId !== '') { $where[] = 'p.categoryId = :cat'; $params['cat'] = $categoryId; }
  if ($search !== '') {
    $where[] = '(p.productName LIKE :q1 OR p.productBrand LIKE :q2)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
  }
  if (is_numeric($minPrice)) { $where[] = 'p.productPrice >= :minp'; $params['minp'] = (float) $minPrice; }
  if (is_numeric($maxPrice)) { $where[] = 'p.productPrice <= :maxp'; $params['maxp'] = (float) $maxPrice; }
  $whereSql = implode(' AND ', $where);

  $count = $pdo->prepare("SELECT COUNT(*) FROM product p WHERE $whereSql");
  $count->execute($params);
  $total = (int) $count->fetchColumn();

  $order = 'p.created_at DESC';                       // default: newest
  if ($sort === 'price_asc')  { $order = 'p.productPrice ASC'; }
  if ($sort === 'price_desc') { $order = 'p.productPrice DESC'; }

  $sql =
    "SELECT p.productId AS id, p.productName AS name, p.productBrand AS brand,
            p.productPrice AS price, p.virtualTryOnEnable AS virtualTryOnEnable,
            c.categoryName AS categoryName,
            (SELECT pi.productImageUrl FROM product_image pi
              WHERE pi.productId = p.productId ORDER BY pi.productImageId LIMIT 1) AS imageUrl,
            (SELECT ROUND(AVG(r.ratingScore), 1) FROM review r
              WHERE r.productId = p.productId AND r.reviewStatus = 'Published') AS ratingAverage,
            (SELECT COUNT(*) FROM review r
              WHERE r.productId = p.productId AND r.reviewStatus = 'Published') AS ratingCount
       FROM product p
       JOIN category c ON c.categoryId = p.categoryId
      WHERE $whereSql
      ORDER BY $order
      LIMIT :limit OFFSET :offset";
  $stmt = $pdo->prepare($sql);
  foreach ($params as $k => $v) { $stmt->bindValue(':' . $k, $v); }
  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
  $stmt->execute();

  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) {
    $r['price']              = (float) $r['price'];
    $r['virtualTryOnEnable'] = (bool) $r['virtualTryOnEnable'];
    $r['ratingAverage']      = $r['ratingAverage'] !== null ? (float) $r['ratingAverage'] : 0;
    $r['ratingCount']        = (int) $r['ratingCount'];
  }
  unset($r);

  sendJson(200, true, ['items' => $rows, 'page' => $page, 'limit' => $limit, 'total' => $total]);
}

// GET /catalog/products/{id} — full public detail of an approved product:
// images, 3D model, sizes + stock, supplier, and published reviews.
function handleGetCatalogProduct(PDO $pdo, string $id): void {
  $stmt = $pdo->prepare(
    "SELECT p.productId AS id, p.productName AS name, p.productBrand AS brand,
            p.productDescription AS description, p.productPrice AS price,
            p.virtualTryOnEnable AS virtualTryOnEnable,
            p.categoryId AS categoryId, c.categoryName AS categoryName,
            s.supplierId, COALESCE(NULLIF(s.displayName, ''), s.companyName) AS supplierName
       FROM product p
       JOIN category c ON c.categoryId = p.categoryId
       JOIN supplier s ON s.supplierId = p.supplierId
      WHERE p.productId = :id AND p.productStatus = 'Approved'"
  );
  $stmt->execute(['id' => $id]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not available.']);
  }
  $row['price']              = (float) $row['price'];
  $row['virtualTryOnEnable'] = (bool) $row['virtualTryOnEnable'];

  $imgs = $pdo->prepare('SELECT productImageUrl FROM product_image WHERE productId = :id ORDER BY productImageId');
  $imgs->execute(['id' => $id]);
  $row['images'] = array_column($imgs->fetchAll(), 'productImageUrl');

  $mdl = $pdo->prepare('SELECT productModelUrl FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1');
  $mdl->execute(['id' => $id]);
  $row['modelUrl'] = $mdl->fetchColumn() ?: null;

  // sizes + stock so the app can disable out-of-stock sizes
  $vars = $pdo->prepare(
    'SELECT productVariantId AS variantId, size, stockQuantity AS stock
       FROM product_variant WHERE productId = :id ORDER BY productVariantId'
  );
  $vars->execute(['id' => $id]);
  $row['variants'] = array_map(
    fn ($v) => ['variantId' => $v['variantId'], 'size' => $v['size'], 'stock' => (int) $v['stock']],
    $vars->fetchAll()
  );

  $rev = $pdo->prepare(
    "SELECT r.reviewId, r.ratingScore, r.reviewComment, r.reviewDate,
            r.supplierReply, r.supplierReplyDate, buyer.fullName AS customerName
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
