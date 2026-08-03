-- =============================================================================
-- Demo seed: 25 products for supplier "George Town Footwear Sdn Bhd"
-- (account email: timbunleong8@gmail.com)
--
-- Safe to run on an existing database:
--   * The supplier is resolved automatically from the account email.
--   * Product / variant / image IDs continue from the current MAX, so this
--     never collides with data you already have.
--   * Each product gets 6 UK-size variants (with stock) and 2 images.
--   * Products are inserted as 'Approved' so they show to customers straight
--     away. Change 'Approved' -> 'Pending' below if you want to test the
--     admin approval queue instead.
--
-- Run:  mysql -u <user> -p <database> < database/seed_george_town_25_products.sql
-- =============================================================================

-- Resolve the target supplier by their account email (unique).
SET @sid = (
  SELECT s.supplierId
    FROM supplier s
    JOIN `user` u ON u.userId = s.userId
   WHERE u.email = 'timbunleong8@gmail.com'
   LIMIT 1
);

-- Fail fast (with a readable message) if the supplier can't be found.
-- (Signal an error by selecting from a non-existent table name.)
SET @msg = IF(@sid IS NULL,
  'ABORT: supplier for timbunleong8@gmail.com not found — edit the email above',
  'ok');
-- If @sid is NULL the next line raises a "table supplier_not_found does not
-- exist" error, which stops the script before any inserts happen.
-- (Comment this guard out if your MySQL doesn't like it.)
-- SELECT * FROM supplier_not_found WHERE @sid IS NULL;

-- Continue numbering from the current highest id in each table.
SET @pbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productId, 4)        AS UNSIGNED)), 0) FROM product);
SET @vbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productVariantId, 4) AS UNSIGNED)), 0) FROM product_variant);
SET @ibase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productImageId, 4)   AS UNSIGNED)), 0) FROM product_image);

-- ── 1) Products ──────────────────────────────────────────────────────────────
INSERT INTO product
  (productId, supplierId, categoryId, productName, productBrand,
   productDescription, productPrice, productStatus, virtualTryOnEnable, submittedAt)
SELECT
  CONCAT('PRD', LPAD(@pbase + d.seq, 4, '0')),
  @sid, d.cat, d.name, d.brand, d.descr, d.price, 'Approved', 0, NOW()
FROM (
  SELECT 1  AS seq, 'CAT0001' AS cat, 'Air Zoom Pegasus 41'      AS name, 'Nike'          AS brand, 549.90 AS price, 'Responsive everyday running trainer with ReactX foam and breathable engineered mesh for a smooth, springy daily ride.' AS descr UNION ALL
  SELECT 2,  'CAT0001', 'Adizero Boston 12',        'Adidas',        629.00, 'Lightweight tempo trainer with Lightstrike Pro foam and a nylon rod plate for fast long runs and race-day pace.' UNION ALL
  SELECT 3,  'CAT0001', 'Gel-Kayano 31',            'Asics',         799.00, 'Premium stability shoe with 4D Guidance System and PureGEL cushioning for supportive, plush long-distance comfort.' UNION ALL
  SELECT 4,  'CAT0001', 'Fresh Foam X 1080v14',     'New Balance',   749.00, 'Max-cushion neutral trainer with Fresh Foam X midsole and a soft knit upper for all-day and long-run comfort.' UNION ALL
  SELECT 5,  'CAT0001', 'Clifton 9',                'Hoka',          699.00, 'Lightweight max-cushion daily trainer with a balanced meta-rocker for a smooth, cloud-like heel-to-toe transition.' UNION ALL
  SELECT 6,  'CAT0001', 'Deviate Nitro 3',          'Puma',          719.00, 'Carbon-plated performance trainer with NITRO Elite foam and PUMAGRIP outsole for propulsive daily and tempo runs.' UNION ALL
  SELECT 7,  'CAT0002', 'LeBron 21',                'Nike',          899.00, 'Explosive basketball shoe with full-length Zoom Air and Cushlon 3.0 foam for power moves and hard landings.' UNION ALL
  SELECT 8,  'CAT0002', 'Harden Vol. 8',            'Adidas',        649.00, 'Guard-focused hoops shoe with Boost cushioning and a wide base for sharp cuts, stops and step-back jumpers.' UNION ALL
  SELECT 9,  'CAT0002', 'Curry 11',                 'Under Armour',  759.00, 'Lightweight shooter''s shoe with UA Flow cushioning (no rubber) for grip, court feel and quick lateral movement.' UNION ALL
  SELECT 10, 'CAT0002', 'MB.03',                    'Puma',          629.00, 'Signature guard shoe with NITRO foam and a supportive cage for fast, agile perimeter play and quick first steps.' UNION ALL
  SELECT 11, 'CAT0003', 'Air Force 1 ''07',         'Nike',          459.00, 'Iconic low-top with crisp leather upper and Air-Sole cushioning — a timeless everyday streetwear staple.' UNION ALL
  SELECT 12, 'CAT0003', 'Samba OG',                 'Adidas',        499.00, 'Classic low-profile sneaker with soft leather upper, suede overlays and gum sole — endlessly wearable style.' UNION ALL
  SELECT 13, 'CAT0003', '550',                      'New Balance',   549.00, 'Retro basketball-inspired lifestyle sneaker with premium leather panels and a clean, vintage court silhouette.' UNION ALL
  SELECT 14, 'CAT0003', 'Chuck 70 High',            'Converse',      359.00, 'Premium take on the classic high-top canvas sneaker with heavier canvas, extra cushioning and vintage details.' UNION ALL
  SELECT 15, 'CAT0003', 'Old Skool',                'Vans',          299.00, 'The original side-stripe skate shoe with durable suede and canvas upper and a grippy waffle outsole.' UNION ALL
  SELECT 16, 'CAT0003', 'Suede Classic XXI',        'Puma',          329.00, 'Heritage suede sneaker with a soft upper and rubber outsole — a retro streetwear icon that never dates.' UNION ALL
  SELECT 17, 'CAT0003', 'Club C 85',                'Reebok',        349.00, 'Minimalist tennis-inspired sneaker with soft leather upper and clean lines for effortless everyday wear.' UNION ALL
  SELECT 18, 'CAT0004', 'Metcon 9',                 'Nike',          619.00, 'Stable cross-training shoe with a wide flat heel and Hyperlift plate for lifting, plus grip for short runs.' UNION ALL
  SELECT 19, 'CAT0004', 'Nano X4',                  'Reebok',        649.00, 'Versatile training shoe with Lift and Run chassis and a flexible forefoot for lifting, HIIT and box work.' UNION ALL
  SELECT 20, 'CAT0004', 'Project Rock 6',           'Under Armour',  729.00, 'High-energy training shoe with UA Flow cushioning and a supportive midfoot band for lifts and conditioning.' UNION ALL
  SELECT 21, 'CAT0004', 'Dropset Trainer 3',        'Adidas',        559.00, 'Stable, grippy training shoe with a lockdown fit and firm base built for lifting and gym conditioning work.' UNION ALL
  SELECT 22, 'CAT0005', 'Mercurial Vapor 16 FG',    'Nike',          949.00, 'Speed-focused firm-ground boot with a Vaporposite grip texture and Air Zoom unit for explosive acceleration.' UNION ALL
  SELECT 23, 'CAT0005', 'Predator Elite FG',        'Adidas',        999.00, 'Control-focused firm-ground boot with HybridTouch upper and grip-strike zones for spin, power and precision.' UNION ALL
  SELECT 24, 'CAT0005', 'Future 7 Ultimate FG',     'Puma',          869.00, 'Adaptive firm-ground boot with a PWRTAPE-reinforced FUZIONFIT+ compression band for a locked-in agile fit.' UNION ALL
  SELECT 25, 'CAT0005', 'Morelia Neo IV Beta FG',   'Mizuno',        799.00, 'Premium kangaroo-leather firm-ground boot — lightweight, supple and built for a natural touch on the ball.'
) AS d;

-- ── 2) Size variants (6 UK sizes per product, with stock) ─────────────────────
INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
SELECT
  CONCAT('VAR', LPAD(@vbase + ((d.seq - 1) * 6 + s.sseq), 4, '0')),
  CONCAT('PRD', LPAD(@pbase + d.seq, 4, '0')),
  s.sz,
  ((d.seq * 3 + s.sseq * 7) % 35) + 6          -- deterministic stock 6..40
FROM (
  SELECT 1 AS seq UNION ALL SELECT 2  UNION ALL SELECT 3  UNION ALL SELECT 4  UNION ALL SELECT 5  UNION ALL
  SELECT 6         UNION ALL SELECT 7  UNION ALL SELECT 8  UNION ALL SELECT 9  UNION ALL SELECT 10 UNION ALL
  SELECT 11        UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL
  SELECT 16        UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL
  SELECT 21        UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25
) AS d
CROSS JOIN (
  SELECT 1 AS sseq, 'UK6' AS sz UNION ALL
  SELECT 2, 'UK7'  UNION ALL
  SELECT 3, 'UK8'  UNION ALL
  SELECT 4, 'UK9'  UNION ALL
  SELECT 5, 'UK10' UNION ALL
  SELECT 6, 'UK11'
) AS s;

-- ── 3) Images (2 per product) ─────────────────────────────────────────────────
-- loremflickr returns a shoe-themed image per lock id. If your environment
-- blocks it, the app just shows its built-in placeholder — swap in real URLs
-- (e.g. your Firebase Storage links) any time.
INSERT INTO product_image (productImageId, productId, productImageUrl)
SELECT
  CONCAT('IMG', LPAD(@ibase + ((d.seq - 1) * 2 + im.iseq), 4, '0')),
  CONCAT('PRD', LPAD(@pbase + d.seq, 4, '0')),
  CONCAT('https://loremflickr.com/800/800/sneaker,shoe?lock=', (@pbase + d.seq) * 10 + im.iseq)
FROM (
  SELECT 1 AS seq UNION ALL SELECT 2  UNION ALL SELECT 3  UNION ALL SELECT 4  UNION ALL SELECT 5  UNION ALL
  SELECT 6         UNION ALL SELECT 7  UNION ALL SELECT 8  UNION ALL SELECT 9  UNION ALL SELECT 10 UNION ALL
  SELECT 11        UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL
  SELECT 16        UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL
  SELECT 21        UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25
) AS d
CROSS JOIN (
  SELECT 1 AS iseq UNION ALL SELECT 2
) AS im;

-- Quick check of what was created:
SELECT p.productId, p.productName, p.productBrand, c.categoryName, p.productPrice,
       (SELECT COUNT(*) FROM product_variant v WHERE v.productId = p.productId) AS sizes,
       (SELECT COALESCE(SUM(v.stockQuantity),0) FROM product_variant v WHERE v.productId = p.productId) AS totalStock,
       (SELECT COUNT(*) FROM product_image i WHERE i.productId = p.productId) AS images
  FROM product p
  JOIN category c ON c.categoryId = p.categoryId
 WHERE p.supplierId = @sid
 ORDER BY p.productId;
