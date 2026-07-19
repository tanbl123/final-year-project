<?php
// Recommendation endpoints. These PROXY to the Python Flask ML service
// (weighted-hybrid SVD + TF-IDF — see ml-service/), which returns ranked
// productIds; here we enrich those into full product cards (same shape as the
// catalog) so the app can render them directly.
//
// Graceful fallback: if the ML service isn't configured or is unreachable, we
// fall back to a simple SQL query (same-category for "similar", best-sellers
// for "trending"/"for-you") so the app NEVER breaks in a demo.

// Card SELECT shared with the catalog, so recommendations render identically.
function recCardSelect(): string {
  return
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
       JOIN category c ON c.categoryId = p.categoryId ";
}

// Normalize the numeric/boolean fields on a card row (matches the catalog).
function recCastCard(array $r): array {
  $r['price']              = (float) $r['price'];
  $r['virtualTryOnEnable'] = (bool) $r['virtualTryOnEnable'];
  $r['ratingAverage']      = $r['ratingAverage'] !== null ? (float) $r['ratingAverage'] : 0;
  $r['ratingCount']        = (int) $r['ratingCount'];
  return $r;
}

// Turn a ranked list of productIds into product cards, PRESERVING that order
// and dropping any that aren't Approved (or no longer exist).
function recCardsForIds(PDO $pdo, array $ids): array {
  $ids = array_values(array_filter(array_map('strval', $ids), fn($x) => $x !== ''));
  if (!$ids) { return []; }
  $place = implode(',', array_fill(0, count($ids), '?'));
  $stmt = $pdo->prepare(recCardSelect() . " WHERE p.productStatus = 'Approved' AND p.productId IN ($place)");
  $stmt->execute($ids);
  $byId = [];
  foreach ($stmt->fetchAll() as $row) { $byId[$row['id']] = recCastCard($row); }
  $out = [];
  foreach ($ids as $id) { if (isset($byId[$id])) { $out[] = $byId[$id]; } }  // keep ML ranking
  return $out;
}

// Call the ML service; returns the ranked items array, or null if unavailable.
function recMlItems(array $config, string $path): ?array {
  $base = trim($config['ml_service_url'] ?? '');
  if ($base === '') { return null; }
  $ch = curl_init(rtrim($base, '/') . $path);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 4,
    CURLOPT_CONNECTTIMEOUT => 2,
  ]);
  $res  = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($res === false || $code < 200 || $code >= 300) { return null; }
  $data = json_decode($res, true);
  if (!is_array($data) || !isset($data['items']) || !is_array($data['items'])) { return null; }
  return array_column($data['items'], 'productId');
}

// ── fallbacks (used when the ML service is offline) ──────────────────────────

// Best-sellers by units sold; if there are no sales yet, newest approved.
function recTrendingFallback(PDO $pdo, int $k): array {
  // 1) real best-sellers by units sold (paid+ orders only; excludes cancelled).
  $ids = $pdo->query(
    "SELECT p.productId
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
       JOIN `order` o          ON o.orderId = oi.orderId
      WHERE o.orderStatus IN ('Paid','Processing','Shipped','OutForDelivery','Delivered','Completed')
        AND p.productStatus = 'Approved'
      GROUP BY p.productId
      ORDER BY SUM(oi.orderQuantity) DESC
      LIMIT " . (int) $k
  )->fetchAll(PDO::FETCH_COLUMN);

  // 2) cold-start backfill: at launch there may be few/zero sales, which would
  //    leave the "Trending now" rail with 0–1 cards. Top it up with the newest
  //    approved products (not already listed) so it's never sparse. Pure ranking
  //    logic — no ML.
  if (count($ids) < $k) {
    $extra = $pdo->query(
      "SELECT productId FROM product WHERE productStatus = 'Approved'
        ORDER BY created_at DESC LIMIT " . (int) ($k * 3)
    )->fetchAll(PDO::FETCH_COLUMN);
    foreach ($extra as $pid) {
      if (count($ids) >= $k) break;
      if (!in_array($pid, $ids, true)) { $ids[] = $pid; }
    }
  }
  return recCardsForIds($pdo, $ids);
}

// Same-category products (excluding the item itself), best-rated first.
function recSimilarFallback(PDO $pdo, string $productId, int $k): array {
  $c = $pdo->prepare('SELECT categoryId FROM product WHERE productId = :id');
  $c->execute(['id' => $productId]);
  $categoryId = $c->fetchColumn();
  if (!$categoryId) { return []; }
  $stmt = $pdo->prepare(
    recCardSelect() .
    " WHERE p.productStatus = 'Approved' AND p.categoryId = :cat AND p.productId <> :id
      ORDER BY ratingAverage DESC, ratingCount DESC
      LIMIT " . (int) $k
  );
  $stmt->execute(['cat' => $categoryId, 'id' => $productId]);
  return array_map('recCastCard', $stmt->fetchAll());
}

// ── endpoints ────────────────────────────────────────────────────────────────

// GET /products/{id}/similar — "You may also like" (content-based).
function handleSimilarProducts(PDO $pdo, array $config, string $productId): void {
  $ids   = recMlItems($config, '/recommend/similar?productId=' . urlencode($productId) . '&k=10');
  $cards = $ids !== null ? recCardsForIds($pdo, $ids) : [];
  if (!$cards) { $cards = recSimilarFallback($pdo, $productId, 10); }
  sendJson(200, true, ['items' => $cards]);
}

// GET /recommendations/for-you — personalized weighted hybrid (customer only).
function handleRecommendedForYou(PDO $pdo, array $config, array $auth): void {
  $customerId = requireCustomerId($pdo, $auth);
  $ids   = recMlItems($config, '/recommend/for-you?customerId=' . urlencode($customerId) . '&k=10');
  $cards = $ids !== null ? recCardsForIds($pdo, $ids) : [];
  if (!$cards) { $cards = recTrendingFallback($pdo, 10); }
  sendJson(200, true, ['items' => $cards]);
}

// GET /recommendations/trending — best-sellers (public).
function handleTrendingProducts(PDO $pdo, array $config): void {
  $ids   = recMlItems($config, '/recommend/trending?k=10');
  $cards = $ids !== null ? recCardsForIds($pdo, $ids) : [];
  if (!$cards) { $cards = recTrendingFallback($pdo, 10); }
  sendJson(200, true, ['items' => $cards]);
}
