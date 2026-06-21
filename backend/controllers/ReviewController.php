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
    $where[] = '(p.productName LIKE :q1 OR r.reviewComment LIKE :q2 OR buyer.fullName LIKE :q3)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
    $params['q3'] = '%' . $search . '%';
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

// Shared: confirm a review is on one of this supplier's products (or 404).
function requireOwnReview(PDO $pdo, string $supplierId, string $reviewId): array {
  $stmt = $pdo->prepare(
    "SELECT r.reviewStatus
       FROM review r
       JOIN product p ON p.productId = r.productId
      WHERE r.reviewId = :id AND p.supplierId = :sid"
  );
  $stmt->execute(['id' => $reviewId, 'sid' => $supplierId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Review not found.']);
  }
  return $row;
}

// PUT /supplier/reviews/{reviewId}/reply — add or edit the supplier's own reply
// (one per review). Body: { reply }. Only on a Published review on the
// supplier's product. The supplier can never touch the customer's review text.
function handleReplyToReview(PDO $pdo, array $auth, string $reviewId): void {
  $supplierId = requireSupplierId($pdo, $auth);
  $body  = getJsonBody();
  $reply = trim($body['reply'] ?? '');
  if ($reply === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Reply cannot be empty.']);
  }
  if (mb_strlen($reply) > 1000) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Reply is too long (max 1000 characters).']);
  }

  $review = requireOwnReview($pdo, $supplierId, $reviewId);
  if ($review['reviewStatus'] !== 'Published') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'Cannot reply to a removed review.']);
  }

  $pdo->prepare('UPDATE review SET supplierReply = :rep, supplierReplyDate = NOW() WHERE reviewId = :id')
      ->execute(['rep' => $reply, 'id' => $reviewId]);
  sendJson(200, true, ['reviewId' => $reviewId, 'supplierReply' => $reply]);
}

// DELETE /supplier/reviews/{reviewId}/reply — remove the supplier's own reply.
function handleDeleteReviewReply(PDO $pdo, array $auth, string $reviewId): void {
  $supplierId = requireSupplierId($pdo, $auth);
  requireOwnReview($pdo, $supplierId, $reviewId);

  $pdo->prepare('UPDATE review SET supplierReply = NULL, supplierReplyDate = NULL WHERE reviewId = :id')
      ->execute(['id' => $reviewId]);
  sendJson(200, true, ['reviewId' => $reviewId, 'deleted' => true]);
}

// ── Customer reviews (create / edit / delete your OWN review) ─────────────────
// Business rule (proposal): a customer may only review a product they have
// actually purchased (an order of theirs, past payment, contains that product).
// One review per customer per product (enforced by a unique key).

const PURCHASED_STATUSES = "'Paid','Processing','Shipped','OutForDelivery','Delivered','Completed'";

function customerHasPurchased(PDO $pdo, string $customerId, string $productId): bool {
  $stmt = $pdo->prepare(
    "SELECT 1
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN `order` o          ON o.orderId = oi.orderId
      WHERE pv.productId = :pid AND o.customerId = :cid
        AND o.orderStatus IN (" . PURCHASED_STATUSES . ")
      LIMIT 1"
  );
  $stmt->execute(['pid' => $productId, 'cid' => $customerId]);
  return (bool) $stmt->fetch();
}

// Validate a rating (1–5) + optional comment, or 400.
function validatedReviewInput(): array {
  $body   = getJsonBody();
  $rating = filter_var($body['ratingScore'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 5]]);
  $comment = trim($body['reviewComment'] ?? '');
  if ($rating === false) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Rating must be a whole number from 1 to 5.']);
  }
  if (mb_strlen($comment) > 1000) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Comment is too long (max 1000 characters).']);
  }
  return [$rating, $comment !== '' ? $comment : null];
}

// POST /products/{productId}/reviews — leave a review for a purchased product.
function handleCreateReview(PDO $pdo, array $auth, string $productId): void {
  $customerId = requireCustomerId($pdo, $auth);
  [$rating, $comment] = validatedReviewInput();

  $p = $pdo->prepare("SELECT 1 FROM product WHERE productId = :id AND productStatus = 'Approved'");
  $p->execute(['id' => $productId]);
  if (!$p->fetch()) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not available.']);
  }

  if (!customerHasPurchased($pdo, $customerId, $productId)) {
    sendJson(403, false, null, ['code' => 'NOT_PURCHASED', 'message' => 'You can only review products you have purchased.']);
  }

  $ex = $pdo->prepare('SELECT 1 FROM review WHERE customerId = :cid AND productId = :pid');
  $ex->execute(['cid' => $customerId, 'pid' => $productId]);
  if ($ex->fetch()) {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'You have already reviewed this product — edit your review instead.']);
  }

  $id = nextId($pdo, 'review', 'reviewId', 'REV');
  $pdo->prepare(
    "INSERT INTO review (reviewId, customerId, productId, ratingScore, reviewComment, reviewDate, reviewStatus)
     VALUES (:id, :cid, :pid, :rating, :comment, NOW(), 'Published')"
  )->execute(['id' => $id, 'cid' => $customerId, 'pid' => $productId, 'rating' => $rating, 'comment' => $comment]);

  sendJson(201, true, ['reviewId' => $id, 'productId' => $productId, 'ratingScore' => $rating, 'reviewComment' => $comment]);
}

// GET /products/{productId}/reviews/mine — the caller's own review for this
// product (or null), plus whether they're eligible to write one (have purchased
// it). Lets the app show "Write a review" vs "Edit / delete your review".
function handleGetMyReview(PDO $pdo, array $auth, string $productId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $stmt = $pdo->prepare(
    "SELECT reviewId, ratingScore, reviewComment, reviewDate, reviewStatus
       FROM review WHERE customerId = :cid AND productId = :pid"
  );
  $stmt->execute(['cid' => $customerId, 'pid' => $productId]);
  $row = $stmt->fetch() ?: null;
  if ($row) { $row['ratingScore'] = (int) $row['ratingScore']; }
  sendJson(200, true, [
    'myReview'  => $row,
    'canReview' => customerHasPurchased($pdo, $customerId, $productId),
  ]);
}

// PUT /reviews/{reviewId} — edit your own review.
function handleUpdateReview(PDO $pdo, array $auth, string $reviewId): void {
  $customerId = requireCustomerId($pdo, $auth);
  [$rating, $comment] = validatedReviewInput();

  $stmt = $pdo->prepare('SELECT 1 FROM review WHERE reviewId = :id AND customerId = :cid');
  $stmt->execute(['id' => $reviewId, 'cid' => $customerId]);
  if (!$stmt->fetch()) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Review not found.']);
  }

  // status is left as-is (an admin-removed review stays removed)
  $pdo->prepare('UPDATE review SET ratingScore = :rating, reviewComment = :comment, reviewDate = NOW() WHERE reviewId = :id')
      ->execute(['rating' => $rating, 'comment' => $comment, 'id' => $reviewId]);

  sendJson(200, true, ['reviewId' => $reviewId, 'ratingScore' => $rating, 'reviewComment' => $comment]);
}

// DELETE /reviews/{reviewId} — delete your own review (its supplier reply, being
// on the same row, goes with it — no orphan).
function handleDeleteReview(PDO $pdo, array $auth, string $reviewId): void {
  $customerId = requireCustomerId($pdo, $auth);
  $del = $pdo->prepare('DELETE FROM review WHERE reviewId = :id AND customerId = :cid');
  $del->execute(['id' => $reviewId, 'cid' => $customerId]);
  if ($del->rowCount() === 0) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Review not found.']);
  }
  sendJson(200, true, ['reviewId' => $reviewId, 'deleted' => true]);
}
