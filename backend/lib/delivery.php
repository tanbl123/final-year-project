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
//
// [state] is the order's delivery state. When given, couriers whose coverage
// zone includes that state are ranked ABOVE those who don't (zone-based last-mile
// dispatch — a parcel for Selangor goes to a courier who covers Selangor). Each
// row gets a `coversZone` flag the caller uses to hard-filter for auto-assign.
// When [state] is null (e.g. the admin's manual-assign roster) every courier
// counts as covering, so the ranking falls back to load only.
function scoreCouriers(PDO $pdo, ?string $state = null): array {
  $rows = $pdo->query(
    "SELECT dp.deliveryPersonnelId,
            u.fullName,
            u.userId,
            dp.vehicleType, dp.vehicleBrand, dp.vehicleModel, dp.vehiclePlate,
            dp.coverageZones, dp.isAvailable, dp.payoutsEnabled,
            COUNT(d.deliveryId) AS activeLoad
       FROM delivery_personnel dp
       JOIN `user` u
         ON u.userId = dp.userId AND u.status = 'Active'
       LEFT JOIN delivery d
         ON d.deliveryPersonnelId = dp.deliveryPersonnelId
        AND d.deliveryStatus IN ('Assigned', 'PickedUp', 'OutForDelivery')
      GROUP BY dp.deliveryPersonnelId, u.fullName, u.userId, dp.vehicleType, dp.vehicleBrand, dp.vehicleModel, dp.vehiclePlate, dp.coverageZones, dp.isAvailable, dp.payoutsEnabled"
  )->fetchAll();

  $wantZone = $state !== null && $state !== '';
  foreach ($rows as &$r) {
    $r['activeLoad']    = (int) $r['activeLoad'];
    $zones              = array_values(array_filter(array_map('trim', explode(',', (string) $r['coverageZones']))));
    $r['coverageZones'] = $zones;
    // No state to match → treat everyone as covering (load-only ranking).
    $r['coversZone']    = $wantZone ? in_array($state, $zones, true) : true;
    // Online/on-duty status — dispatch only auto-assigns to available couriers.
    $r['available']      = (bool) (int) $r['isAvailable'];
    $r['payoutsEnabled'] = (bool) (int) $r['payoutsEnabled'];
    $r['score']          = scoreCourier($r);
  }
  unset($r);

  // Rank: online couriers covering the zone first, then best (lowest) score,
  // then a stable id tie-breaker. Offline / non-covering couriers still appear
  // (so the admin roster can show them) but sink to the bottom.
  usort($rows, function ($a, $b) {
    return (($b['available'] ? 1 : 0)  <=> ($a['available'] ? 1 : 0))
        ?: (($b['coversZone'] ? 1 : 0) <=> ($a['coversZone'] ? 1 : 0))
        ?: ($a['score'] <=> $b['score'])
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

  // In-house vs standard shipping decision. ShoeAR's couriers are a LOCAL service
  // (one rider does pickup + drop), so they only handle orders where the supplier
  // and the customer are in the SAME state. When the states differ the parcel is
  // routed to STANDARD shipping (the supplier ships via a 3PL + tracking number);
  // no in-house courier is assigned. If either state is unknown (legacy data) we
  // fall back to in-house so nothing regresses.
  $stState = $pdo->prepare("SELECT deliveryState FROM `order` WHERE orderId = :o");
  $stState->execute(['o' => $orderId]);
  $custState = trim((string) ($stState->fetchColumn() ?: ''));

  $stSup = $pdo->prepare('SELECT operationalState FROM supplier WHERE supplierId = :s');
  $stSup->execute(['s' => $supplierId]);
  $supState = trim((string) ($stSup->fetchColumn() ?: ''));

  // In-house dispatch requires a POSITIVE same-state match (one local rider does
  // both pickup and drop). Cross-state → Standard shipping. If EITHER state is
  // unknown we can't confirm the parcel is local, so we must NOT auto-assign a
  // courier — doing so could strand a courier with an inter-state pickup (e.g. a
  // Penang rider sent to collect in KL). Unknown-state parcels are left Pending
  // for the admin to route by hand, and the supplier should set their
  // operational state so future orders route correctly.
  $sameState  = $custState !== '' && $supState !== '' && $custState === $supState;
  $isStandard = $custState !== '' && $supState !== '' && $custState !== $supState;

  // Only same-state parcels are scored against the courier roster.
  $best = null;
  if ($sameState) {
    $candidates = scoreCouriers($pdo, $custState);
    foreach ($candidates as $c) {         // ranked online-first, covering-first, then load
      // Never auto-assign to a courier we can't pay: they must be online, cover
      // the zone, AND have payouts enabled (defence-in-depth — going online is
      // already gated on payouts, but this guarantees dispatch honours it too).
      if ($c['coversZone'] && $c['available'] && $c['payoutsEnabled']) { $best = $c; break; }
    }
  }

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

  // Standard shipping: no in-house courier — the supplier ships it via a 3PL.
  // Pending here means "awaiting the supplier to ship", not "awaiting admin".
  if ($isStandard) {
    $pdo->prepare(
      "INSERT INTO delivery (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryMethod, deliveryStatus)
       VALUES (:id, :o, :s, NULL, 'Standard', 'Pending')"
    )->execute(['id' => $deliveryId, 'o' => $orderId, 's' => $supplierId]);

    return [
      'deliveryId'          => $deliveryId,
      'orderId'             => $orderId,
      'supplierId'          => $supplierId,
      'deliveryPersonnelId' => null,
      'deliveryMethod'      => 'Standard',
      'deliveryStatus'      => 'Pending',
      'auto'                => false,
    ];
  }

  if ($best) {
    $pdo->prepare(
      "INSERT INTO delivery (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryMethod, deliveryStatus)
       VALUES (:id, :o, :s, :dp, 'InHouse', 'Assigned')"
    )->execute(['id' => $deliveryId, 'o' => $orderId, 's' => $supplierId, 'dp' => $best['deliveryPersonnelId']]);

    return [
      'deliveryId'          => $deliveryId,
      'orderId'             => $orderId,
      'supplierId'          => $supplierId,
      'deliveryPersonnelId' => $best['deliveryPersonnelId'],
      'deliveryMethod'      => 'InHouse',
      'deliveryStatus'      => 'Assigned',
      'auto'                => true,
    ];
  }

  // In-house but no courier free → queue it for the admin to assign by hand.
  $pdo->prepare(
    "INSERT INTO delivery (deliveryId, orderId, supplierId, deliveryPersonnelId, deliveryMethod, deliveryStatus)
     VALUES (:id, :o, :s, NULL, 'InHouse', 'Pending')"
  )->execute(['id' => $deliveryId, 'o' => $orderId, 's' => $supplierId]);

  return [
    'deliveryId'          => $deliveryId,
    'orderId'             => $orderId,
    'supplierId'          => $supplierId,
    'deliveryPersonnelId' => null,
    'deliveryMethod'      => 'InHouse',
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

  // Never override a terminal state from a delivery-status change.
  $cur = $pdo->prepare('SELECT orderStatus FROM `order` WHERE orderId = :oid');
  $cur->execute(['oid' => $orderId]);
  $previous = $cur->fetchColumn();
  if (in_array($previous, ['Cancelled', 'Completed'], true)) { return; }

  $allDelivered = true;
  $anyOut = false;
  $anyPicked = false;
  $anyDelivered = false;
  foreach ($statuses as $s) {
    if ($s !== 'Delivered')        { $allDelivered = false; }
    if ($s === 'Delivered')        { $anyDelivered = true; }
    if ($s === 'OutForDelivery')   { $anyOut = true; }
    if ($s === 'PickedUp')         { $anyPicked = true; }
  }

  // Recompute deterministically EVERY time so a higher status can never linger
  // once the parcels no longer justify it (e.g. one parcel delivered while
  // another is still preparing must NOT stay 'Out for delivery').
  if ($allDelivered)     { $orderStatus = 'Delivered'; }
  elseif ($anyOut)       { $orderStatus = 'OutForDelivery'; }
  elseif ($anyPicked)    { $orderStatus = 'Shipped'; }
  elseif ($anyDelivered) { $orderStatus = 'Shipped'; }   // partially delivered → still in transit
  else                   { $orderStatus = 'Paid'; }       // nothing shipped yet

  $pdo->prepare('UPDATE `order` SET orderStatus = :os WHERE orderId = :oid')
      ->execute(['os' => $orderStatus, 'oid' => $orderId]);

  if ($previous !== $orderStatus && function_exists('notifyOrderStatusChange')) {
    notifyOrderStatusChange($pdo, $orderId, $orderStatus);
  }
}
