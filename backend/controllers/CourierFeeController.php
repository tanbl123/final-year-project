<?php
// In-house courier fee configuration (Admin web). The platform pays its in-house
// delivery personnel a flat fee per completed parcel, and recovers the same
// amount from the supplier. Admins set that fee here; changing it keeps the old
// value as history (status Inactive) so past changes are auditable — mirroring
// the commission-rate configuration.

// The active in-house courier fee (RM per delivery). Falls back to the config
// default (COURIER_FEE_PER_DELIVERY) when no fee has been set in the DB yet, so
// fresh installs keep working without a seed row.
function activeCourierFee(PDO $pdo, array $config = []): float {
  $stmt = $pdo->query(
    "SELECT feeValue FROM courier_fee
      WHERE feeStatus = 'Active' AND effectiveDate <= NOW()
      ORDER BY effectiveDate DESC LIMIT 1"
  );
  $fee = $stmt->fetchColumn();
  if ($fee !== false) { return (float) $fee; }
  return (float) ($config['courier_fee_per_delivery'] ?? 0);
}

// GET /admin/courier-fee — the current active fee + the full change history.
function handleGetCourierFee(PDO $pdo, array $config = []): void {
  $current = $pdo->query(
    "SELECT courierFeeId, feeValue, effectiveDate, feeStatus
       FROM courier_fee
      WHERE feeStatus = 'Active' AND effectiveDate <= NOW()
      ORDER BY effectiveDate DESC
      LIMIT 1"
  )->fetch();
  if ($current) { $current['feeValue'] = (float) $current['feeValue']; }

  $history = $pdo->query(
    "SELECT cf.courierFeeId, cf.feeValue, cf.effectiveDate, cf.feeStatus,
            u.fullName AS setBy
       FROM courier_fee cf
       LEFT JOIN admin a   ON a.adminId = cf.adminId
       LEFT JOIN `user` u  ON u.userId = a.userId
      ORDER BY cf.effectiveDate DESC, cf.courierFeeId DESC"
  )->fetchAll();
  foreach ($history as &$h) { $h['feeValue'] = (float) $h['feeValue']; }
  unset($h);

  // when no fee row exists yet, surface the config default as the effective fee
  sendJson(200, true, [
    'current'  => $current ?: null,
    'default'  => (float) ($config['courier_fee_per_delivery'] ?? 0),
    'active'   => activeCourierFee($pdo, $config),
    'history'  => $history,
  ]);
}

// POST /admin/courier-fee — set a new active fee. Body: { feeValue }.
// Deactivates the previous active fee and inserts the new one (effective now),
// all in one transaction.
function handleSetCourierFee(PDO $pdo, array $auth): void {
  $body = getJsonBody();
  $fee  = $body['feeValue'] ?? null;
  if (!is_numeric($fee) || (float) $fee < 0 || (float) $fee > 1000) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Fee must be a number between 0 and 1000.']);
  }
  $fee = round((float) $fee, 2);

  // the admin making the change (courier_fee.adminId references admin)
  $stmt = $pdo->prepare('SELECT adminId FROM admin WHERE userId = :uid');
  $stmt->execute(['uid' => $auth['userId']]);
  $adminId = $stmt->fetchColumn();
  if (!$adminId) {
    sendJson(403, false, null, ['code' => 'FORBIDDEN', 'message' => 'No admin profile for this user.']);
  }

  try {
    $pdo->beginTransaction();
    $pdo->exec("UPDATE courier_fee SET feeStatus = 'Inactive' WHERE feeStatus = 'Active'");

    $id = nextId($pdo, 'courier_fee', 'courierFeeId', 'CFE');
    $pdo->prepare(
      "INSERT INTO courier_fee (courierFeeId, adminId, feeValue, effectiveDate, feeStatus)
       VALUES (:id, :aid, :fee, NOW(), 'Active')"
    )->execute(['id' => $id, 'aid' => $adminId, 'fee' => $fee]);

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    sendJson(500, false, null, ['code' => 'DB_ERROR', 'message' => 'Could not update the courier fee.']);
  }

  sendJson(201, true, ['courierFeeId' => $id, 'feeValue' => $fee]);
}
