<?php
// ─────────────────────────────────────────────────────────────────────────
// Delivery DISPATCH — auto-assign a courier to a paid order.
//
// Design note (for the report): real platforms (DoorDash, Uber, Grab) treat
// dispatch as a SCORING problem — every candidate courier is scored against
// the order and the best one wins. We follow that exact pattern. Today the
// score weights only the courier's current LOAD (fewest in-progress jobs);
// the function is structured so geographic/ETA, vehicle-type and rating terms
// can be added later as extra weighted terms — without changing the callers.
//
// The production extension would also replace this greedy, one-order-at-a-time
// pick with a batched min-cost assignment across many orders and couriers at
// once. That is identified as future work, not implemented here.
// ─────────────────────────────────────────────────────────────────────────

// Delivery states that still count as "in progress" (occupy a courier).
const DELIVERY_ACTIVE_STATES = ['Assigned', 'PickedUp', 'OutForDelivery'];

// Score a single courier candidate. LOWER score = BETTER candidate.
// Only the load term is live today; the commented terms show how a production
// score would extend (the weights would be tuned, and the inputs supplied by
// scoreCouriers()).
function scoreCourier(array $c): float {
  $W_LOAD = 1.0;                       // weight for current workload
  $score  = $W_LOAD * $c['activeLoad'];

  // Future terms (kept here to document the intended extension):
  //   $W_ETA    = 0.5;  $score += $W_ETA    * $c['etaMinutes'];      // proximity/ETA to pickup
  //   $W_RATING = 2.0;  $score += $W_RATING * (5.0 - $c['rating']);  // prefer higher-rated
  //   $W_VEHICLE...                                                  // vehicle suits order size

  return $score;
}

// Rank every Active courier best-first. Each row carries the inputs the score
// is built from, so the admin UI can show *why* a courier was chosen (its load).
function scoreCouriers(PDO $pdo): array {
  $rows = $pdo->query(
    "SELECT dp.deliveryPersonnelId,
            u.fullName,
            u.userId,
            dp.vehicleType, dp.vehicleBrand, dp.vehicleModel, dp.vehiclePlate,
            COUNT(d.deliveryId) AS activeLoad
       FROM delivery_personnel dp
       JOIN `user` u
         ON u.userId = dp.userId AND u.status = 'Active'
       LEFT JOIN delivery d
         ON d.deliveryPersonnelId = dp.deliveryPersonnelId
        AND d.deliveryStatus IN ('Assigned', 'PickedUp', 'OutForDelivery')
      GROUP BY dp.deliveryPersonnelId, u.fullName, u.userId, dp.vehicleType, dp.vehicleBrand, dp.vehicleModel, dp.vehiclePlate"
  )->fetchAll();

  foreach ($rows as &$r) {
    $r['activeLoad'] = (int) $r['activeLoad'];
    $r['score']      = scoreCourier($r);
  }
  unset($r);

  // Best score first; deliveryPersonnelId as a stable tie-breaker so the pick
  // is deterministic when several couriers are equally idle.
  usort($rows, function ($a, $b) {
    return ($a['score'] <=> $b['score'])
        ?: strcmp($a['deliveryPersonnelId'], $b['deliveryPersonnelId']);
  });

  return $rows;
}

// Dispatch a whole (paid) order: an order can contain items from several
// suppliers, and each supplier's items ship as an INDEPENDENT parcel — exactly
// how Shopee/Lazada/Amazon handle multi-seller orders. So we create one delivery
// per distinct supplier in the order and auto-assign each one separately.
// Courier load is re-scored between picks (uncommitted assignments in the same
// transaction are visible), so two parcels don't both pile onto one courier.
//
// Returns an array of per-supplier dispatch results (see assignDelivery()).
// Safe to call more than once: existing deliveries are left as-is.
function dispatchOrder(PDO $pdo, string $orderId): array {
  $stmt = $pdo->prepare(
    "SELECT DISTINCT p.supplierId
       FROM order_item oi
       JOIN product_variant pv ON pv.productVariantId = oi.productVariantId
       JOIN product p          ON p.productId = pv.productId
      WHERE oi.orderId = :o
      ORDER BY p.supplierId"
  );
  $stmt->execute(['o' => $orderId]);
  $supplierIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

  $results = [];
  foreach ($supplierIds as $supplierId) {
    $results[] = assignDelivery($pdo, $orderId, $supplierId);
  }
  return $results;
}

// Ensure a delivery row exists for one (order, supplier) parcel and auto-assign
// the best available courier. If NO courier is available the delivery is left
// Pending + unassigned, which surfaces it in the admin "needs assignment" queue
// for a manual pick. Safe to call more than once: an already-assigned delivery
// is left untouched.
//
// Returns: ['deliveryId', 'orderId', 'supplierId', 'deliveryPersonnelId'|null,
//           'deliveryStatus', 'auto'].
function assignDelivery(PDO $pdo, string $orderId, string $supplierId): array {
  // Already have a delivery for this (order, supplier) parcel?
  $stmt = $pdo->prepare(
    "SELECT deliveryId, deliveryPersonnelId, deliveryStatus
       FROM delivery WHERE orderId = :o AND supplierId = :s"
  );
  $stmt->execute(['o' => $orderId, 's' => $supplierId]);
  $existing = $stmt->fetch();

  $candidates = scoreCouriers($pdo);
  $best       = $candidates[0] ?? null;     // best-scoring Active courier, or none

  if ($existing) {
    // Only fill in a courier if it's still unassigned; never override a human's
    // manual choice or an in-progress assignment.
    if ($existing['deliveryPersonnelId'] === null && $best) {
      $pdo->prepare(
        "UPDATE delivery
            SET deliveryPersonnelId = :dp, deliveryStatus = 'Assigned'
          WHERE deliveryId = :id"
      )->execute(['dp' => $best['deliveryPersonnelId'], 'id' => $existing['deliveryId']]);

      return [
        'deliveryId'          => $existing['deliveryId'],
        'orderId'             => $orderId,
        'supplierId'          => $supplierId,
        'deliveryPersonnelId' => $best['deliveryPersonnelId'],
        'deliveryStatus'      => 'Assigned',
        'auto'                => true,
      ];
    }
    return [
      'deliveryId'          => $existing['deliveryId'],
      'orderId'             => $orderId,
      'supplierId'          => $supplierId,
      'deliveryPersonnelId' => $existing['deliveryPersonnelId'],
      'deliveryStatus'      => $existing['deliveryStatus'],
      'auto'                => false,
    ];
  }

  $deliveryId = nextId($pdo, 'delivery', 'deliveryId', 'DLV');

  if ($best) {
    $pdo->prepare(
      "INSERT INTO delivery (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryStatus)
       VALUES (:id, :o, :s, :dp, 'Assigned')"
    )->execute(['id' => $deliveryId, 'o' => $orderId, 's' => $supplierId, 'dp' => $best['deliveryPersonnelId']]);

    return [
      'deliveryId'          => $deliveryId,
      'orderId'             => $orderId,
      'supplierId'          => $supplierId,
      'deliveryPersonnelId' => $best['deliveryPersonnelId'],
      'deliveryStatus'      => 'Assigned',
      'auto'                => true,
    ];
  }

  // No courier available → queue it for the admin to assign by hand.
  $pdo->prepare(
    "INSERT INTO delivery (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryStatus)
     VALUES (:id, :o, :s, NULL, 'Pending')"
  )->execute(['id' => $deliveryId, 'o' => $orderId, 's' => $supplierId]);

  return [
    'deliveryId'          => $deliveryId,
    'orderId'             => $orderId,
    'supplierId'          => $supplierId,
    'deliveryPersonnelId' => null,
    'deliveryStatus'      => 'Pending',
    'auto'                => false,
  ];
}

// Recompute an order's status from ALL its parcel deliveries and persist it.
// With split fulfilment an order has several deliveries, so the order-level
// status is a rollup of the LEAST-progressed parcel:
//   * every parcel Delivered      → order Delivered
//   * any parcel OutForDelivery    → order OutForDelivery
//   * any parcel PickedUp          → order Shipped
//   * otherwise                    → left unchanged (still Paid/Processing)
// Mirrors the single-delivery milestones the courier flow used before the split.
function recomputeOrderStatus(PDO $pdo, string $orderId): void {
  $stmt = $pdo->prepare('SELECT deliveryStatus FROM delivery WHERE orderId = :o');
  $stmt->execute(['o' => $orderId]);
  $statuses = $stmt->fetchAll(PDO::FETCH_COLUMN);
  if (!$statuses) { return; }

  $allDelivered = true;
  $anyOut = false;
  $anyPicked = false;
  foreach ($statuses as $s) {
    if ($s !== 'Delivered')        { $allDelivered = false; }
    if ($s === 'OutForDelivery')   { $anyOut = true; }
    if ($s === 'PickedUp')         { $anyPicked = true; }
  }

  $orderStatus = null;
  if ($allDelivered)   { $orderStatus = 'Delivered'; }
  elseif ($anyOut)     { $orderStatus = 'OutForDelivery'; }
  elseif ($anyPicked)  { $orderStatus = 'Shipped'; }

  if ($orderStatus !== null) {
    // read the current status first so we only notify on a real transition
    $cur = $pdo->prepare('SELECT orderStatus FROM `order` WHERE orderId = :oid');
    $cur->execute(['oid' => $orderId]);
    $previous = $cur->fetchColumn();

    $pdo->prepare('UPDATE `order` SET orderStatus = :os WHERE orderId = :oid')
        ->execute(['os' => $orderStatus, 'oid' => $orderId]);

    if ($previous !== $orderStatus && function_exists('notifyOrderStatusChange')) {
      notifyOrderStatusChange($pdo, $orderId, $orderStatus);
    }
  }
}
