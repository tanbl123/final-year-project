<?php
// Review & rating endpoints for the web portals.
//   - Supplier: view (read-only) reviews on their own products.
//   - Admin: view all reviews and moderate (remove / restore) them.
// Reviews are created by customers in the mobile app (not here).

// GET /admin/reviews — all reviews. Filters: ?status= ?rating= ?search=.
function handleListAdminReviews(PDO $pdo): void {
  $status = trim($_GET['status'] ?? '');
  $rating = trim($_GET['rating'] ?? '');
  $search = trim($_GET['search'] ?? '');

  $where  = [];
  $params = [];
  if (in_array($status, ['Published', 'Removed'], true)) {
    $where[] = 'r.reviewStatus = :st'; $params['st'] = $status;
  }
  if (ctype_digit($rating) && (int) $rating >= 1 && (int) $rating <= 5) {
    $where[] = 'r.ratingScore = :rt'; $params['rt'] = (int) $rating;
  }
  if ($search !== '') {
    $where[] = '(p.productName LIKE :q OR r.reviewComment LIKE :q OR buyer.fullName LIKE :q)';
    $params['q'] = '%' . $search . '%';
  }

  $sql =
    "SELECT r.reviewId, r.productId, p.productName, s.companyName AS supplierName,
            r.ratingScore, r.reviewComment, r.reviewDate, r.reviewStatus,
            buyer.fullName AS customerName
       FROM review r
       JOIN product p    ON p.productId = r.productId
       JOIN supplier s   ON s.supplierId = p.supplierId
       JOIN customer c   ON c.customerId = r.customerId
       JOIN `user` buyer ON buyer.userId = c.userId";
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' ORDER BY r.reviewDate DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['ratingScore'] = (int) $r['ratingScore']; }
  unset($r);
  sendJson(200, true, ['reviews' => $rows]);
}

// PATCH /admin/reviews/{reviewId}/status — moderate. Body: { status }.
// 'Removed' hides an inappropriate review; 'Published' restores it.
function handleSetReviewStatus(PDO $pdo, string $reviewId): void {
  $body   = getJsonBody();
  $status = trim($body['status'] ?? '');
  if (!in_array($status, ['Published', 'Removed'], true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid status.']);
  }

  $stmt = $pdo->prepare('SELECT reviewStatus FROM review WHERE reviewId = :id');
  $stmt->execute(['id' => $reviewId]);
  if (!$stmt->fetch()) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Review not found.']);
  }

  $pdo->prepare('UPDATE review SET reviewStatus = :s WHERE reviewId = :id')
      ->execute(['s' => $status, 'id' => $reviewId]);
  sendJson(200, true, ['reviewId' => $reviewId, 'status' => $status]);
}
