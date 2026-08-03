-- =============================================================================
-- Demo seed: 25 products for supplier "George Town Footwear Sdn Bhd"
-- (account email: timbunleong8@gmail.com)
--
-- Safe & re-runnable:
--   * Supplier is resolved automatically from the account email.
--   * IDs continue from the current MAX and are forced to integers, e.g.
--     PRD0026 (never "PRD26.0").
--   * DUPLICATE-SAFE: a product is only inserted if this supplier does NOT
--     already have one with the same name + brand. Re-running adds nothing.
--   * Each newly-created product gets 6 UK-size variants (with stock) and 2
--     images. Products are inserted as 'Approved'.
--
-- Run:  mysql -u <user> -p <database> < database/seed_george_town_25_products.sql
--       (or paste into the phpMyAdmin SQL tab — temp table persists across the
--        statements in one run)
-- =============================================================================

-- Resolve the target supplier by their account email (unique).
SET @sid = (
  SELECT s.supplierId
    FROM supplier s
    JOIN `user` u ON u.userId = s.userId
   WHERE u.email = 'timbunleong8@gmail.com'
   LIMIT 1
);

-- Continue numbering from the current highest VALID id (ignore any malformed
-- ids that aren't PRD/VAR/IMG + digits).
SET @pbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productId, 4)        AS UNSIGNED)), 0) FROM product          WHERE productId        REGEXP '^PRD[0-9]+$');
SET @vbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productVariantId, 4) AS UNSIGNED)), 0) FROM product_variant WHERE productVariantId REGEXP '^VAR[0-9]+$');
SET @ibase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productImageId, 4)   AS UNSIGNED)), 0) FROM product_image   WHERE productImageId   REGEXP '^IMG[0-9]+$');

-- ── The 25 products live in a temp table, so we can reference them for the
--    product / variant / image inserts without repeating the list. ────────────
DROP TEMPORARY TABLE IF EXISTS _seed_products;
CREATE TEMPORARY TABLE _seed_products (
  seq   INT           NOT NULL,
  cat   VARCHAR(10)   NOT NULL,
  name  VARCHAR(150)  NOT NULL,
  brand VARCHAR(80)   NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  descr TEXT          NOT NULL
);
INSERT INTO _seed_products (seq, cat, name, brand, price, descr) VALUES
  (1,  'CAT0001', 'Air Zoom Pegasus 41',   'Nike',         549.90, 'Responsive everyday running trainer with ReactX foam and breathable engineered mesh for a smooth, springy daily ride.'),
  (2,  'CAT0001', 'Adizero Boston 12',      'Adidas',       629.00, 'Lightweight tempo trainer with Lightstrike Pro foam and a nylon rod plate for fast long runs and race-day pace.'),
  (3,  'CAT0001', 'Gel-Kayano 31',          'Asics',        799.00, 'Premium stability shoe with 4D Guidance System and PureGEL cushioning for supportive, plush long-distance comfort.'),
  (4,  'CAT0001', 'Fresh Foam X 1080v14',   'New Balance',  749.00, 'Max-cushion neutral trainer with Fresh Foam X midsole and a soft knit upper for all-day and long-run comfort.'),
  (5,  'CAT0001', 'Clifton 9',              'Hoka',         699.00, 'Lightweight max-cushion daily trainer with a balanced meta-rocker for a smooth, cloud-like heel-to-toe transition.'),
  (6,  'CAT0001', 'Deviate Nitro 3',        'Puma',         719.00, 'Carbon-plated performance trainer with NITRO Elite foam and PUMAGRIP outsole for propulsive daily and tempo runs.'),
  (7,  'CAT0002', 'LeBron 21',              'Nike',         899.00, 'Explosive basketball shoe with full-length Zoom Air and Cushlon 3.0 foam for power moves and hard landings.'),
  (8,  'CAT0002', 'Harden Vol. 8',          'Adidas',       649.00, 'Guard-focused hoops shoe with Boost cushioning and a wide base for sharp cuts, stops and step-back jumpers.'),
  (9,  'CAT0002', 'Curry 11',               'Under Armour', 759.00, 'Lightweight shooter''s shoe with UA Flow cushioning (no rubber) for grip, court feel and quick lateral movement.'),
  (10, 'CAT0002', 'MB.03',                  'Puma',         629.00, 'Signature guard shoe with NITRO foam and a supportive cage for fast, agile perimeter play and quick first steps.'),
  (11, 'CAT0003', 'Air Force 1 ''07',       'Nike',         459.00, 'Iconic low-top with crisp leather upper and Air-Sole cushioning — a timeless everyday streetwear staple.'),
  (12, 'CAT0003', 'Samba OG',               'Adidas',       499.00, 'Classic low-profile sneaker with soft leather upper, suede overlays and gum sole — endlessly wearable style.'),
  (13, 'CAT0003', '550',                    'New Balance',  549.00, 'Retro basketball-inspired lifestyle sneaker with premium leather panels and a clean, vintage court silhouette.'),
  (14, 'CAT0003', 'Chuck 70 High',          'Converse',     359.00, 'Premium take on the classic high-top canvas sneaker with heavier canvas, extra cushioning and vintage details.'),
  (15, 'CAT0003', 'Old Skool',              'Vans',         299.00, 'The original side-stripe skate shoe with durable suede and canvas upper and a grippy waffle outsole.'),
  (16, 'CAT0003', 'Suede Classic XXI',      'Puma',         329.00, 'Heritage suede sneaker with a soft upper and rubber outsole — a retro streetwear icon that never dates.'),
  (17, 'CAT0003', 'Club C 85',              'Reebok',       349.00, 'Minimalist tennis-inspired sneaker with soft leather upper and clean lines for effortless everyday wear.'),
  (18, 'CAT0004', 'Metcon 9',               'Nike',         619.00, 'Stable cross-training shoe with a wide flat heel and Hyperlift plate for lifting, plus grip for short runs.'),
  (19, 'CAT0004', 'Nano X4',                'Reebok',       649.00, 'Versatile training shoe with Lift and Run chassis and a flexible forefoot for lifting, HIIT and box work.'),
  (20, 'CAT0004', 'Project Rock 6',         'Under Armour', 729.00, 'High-energy training shoe with UA Flow cushioning and a supportive midfoot band for lifts and conditioning.'),
  (21, 'CAT0004', 'Dropset Trainer 3',      'Adidas',       559.00, 'Stable, grippy training shoe with a lockdown fit and firm base built for lifting and gym conditioning work.'),
  (22, 'CAT0005', 'Mercurial Vapor 16 FG',  'Nike',         949.00, 'Speed-focused firm-ground boot with a Vaporposite grip texture and Air Zoom unit for explosive acceleration.'),
  (23, 'CAT0005', 'Predator Elite FG',      'Adidas',       999.00, 'Control-focused firm-ground boot with HybridTouch upper and grip-strike zones for spin, power and precision.'),
  (24, 'CAT0005', 'Future 7 Ultimate FG',   'Puma',         869.00, 'Adaptive firm-ground boot with a PWRTAPE-reinforced FUZIONFIT+ compression band for a locked-in agile fit.'),
  (25, 'CAT0005', 'Morelia Neo IV Beta FG', 'Mizuno',       799.00, 'Premium kangaroo-leather firm-ground boot — lightweight, supple and built for a natural touch on the ball.');

-- ── 1) Products (skip any this supplier already has by name + brand) ──────────
--    CAST(... AS UNSIGNED) forces an integer, so ids are PRD0026 not PRD26.0.
INSERT INTO product
  (productId, supplierId, categoryId, productName, productBrand,
   productDescription, productPrice, productStatus, virtualTryOnEnable, submittedAt)
SELECT
  CONCAT('PRD', LPAD(CAST(@pbase + ROW_NUMBER() OVER (ORDER BY d.seq) AS UNSIGNED), 4, '0')),
  @sid, d.cat, d.name, d.brand, d.descr, d.price, 'Approved', 0, NOW()
FROM _seed_products d
WHERE NOT EXISTS (
  SELECT 1 FROM product x
   WHERE x.supplierId = @sid AND x.productName = d.name AND x.productBrand = d.brand
);

-- ── 2) Variants: 6 UK sizes for our products that don't have variants yet ─────
INSERT INTO product_variant (productVariantId, productId, size, stockQuantity)
SELECT
  CONCAT('VAR', LPAD(CAST(@vbase + ROW_NUMBER() OVER (ORDER BY p.productId, s.sseq) AS UNSIGNED), 4, '0')),
  p.productId, s.sz,
  ((d.seq * 3 + s.sseq * 7) % 35) + 6           -- deterministic stock 6..40
FROM product p
JOIN _seed_products d
  ON d.name = p.productName AND d.brand = p.productBrand
CROSS JOIN (
  SELECT 1 AS sseq, 'UK6' AS sz UNION ALL
  SELECT 2, 'UK7'  UNION ALL
  SELECT 3, 'UK8'  UNION ALL
  SELECT 4, 'UK9'  UNION ALL
  SELECT 5, 'UK10' UNION ALL
  SELECT 6, 'UK11'
) AS s
WHERE p.supplierId = @sid
  AND NOT EXISTS (SELECT 1 FROM product_variant v WHERE v.productId = p.productId);

-- ── 3) Images: 2 per product, for our products that don't have images yet ─────
INSERT INTO product_image (productImageId, productId, productImageUrl)
SELECT
  CONCAT('IMG', LPAD(CAST(@ibase + ROW_NUMBER() OVER (ORDER BY p.productId, im.iseq) AS UNSIGNED), 4, '0')),
  p.productId,
  CONCAT('https://loremflickr.com/800/800/sneaker,shoe?lock=', d.seq * 10 + im.iseq)
FROM product p
JOIN _seed_products d
  ON d.name = p.productName AND d.brand = p.productBrand
CROSS JOIN (SELECT 1 AS iseq UNION ALL SELECT 2) AS im
WHERE p.supplierId = @sid
  AND NOT EXISTS (SELECT 1 FROM product_image i WHERE i.productId = p.productId);

DROP TEMPORARY TABLE IF EXISTS _seed_products;

-- Quick check of this supplier's catalog after seeding:
SELECT p.productId, p.productName, p.productBrand, c.categoryName, p.productPrice,
       (SELECT COUNT(*) FROM product_variant v WHERE v.productId = p.productId) AS sizes,
       (SELECT COALESCE(SUM(v.stockQuantity),0) FROM product_variant v WHERE v.productId = p.productId) AS totalStock,
       (SELECT COUNT(*) FROM product_image i WHERE i.productId = p.productId) AS images
  FROM product p
  JOIN category c ON c.categoryId = p.categoryId
 WHERE p.supplierId = @sid
 ORDER BY p.productId;
