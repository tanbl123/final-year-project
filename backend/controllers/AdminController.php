<?php
// Admin-only endpoints. For now: the supplier approval queue.

// GET /admin/suppliers/pending — list supplier accounts awaiting approval.
// Includes the business-verification fields + document URL so the admin can
// actually review the application before approving or rejecting it.
function handleListPendingSuppliers(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT u.userId, s.supplierId, s.companyName, s.companyAddress, s.operationalAddress,
            s.businessRegNo, s.businessLicenseUrl, s.taxNumber,
            u.username, u.email, u.phoneNumber, u.created_at
       FROM `user` u
       JOIN supplier s ON s.userId = u.userId
      WHERE u.role = 'Supplier' AND u.status = 'Pending'
      ORDER BY u.created_at ASC"
  );
  sendJson(200, true, ['suppliers' => $stmt->fetchAll()]);
}

// Shared: move a currently-Pending supplier to a new status. Optionally records
// a rejection reason (shown to the supplier) — passing null clears any old one.
function setSupplierStatus(PDO $pdo, string $userId, string $newStatus, ?string $reason = null): void {
  $stmt = $pdo->prepare("SELECT status, role FROM `user` WHERE userId = :id");
  $stmt->execute(['id' => $userId]);
  $row = $stmt->fetch();

  if (!$row || $row['role'] !== 'Supplier') {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Supplier not found.']);
  }
  // guard against double-reviewing (e.g. two admins, or a stale page)
  if ($row['status'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This account has already been reviewed.']);
  }

  $upd = $pdo->prepare("UPDATE `user` SET status = :s, rejectionReason = :r WHERE userId = :id");
  $upd->execute(['s' => $newStatus, 'r' => $reason, 'id' => $userId]);

  sendJson(200, true, ['userId' => $userId, 'status' => $newStatus]);
}

// POST /admin/suppliers/{userId}/approve — clears any past rejection reason.
function handleApproveSupplier(PDO $pdo, string $userId): void {
  setSupplierStatus($pdo, $userId, 'Active', null);
}

// POST /admin/suppliers/{userId}/reject — body: { reason, terminal? }.
// terminal=true bans the applicant permanently; otherwise they may fix the
// stated reason and resubmit. A reason is required so the supplier knows why.
function handleRejectSupplier(PDO $pdo, string $userId): void {
  $body     = getJsonBody();
  $reason   = trim($body['reason'] ?? '');
  $terminal = !empty($body['terminal']);

  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A rejection reason is required.']);
  }
  if (mb_strlen($reason) > 255) {
    $reason = mb_substr($reason, 0, 255);
  }
  setSupplierStatus($pdo, $userId, $terminal ? 'Banned' : 'Rejected', $reason);
}

// ── Courier (delivery personnel) approvals ───────────────────────────
// Same self-apply → admin-approve flow as suppliers, for DeliveryPersonnel.

// GET /admin/couriers/pending — list courier accounts awaiting approval.
function handleListPendingCouriers(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT u.userId, d.deliveryPersonnelId, d.vehicleType, d.vehicleBrand, d.vehicleModel, d.vehiclePlate,
            d.licenseNumber, d.licensePhotoUrl, d.icNumber, d.icPhotoUrl,
            u.username, u.email, u.fullName, u.phoneNumber, u.avatarUrl, u.created_at
       FROM `user` u
       JOIN delivery_personnel d ON d.userId = u.userId
      WHERE u.role = 'DeliveryPersonnel' AND u.status = 'Pending'
      ORDER BY u.created_at ASC"
  );
  sendJson(200, true, ['couriers' => $stmt->fetchAll()]);
}

// Shared: move a currently-Pending courier to a new status. Optionally records a
// rejection reason (shown to the courier at login) — passing null clears it.
function setCourierStatus(PDO $pdo, string $userId, string $newStatus, ?string $reason = null): void {
  $stmt = $pdo->prepare("SELECT status, role FROM `user` WHERE userId = :id");
  $stmt->execute(['id' => $userId]);
  $row = $stmt->fetch();

  if (!$row || $row['role'] !== 'DeliveryPersonnel') {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Courier not found.']);
  }
  if ($row['status'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This account has already been reviewed.']);
  }

  $upd = $pdo->prepare("UPDATE `user` SET status = :s, rejectionReason = :r WHERE userId = :id");
  $upd->execute(['s' => $newStatus, 'r' => $reason, 'id' => $userId]);

  sendJson(200, true, ['userId' => $userId, 'status' => $newStatus]);
}

// POST /admin/couriers/{userId}/approve — clears any past rejection reason.
function handleApproveCourier(PDO $pdo, string $userId): void {
  setCourierStatus($pdo, $userId, 'Active', null);
}

// POST /admin/couriers/{userId}/reject — body: { reason, terminal? }.
// terminal=true bans the applicant permanently; otherwise they're Rejected and
// see the reason at login. A reason is required so the courier knows why.
function handleRejectCourier(PDO $pdo, string $userId): void {
  $body     = getJsonBody();
  $reason   = trim($body['reason'] ?? '');
  $terminal = !empty($body['terminal']);

  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A rejection reason is required.']);
  }
  if (mb_strlen($reason) > 255) {
    $reason = mb_substr($reason, 0, 255);
  }
  setCourierStatus($pdo, $userId, $terminal ? 'Banned' : 'Rejected', $reason);
}

// ── Product approvals ────────────────────────────────────────────────

// GET /admin/products/pending — list products awaiting approval.
function handleListPendingProducts(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT p.productId, p.productName, p.productBrand, p.productPrice,
            p.productDescription, c.categoryName, s.companyName, p.created_at
       FROM product p
       JOIN supplier s ON s.supplierId = p.supplierId
       JOIN category c ON c.categoryId = p.categoryId
      WHERE p.productStatus = 'Pending'
      ORDER BY p.created_at ASC"
  );
  $rows = $stmt->fetchAll();
  foreach ($rows as &$r) { $r['productPrice'] = (float) $r['productPrice']; }
  sendJson(200, true, ['products' => $rows]);
}

// Shared: move a currently-Pending product to a new status (Approved/Rejected).
function setProductStatus(PDO $pdo, string $productId, string $newStatus): void {
  $stmt = $pdo->prepare("SELECT productStatus FROM product WHERE productId = :id");
  $stmt->execute(['id' => $productId]);
  $row = $stmt->fetch();

  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Product not found.']);
  }
  if ($row['productStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This product has already been reviewed.']);
  }

  $upd = $pdo->prepare("UPDATE product SET productStatus = :s WHERE productId = :id");
  $upd->execute(['s' => $newStatus, 'id' => $productId]);

  sendJson(200, true, ['productId' => $productId, 'status' => $newStatus]);
}

// POST /admin/products/{productId}/approve
function handleApproveProduct(PDO $pdo, string $productId): void {
  setProductStatus($pdo, $productId, 'Approved');
}

// POST /admin/products/{productId}/reject
function handleRejectProduct(PDO $pdo, string $productId): void {
  setProductStatus($pdo, $productId, 'Rejected');
}

// ── User management ──────────────────────────────────────────────────

// GET /admin/users — list/filter all users (?role=, ?status=, ?search=).
function handleListUsers(PDO $pdo): void {
  $role   = $_GET['role']   ?? '';
  $status = $_GET['status'] ?? '';
  $search = trim($_GET['search'] ?? '');

  $allowedRoles    = ['Admin', 'Supplier', 'Customer', 'DeliveryPersonnel'];
  $allowedStatuses = ['Pending', 'Active', 'Rejected', 'Suspended', 'Deleted'];

  $where = [];
  $params = [];
  if ($role !== '' && in_array($role, $allowedRoles, true)) {
    $where[] = 'role = :role'; $params['role'] = $role;
  }
  if ($status !== '' && in_array($status, $allowedStatuses, true)) {
    $where[] = 'status = :status'; $params['status'] = $status;
  }
  if ($search !== '') {
    $where[] = '(fullName LIKE :q1 OR username LIKE :q2 OR email LIKE :q3)';
    $params['q1'] = '%' . $search . '%';
    $params['q2'] = '%' . $search . '%';
    $params['q3'] = '%' . $search . '%';
  }

  $sql = 'SELECT userId, username, fullName, email, phoneNumber, role, status, created_at FROM `user`';
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' ORDER BY created_at DESC';

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  sendJson(200, true, ['users' => $stmt->fetchAll()]);
}

// GET /admin/users/{userId} — one user with their role-specific profile.
function handleGetUser(PDO $pdo, string $userId): void {
  $stmt = $pdo->prepare(
    'SELECT userId, username, fullName, email, phoneNumber, role, status, created_at, updated_at
       FROM `user` WHERE userId = :id'
  );
  $stmt->execute(['id' => $userId]);
  $u = $stmt->fetch();
  if (!$u) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'User not found.']);
  }

  $profile = null;
  if ($u['role'] === 'Supplier') {
    $p = $pdo->prepare('SELECT supplierId, companyName, companyAddress, operationalAddress FROM supplier WHERE userId = :id');
  } elseif ($u['role'] === 'Customer') {
    $p = $pdo->prepare('SELECT customerId, shippingAddress FROM customer WHERE userId = :id');
  } elseif ($u['role'] === 'DeliveryPersonnel') {
    $p = $pdo->prepare('SELECT deliveryPersonnelId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate FROM delivery_personnel WHERE userId = :id');
  } else {
    $p = null;
  }
  if ($p) { $p->execute(['id' => $userId]); $profile = $p->fetch() ?: null; }
  $u['profile'] = $profile;

  sendJson(200, true, $u);
}

// PATCH /admin/users/{userId}/status — change a user's status. Body: { status }.
function handleSetUserStatus(PDO $pdo, array $auth, string $userId): void {
  $body   = getJsonBody();
  $status = trim($body['status'] ?? '');
  $allowed = ['Active', 'Suspended', 'Rejected', 'Deleted'];
  if (!in_array($status, $allowed, true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Invalid status.']);
  }
  // safety: an admin can't lock themselves out or touch other admins here
  if (($auth['userId'] ?? '') === $userId) {
    sendJson(409, false, null, ['code' => 'SELF', 'message' => 'You cannot change your own account status.']);
  }

  $stmt = $pdo->prepare('SELECT role FROM `user` WHERE userId = :id');
  $stmt->execute(['id' => $userId]);
  $target = $stmt->fetch();
  if (!$target) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'User not found.']);
  }
  if ($target['role'] === 'Admin') {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'Admin accounts cannot be changed here.']);
  }

  $upd = $pdo->prepare('UPDATE `user` SET status = :s WHERE userId = :id');
  $upd->execute(['s' => $status, 'id' => $userId]);
  sendJson(200, true, ['userId' => $userId, 'status' => $status]);
}

// ── supplier business-detail change requests ─────────────────────────
// GET /admin/supplier-changes — pending change requests with the current
// (live) values alongside the proposed ones, so the admin can see the diff.
function handleListChangeRequests(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT r.requestId, r.created_at,
            r.companyName AS newCompanyName, r.companyAddress AS newCompanyAddress,
            r.businessRegNo AS newBusinessRegNo,
            r.taxNumber AS newTaxNumber, r.businessLicenseUrl AS newBusinessLicenseUrl,
            s.supplierId, u.email, u.username,
            s.companyName AS curCompanyName, s.companyAddress AS curCompanyAddress,
            s.businessRegNo AS curBusinessRegNo,
            s.taxNumber AS curTaxNumber, s.businessLicenseUrl AS curBusinessLicenseUrl
       FROM supplier_change_request r
       JOIN supplier s ON s.supplierId = r.supplierId
       JOIN `user` u   ON u.userId = s.userId
      WHERE r.requestStatus = 'Pending'
      ORDER BY r.created_at ASC"
  );
  sendJson(200, true, ['requests' => $stmt->fetchAll()]);
}

// Load a still-Pending change request, or 404/409. Returns the request row.
function loadPendingChangeRequest(PDO $pdo, string $requestId): array {
  $stmt = $pdo->prepare('SELECT * FROM supplier_change_request WHERE requestId = :id');
  $stmt->execute(['id' => $requestId]);
  $req = $stmt->fetch();
  if (!$req) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Change request not found.']);
  }
  if ($req['requestStatus'] !== 'Pending') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This request has already been reviewed.']);
  }
  return $req;
}

// POST /admin/supplier-changes/{requestId}/approve — copy the proposed values
// onto the live supplier row (and mirror the company name onto user.fullName).
function handleApproveChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req = loadPendingChangeRequest($pdo, $requestId);

  $pdo->beginTransaction();
  try {
    $pdo->prepare(
      'UPDATE supplier
          SET companyName = :cn, companyAddress = :ca, businessRegNo = :brn,
              taxNumber = :tax, businessLicenseUrl = :blu
        WHERE supplierId = :sid'
    )->execute([
      'cn' => $req['companyName'], 'ca' => $req['companyAddress'], 'brn' => $req['businessRegNo'],
      'tax' => $req['taxNumber'], 'blu' => $req['businessLicenseUrl'],
      'sid' => $req['supplierId'],
    ]);

    // the supplier's display name mirrors the company name (as at registration)
    $pdo->prepare(
      'UPDATE `user` u
         JOIN supplier s ON s.userId = u.userId
          SET u.fullName = :cn
        WHERE s.supplierId = :sid'
    )->execute(['cn' => $req['companyName'], 'sid' => $req['supplierId']]);

    $pdo->prepare(
      "UPDATE supplier_change_request
          SET requestStatus = 'Approved', reviewedBy = :by, reviewed_at = NOW()
        WHERE requestId = :id"
    )->execute(['by' => $auth['userId'], 'id' => $requestId]);

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not apply the change. Please try again.']);
  }

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Approved']);
}

// POST /admin/supplier-changes/{requestId}/reject — body: { reason }.
// Leaves the live supplier row untouched; the supplier sees the reason.
function handleRejectChangeRequest(PDO $pdo, array $auth, string $requestId): void {
  $req    = loadPendingChangeRequest($pdo, $requestId);
  $body   = getJsonBody();
  $reason = trim($body['reason'] ?? '');
  if ($reason === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'A reason is required so the supplier knows what to fix.']);
  }
  if (mb_strlen($reason) > 255) { $reason = mb_substr($reason, 0, 255); }

  $pdo->prepare(
    "UPDATE supplier_change_request
        SET requestStatus = 'Rejected', reviewNote = :rn, reviewedBy = :by, reviewed_at = NOW()
      WHERE requestId = :id"
  )->execute(['rn' => $reason, 'by' => $auth['userId'], 'id' => $requestId]);

  sendJson(200, true, ['requestId' => $requestId, 'status' => 'Rejected']);
}

// GET /admin/badge-counts — one cheap call powering the sidebar work-queue
// badges: how many items in each queue are waiting for the admin to act. The
// web app polls this periodically so the admin sees pending work at a glance.
function adminBadgeCounts(PDO $pdo): array {
  $counts = [
    // Main / Moderation approval queues
    'suppliers'  => "SELECT COUNT(*) FROM `user` WHERE role = 'Supplier' AND status = 'Pending'",
    'couriers'   => "SELECT COUNT(*) FROM `user` WHERE role = 'DeliveryPersonnel' AND status = 'Pending'",
    'changes'    => "SELECT COUNT(*) FROM supplier_change_request WHERE requestStatus = 'Pending'",
    'products'   => "SELECT COUNT(*) FROM product WHERE productStatus = 'Pending'",
    // Operations queues
    'deliveries' => "SELECT COUNT(*) FROM delivery WHERE deliveryPersonnelId IS NULL",
    'issues'     => "SELECT COUNT(*) FROM delivery_issue WHERE issueStatus = 'Open'",
    'refunds'    => "SELECT COUNT(*) FROM refund WHERE refundStatus = 'Pending'",
  ];
  $out = [];
  foreach ($counts as $key => $sql) {
    $out[$key] = (int) $pdo->query($sql)->fetchColumn();
  }
  return $out;
}

function handleAdminBadgeCounts(PDO $pdo): void {
  sendJson(200, true, ['counts' => adminBadgeCounts($pdo)]);
}
