<?php
// ─────────────────────────────────────────────────────────────────────
// Seed a realistic demo CATALOG: categories + demo suppliers + approved
// products + size variants. Run this on a fresh (wiped) database to get a
// believable store to demo — far better than hand-adding a handful of shoes.
//
// The product names/brands are a curated sport-shoe set (the same kind of
// items as the Amazon dataset the prototype was trained on) so the catalog
// looks real. Stock lives per size in product_variant.
//
//   php backend/scripts/seed_demo_catalog.php
//
// Idempotent: re-running reuses existing categories/suppliers/products by
// their natural keys and never duplicates. After running, seed ratings with
//   php backend/scripts/seed_demo_reviews.php
// and place a few test orders in the app so "Trending" has sales data.
// ─────────────────────────────────────────────────────────────────────

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/ids.php';

const SUPPLIER_PASSWORD = 'Demo@1234';   // demo suppliers log in with this

$pdo = getPDO();
$hash = password_hash(SUPPLIER_PASSWORD, PASSWORD_BCRYPT);
mt_srand(42); // reproducible stock numbers

// ── 1. Categories ────────────────────────────────────────────────────────────
$categoryNames = ['Running', 'Basketball', 'Lifestyle', 'Football', 'Training', 'Tennis'];
$catIds = []; // name => categoryId
foreach ($categoryNames as $name) {
  $stmt = $pdo->prepare('SELECT categoryId FROM category WHERE categoryName = :n');
  $stmt->execute(['n' => $name]);
  $id = $stmt->fetchColumn();
  if (!$id) {
    $id = nextId($pdo, 'category', 'categoryId', 'CAT');
    $pdo->prepare('INSERT INTO category (categoryId, categoryName) VALUES (:id, :n)')
        ->execute(['id' => $id, 'n' => $name]);
  }
  $catIds[$name] = $id;
}
echo 'Categories ready: ' . implode(', ', $categoryNames) . "\n";

// ── 2. Two Active demo suppliers ──────────────────────────────────────────────
// Each supplier owns products and has an operationalState (drives in-house vs
// standard shipping). NOT-NULL business fields are filled with demo values.
$supplierDefs = [
  [
    'username' => 'demo_supplier_kl', 'fullName' => 'KL Sports Trading Owner',
    'company'  => 'KL Sports Trading Sdn Bhd', 'display' => 'KL Sports Hub',
    'line1' => '12 Jalan Bukit Bintang', 'postcode' => '55100', 'city' => 'Kuala Lumpur', 'state' => 'Kuala Lumpur',
    'regNo' => '201901000001',
  ],
  [
    'username' => 'demo_supplier_png', 'fullName' => 'Penang Footwear Owner',
    'company'  => 'Penang Footwear Enterprise', 'display' => 'Penang Kicks',
    'line1' => '88 Lebuh Chulia', 'postcode' => '10200', 'city' => 'George Town', 'state' => 'Pulau Pinang',
    'regNo' => '201901000002',
  ],
];

$supplierIds = []; // index => supplierId
foreach ($supplierDefs as $i => $s) {
  // user row
  $email = $s['username'] . '@shoear.test';
  $stmt = $pdo->prepare('SELECT userId FROM `user` WHERE username = :u OR email = :e LIMIT 1');
  $stmt->execute(['u' => $s['username'], 'e' => $email]);
  $userId = $stmt->fetchColumn();
  if (!$userId) {
    $userId = nextId($pdo, 'user', 'userId', 'USR');
    $pdo->prepare(
      "INSERT INTO `user` (userId, username, password, email, fullName, phoneNumber, role, status)
       VALUES (:id, :u, :pw, :e, :fn, :ph, 'Supplier', 'Active')"
    )->execute(['id' => $userId, 'u' => $s['username'], 'pw' => $hash, 'e' => $email,
                'fn' => $s['fullName'], 'ph' => '0139000' . str_pad((string) $i, 3, '0', STR_PAD_LEFT)]);
  }
  // supplier row
  $stmt = $pdo->prepare('SELECT supplierId FROM supplier WHERE userId = :uid');
  $stmt->execute(['uid' => $userId]);
  $supplierId = $stmt->fetchColumn();
  if (!$supplierId) {
    $supplierId = nextId($pdo, 'supplier', 'supplierId', 'SUP');
    $addr = $s['line1'] . ', ' . $s['postcode'] . ' ' . $s['city'] . ', ' . $s['state'];
    $pdo->prepare(
      "INSERT INTO supplier
         (supplierId, userId, companyName, displayName,
          companyAddress, companyLine1, companyPostcode, companyCity, companyState,
          operationalAddress, operationalLine1, operationalPostcode, operationalCity, operationalState,
          businessRegNo, businessLicenseUrl)
       VALUES
         (:sid, :uid, :co, :disp,
          :addr, :l1, :pc, :city, :st,
          :addr, :l1, :pc, :city, :st,
          :reg, :lic)"
    )->execute([
      'sid' => $supplierId, 'uid' => $userId, 'co' => $s['company'], 'disp' => $s['display'],
      'addr' => $addr, 'l1' => $s['line1'], 'pc' => $s['postcode'], 'city' => $s['city'], 'st' => $s['state'],
      'reg' => $s['regNo'], 'lic' => 'demo/business_license_placeholder.pdf',
    ]);
  }
  $supplierIds[$i] = $supplierId;
}
echo 'Suppliers ready: ' . implode(', ', array_column($supplierDefs, 'company')) . "\n";

// ── 3. Product catalog (curated sport shoes, 4 per category) ──────────────────
// [name, brand, category, price, description]
$catalog = [
  // Running
  ['Air Zoom Pegasus 41', 'Nike', 'Running', 459.00, 'Responsive everyday running shoe with ReactX foam for a smooth, springy ride.'],
  ['Ultraboost Light', 'Adidas', 'Running', 899.00, 'Lightweight Boost cushioning that returns energy on every stride.'],
  ['Gel-Kayano 31', 'Asics', 'Running', 799.00, 'Stability trainer with 4D Guidance System for overpronation support.'],
  ['Fresh Foam X 1080v13', 'New Balance', 'Running', 749.00, 'Plush max-cushion daily trainer for long, comfortable miles.'],
  // Basketball
  ['LeBron Witness 8', 'Nike', 'Basketball', 529.00, 'Court-ready hoops shoe with Cushlon foam and a Zoom Air unit under the heel.'],
  ['Harden Vol. 8', 'Adidas', 'Basketball', 649.00, 'Low-to-the-ground Boost setup built for stop-and-go guards.'],
  ['Curry 11', 'Under Armour', 'Basketball', 699.00, 'Flow cushioning for a lightweight, grippy, no-rubber outsole.'],
  ['Ja 1', 'Nike', 'Basketball', 499.00, 'Explosive traction and Zoom Air tuned for fast, powerful guards.'],
  // Lifestyle
  ['Air Force 1 \'07', 'Nike', 'Lifestyle', 399.00, 'The timeless court classic — crisp leather and legendary Air cushioning.'],
  ['Samba OG', 'Adidas', 'Lifestyle', 449.00, 'Iconic low-profile silhouette with a gum sole and suede T-toe.'],
  ['Classic Leather', 'Reebok', 'Lifestyle', 359.00, 'Soft leather everyday sneaker with clean retro lines.'],
  ['Old Skool', 'Vans', 'Lifestyle', 289.00, 'The original side-stripe skate shoe — durable canvas and suede.'],
  // Football
  ['Predator Elite FG', 'Adidas', 'Football', 749.00, 'Firm-ground boot with HybridTouch strike zones for spin and control.'],
  ['Mercurial Vapor 16', 'Nike', 'Football', 829.00, 'Speed boot with a Zoom Air unit and Vaporposite+ upper for sharp touch.'],
  ['Future 7 Ultimate', 'Puma', 'Football', 699.00, 'Adaptive FUZIONFIT+ compression band for a locked-in, agile feel.'],
  ['X Crazyfast', 'Adidas', 'Football', 649.00, 'Ultralight sprint boot engineered for pure acceleration.'],
  // Training
  ['Metcon 9', 'Nike', 'Training', 569.00, 'Stable, flat-heeled gym trainer built for lifting and HIIT.'],
  ['Nano X4', 'Reebok', 'Training', 599.00, 'Versatile CrossFit shoe with a Lift and Run chassis for all-round work.'],
  ['TriBase Reign 6', 'Under Armour', 'Training', 549.00, 'Low, wide base for grounded stability during heavy training.'],
  ['Dropset 3', 'Adidas', 'Training', 519.00, 'Wide, grippy platform tuned for weightlifting and functional sessions.'],
  // Tennis
  ['Court FF 3', 'Asics', 'Tennis', 719.00, 'Fast, supportive tennis shoe for aggressive baseline movement.'],
  ['Zoom Vapor Pro 2', 'Nike', 'Tennis', 679.00, 'Lightweight speed-focused shoe for quick court coverage.'],
  ['Barricade 13', 'Adidas', 'Tennis', 639.00, 'Durable, stable shoe built to withstand hard-court grinders.'],
  ['Rush Pro 4.0', 'Wilson', 'Tennis', 589.00, 'Balanced all-court shoe with a comfortable, secure fit.'],
];

$sizes = ['UK7', 'UK8', 'UK9', 'UK10', 'UK11'];

$findProduct = $pdo->prepare(
  'SELECT productId FROM product WHERE productName = :n AND productBrand = :b LIMIT 1'
);
$insProduct = $pdo->prepare(
  "INSERT INTO product
     (productId, supplierId, categoryId, productName, productBrand, productDescription,
      productPrice, productStatus, virtualTryOnEnable)
   VALUES
     (:id, :sid, :cid, :n, :b, :d, :p, 'Approved', :ar)"
);
$findVariant = $pdo->prepare(
  'SELECT productVariantId FROM product_variant WHERE productId = :p AND size = :s'
);
$insVariant = $pdo->prepare(
  'INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
   VALUES (:id, :p, :s, :q)'
);

$prodInserted = 0; $prodSkipped = 0; $varInserted = 0;
foreach ($catalog as $i => $row) {
  [$name, $brand, $cat, $price, $desc] = $row;
  $supplierId = $supplierIds[$i % count($supplierIds)];  // split across suppliers
  $arEnabled  = ($i % 3 === 0) ? 1 : 0;                   // AR on for every 3rd product

  $findProduct->execute(['n' => $name, 'b' => $brand]);
  $productId = $findProduct->fetchColumn();
  if ($productId) {
    $prodSkipped++;
  } else {
    $productId = nextId($pdo, 'product', 'productId', 'PRD');
    $insProduct->execute([
      'id' => $productId, 'sid' => $supplierId, 'cid' => $catIds[$cat],
      'n' => $name, 'b' => $brand, 'd' => $desc, 'p' => $price, 'ar' => $arEnabled,
    ]);
    $prodInserted++;
  }

  // size variants with stock
  foreach ($sizes as $size) {
    $findVariant->execute(['p' => $productId, 's' => $size]);
    if (!$findVariant->fetchColumn()) {
      $vid = nextId($pdo, 'product_variant', 'productVariantId', 'VAR');
      $insVariant->execute(['id' => $vid, 'p' => $productId, 's' => $size, 'q' => mt_rand(5, 30)]);
      $varInserted++;
    }
  }
}

// ── 4. Summary ────────────────────────────────────────────────────────────────
$total = (int) $pdo->query("SELECT COUNT(*) FROM product WHERE productStatus = 'Approved'")->fetchColumn();
echo "\nProducts inserted: $prodInserted, skipped (already existed): $prodSkipped.\n";
echo "Variants inserted: $varInserted.\n";
echo "Total approved products now: $total.\n";
echo "\nDemo suppliers (login password: " . SUPPLIER_PASSWORD . "):\n";
foreach ($supplierDefs as $s) { echo "  - {$s['username']}  ({$s['company']})\n"; }
echo "\n✅ Done. Next:\n";
echo "   1. php backend/scripts/seed_demo_reviews.php   (adds ratings so CF works)\n";
echo "   2. Place a few test orders in the app so 'Trending' has sales data\n";
echo "   3. Restart / reload the ML service\n";
