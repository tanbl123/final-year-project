<?php
// ─────────────────────────────────────────────────────────────────────
// Seed a few PENDING supplier + courier accounts so the admin approval
// queues have something to show for UI screenshots.
//
//   php backend/scripts/seed_pending_accounts.php
//
// These land as role Supplier / DeliveryPersonnel with status 'Pending',
// exactly like a real self-registration awaiting admin review, so they
// appear in:
//   • Admin ▸ Suppliers ▸ Pending approval  (GET /admin/suppliers/pending)
//   • Admin ▸ Couriers  ▸ Pending approval  (GET /admin/couriers/pending)
//
// REMOVABLE: every seeded login uses the '@pending.seed' email domain, so
// the companion script deletes them cleanly and nothing else:
//   php backend/scripts/unseed_pending_accounts.php
//
// Idempotent: re-running skips any seed account that already exists.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const SEED_DOMAIN = '@pending.seed';          // the tag that makes these removable
const SEED_PASSWORD = 'Pending@1234';         // known password (accounts are Pending, for display only)

$pdo = getPDO();
$hash = password_hash(SEED_PASSWORD, PASSWORD_BCRYPT);

// ── Pending SUPPLIER applications ────────────────────────────────────
$suppliers = [
  [
    'username' => 'sole_step_kl', 'fullName' => 'Lim Wei Sheng',
    'phone' => '0123456701',
    'companyName' => 'Sole Step Trading Sdn Bhd', 'displayName' => 'Sole Step',
    'regNo' => '202301011234 (1500123-A)', 'tax' => 'C21234567890',
    'line1' => 'No. 12, Jalan Ampang', 'postcode' => '50450', 'city' => 'Kuala Lumpur', 'state' => 'Kuala Lumpur',
  ],
  [
    'username' => 'kick_avenue_pg', 'fullName' => 'Nurul Aisyah binti Rahman',
    'phone' => '0123456702',
    'companyName' => 'Kick Avenue Enterprise', 'displayName' => 'Kick Avenue',
    'regNo' => '202402022345 (1600234-B)', 'tax' => null,
    'line1' => '45, Lebuh Carnarvon', 'postcode' => '10100', 'city' => 'George Town', 'state' => 'Penang',
  ],
  [
    'username' => 'urban_laces_jb', 'fullName' => 'Tan Chee Keong',
    'phone' => '0123456703',
    'companyName' => 'Urban Laces Marketing', 'displayName' => 'Urban Laces',
    'regNo' => '202405033456 (1700345-C)', 'tax' => 'W98765432100',
    'line1' => '8, Jalan Wong Ah Fook', 'postcode' => '80000', 'city' => 'Johor Bahru', 'state' => 'Johor',
  ],
];

// ── Pending COURIER applications ─────────────────────────────────────
$couriers = [
  [
    'username' => 'rider_farid', 'fullName' => 'Muhammad Farid bin Ismail',
    'phone' => '0123456711',
    'vType' => 'Motorcycle', 'vBrand' => 'Yamaha', 'vModel' => 'Y15ZR', 'plate' => 'WVX 3412',
    'licNo' => '880517105321', 'licClass' => 'B2,D', 'licExp' => '2027-05-16',
    'ic' => '880517-10-5321', 'dob' => '1988-05-17', 'zones' => 'Kuala Lumpur,Selangor',
  ],
  [
    'username' => 'rider_mei', 'fullName' => 'Chong Mei Ling',
    'phone' => '0123456712',
    'vType' => 'Car', 'vBrand' => 'Perodua', 'vModel' => 'Myvi', 'plate' => 'PPX 8890',
    'licNo' => '920214075112', 'licClass' => 'D', 'licExp' => '2026-02-13',
    'ic' => '920214-07-5112', 'dob' => '1992-02-14', 'zones' => 'Penang,Kedah',
  ],
  [
    'username' => 'rider_arjun', 'fullName' => 'Arjun a/l Ravindran',
    'phone' => '0123456713',
    'vType' => 'Van', 'vBrand' => 'Toyota', 'vModel' => 'Hiace', 'plate' => 'JQK 1205',
    'licNo' => '900930015678', 'licClass' => 'B2,D,E', 'licExp' => '2028-09-29',
    'ic' => '900930-01-5678', 'dob' => '1990-09-30', 'zones' => 'Johor',
  ],
];

$exists = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
$madeSup = 0; $madeCour = 0; $skipped = 0;

foreach ($suppliers as $s) {
  $email = $s['username'] . SEED_DOMAIN;
  $exists->execute(['u' => $s['username'], 'e' => $email]);
  if ($exists->fetchColumn()) { $skipped++; continue; }

  $pdo->beginTransaction();
  try {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $supId  = nextId($pdo, 'supplier', 'supplierId', 'SUP');
    $addr   = $s['line1'] . ', ' . $s['postcode'] . ' ' . $s['city'] . ', ' . $s['state'];

    $pdo->prepare(
      "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :u, :pw, :e, :fn, :ph, 'Supplier', 'Pending')"
    )->execute(['id' => $userId, 'u' => $s['username'], 'pw' => $hash,
                'e' => $email, 'fn' => $s['fullName'], 'ph' => $s['phone']]);

    $pdo->prepare(
      "INSERT INTO supplier
         (supplierId, userId, companyName, displayName,
          companyAddress, companyLine1, companyPostcode, companyCity, companyState,
          operationalAddress, operationalLine1, operationalPostcode, operationalCity, operationalState,
          businessRegNo, businessLicenseUrl, taxNumber)
       VALUES
         (:sid, :uid, :cn, :dn,
          :ca, :cl1, :cp, :cc, :cs,
          :oa, :ol1, :op, :oc, :os,
          :reg, :lic, :tax)"
    )->execute([
      'sid' => $supId, 'uid' => $userId, 'cn' => $s['companyName'], 'dn' => $s['displayName'],
      'ca' => $addr, 'cl1' => $s['line1'], 'cp' => $s['postcode'], 'cc' => $s['city'], 'cs' => $s['state'],
      'oa' => $addr, 'ol1' => $s['line1'], 'op' => $s['postcode'], 'oc' => $s['city'], 'os' => $s['state'],
      'reg' => $s['regNo'], 'lic' => 'uploads/seed/ssm_' . $s['username'] . '.pdf', 'tax' => $s['tax'],
    ]);

    $pdo->commit();
    $madeSup++;
    echo "  + supplier  {$s['companyName']}  ($userId / $supId)\n";
  } catch (Throwable $e) {
    $pdo->rollBack();
    echo "  ! supplier {$s['username']} failed: " . $e->getMessage() . "\n";
  }
}

foreach ($couriers as $c) {
  $email = $c['username'] . SEED_DOMAIN;
  $exists->execute(['u' => $c['username'], 'e' => $email]);
  if ($exists->fetchColumn()) { $skipped++; continue; }

  $pdo->beginTransaction();
  try {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $delId  = nextId($pdo, 'delivery_personnel', 'deliveryPersonnelId', 'DEL');

    $pdo->prepare(
      "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :u, :pw, :e, :fn, :ph, 'DeliveryPersonnel', 'Pending')"
    )->execute(['id' => $userId, 'u' => $c['username'], 'pw' => $hash,
                'e' => $email, 'fn' => $c['fullName'], 'ph' => $c['phone']]);

    $pdo->prepare(
      "INSERT INTO delivery_personnel
         (deliveryPersonnelId, userId, vehicleType, vehicleBrand, vehicleModel, vehiclePlate,
          licenseNumber, licenseClass, licenseExpiry, icNumber, dateOfBirth,
          termsAcceptedAt, coverageZones)
       VALUES
         (:did, :uid, :vt, :vb, :vm, :vp,
          :ln, :lc, :le, :ic, :dob,
          NOW(), :zones)"
    )->execute([
      'did' => $delId, 'uid' => $userId, 'vt' => $c['vType'], 'vb' => $c['vBrand'],
      'vm' => $c['vModel'], 'vp' => $c['plate'], 'ln' => $c['licNo'], 'lc' => $c['licClass'],
      'le' => $c['licExp'], 'ic' => $c['ic'], 'dob' => $c['dob'], 'zones' => $c['zones'],
    ]);

    $pdo->commit();
    $madeCour++;
    echo "  + courier   {$c['fullName']}  ($userId / $delId)\n";
  } catch (Throwable $e) {
    $pdo->rollBack();
    echo "  ! courier {$c['username']} failed: " . $e->getMessage() . "\n";
  }
}

echo "\n✅ Done. Suppliers created: $madeSup, couriers created: $madeCour, skipped (already seeded): $skipped\n";
echo "   Both now appear in the admin approval queues as 'Pending'.\n";
echo "   Remove them anytime with: php backend/scripts/unseed_pending_accounts.php\n";
