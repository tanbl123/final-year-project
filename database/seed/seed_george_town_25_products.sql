-- =============================================================================
-- Demo seed: 25 products for supplier "George Town Footwear Sdn Bhd"
-- (account email: timbunleong8@gmail.com)
--
-- Safe & re-runnable:
--   * Supplier is resolved automatically from the account email.
--   * IDs continue from the current MAX and are forced to integers, e.g.
--     PRD0026 (never "PRD26.0").
--   * GLOBAL DUPLICATE GUARD: a product is inserted only if NO product with the
--     same name + brand exists anywhere in the catalog (any supplier). The 25
--     models below were also chosen to not clash with the existing data, so it
--     will not overlap with what the database already has. Re-running adds none.
--   * Each newly-created product gets 6 UK-size variants (with stock) and 2
--     images. Products are inserted as 'Approved'.
--
-- Run:  mysql -u <user> -p <database> < database/seed_george_town_25_products.sql
--       (or paste into the phpMyAdmin SQL tab)
-- =============================================================================

-- Resolve the target supplier by their account email (unique).
SET @sid = (
  SELECT s.supplierId
    FROM supplier s
    JOIN `user` u ON u.userId = s.userId
   WHERE u.email = 'timbunleong8@gmail.com'
   LIMIT 1
);

-- Continue numbering from the current highest VALID id (ignore malformed ids).
SET @pbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productId, 4)        AS UNSIGNED)), 0) FROM product          WHERE productId        REGEXP '^PRD[0-9]+$');
SET @vbase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productVariantId, 4) AS UNSIGNED)), 0) FROM product_variant WHERE productVariantId REGEXP '^VAR[0-9]+$');
SET @ibase = (SELECT COALESCE(MAX(CAST(SUBSTRING(productImageId, 4)   AS UNSIGNED)), 0) FROM product_image   WHERE productImageId   REGEXP '^IMG[0-9]+$');

-- ── The 25 products live in a temp table (referenced by all three inserts). ───
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
  (1,  'CAT0001', 'Vaporfly 3',             'Nike',         1099.00, 'Carbon-plated racing shoe with ZoomX foam and a full-length Flyplate for maximum energy return over marathon distances.'),
  (2,  'CAT0001', 'Adizero Adios Pro 3',    'Adidas',       989.00,  'Marathon racer with energy-rod technology and Lightstrike Pro foam for a propulsive, efficient stride at race pace.'),
  (3,  'CAT0001', 'Novablast 4',            'Asics',        619.00,  'Bouncy, energetic daily trainer with FF BLAST+ ECO foam and a trampoline-inspired outsole for a fun, springy ride.'),
  (4,  'CAT0001', 'FuelCell Rebel v4',      'New Balance',  649.00,  'Lightweight, high-energy trainer with a generous FuelCell midsole for fast, fun daily runs and up-tempo efforts.'),
  (5,  'CAT0001', 'Bondi 8',                'Hoka',         749.00,  'Ultra-cushioned max-comfort trainer with a smooth Meta-Rocker and soft foam for long, easy, protective miles.'),
  (6,  'CAT0001', 'Velocity Nitro 3',       'Puma',         559.00,  'Versatile neutral daily trainer with NITRO foam and a PUMAGRIP outsole for cushioned, everyday road running.'),
  (7,  'CAT0002', 'KD 17',                  'Nike',         799.00,  'Signature performance hoops shoe with full-length Cushlon and Zoom Air for smooth, responsive two-way play.'),
  (8,  'CAT0002', 'Dame 8',                 'Adidas',       599.00,  'Guard shoe with Bounce Pro cushioning and a grippy outsole tuned for quick guards and relentless scoring.'),
  (9,  'CAT0002', 'HOVR Havoc 5',           'Under Armour', 549.00,  'Team basketball shoe with HOVR cushioning and a supportive upper for stability, comfort and court control.'),
  (10, 'CAT0002', 'Clyde All-Pro',          'Puma',         629.00,  'Low-profile hoops shoe with ProFoam+ cushioning and a lightweight build for fast, agile perimeter players.'),
  (11, 'CAT0003', 'Dunk Low',               'Nike',         469.00,  'Retro court-style low-top with crisp leather overlays and classic colour-blocking — a streetwear essential.'),
  (12, 'CAT0003', 'Gazelle',                'Adidas',       429.00,  'Timeless suede low-top with a slim profile and the iconic 3-Stripes — effortless vintage everyday style.'),
  (13, 'CAT0003', '574',                    'New Balance',  479.00,  'The classic all-day sneaker with ENCAP cushioning and a suede/mesh upper — comfortable, versatile heritage style.'),
  (14, 'CAT0003', 'Chuck Taylor All-Star',  'Converse',     289.00,  'The original canvas high-top with timeless styling that pairs with everything, season after season.'),
  (15, 'CAT0003', 'Sk8-Hi',                 'Vans',         359.00,  'Iconic high-top skate shoe with padded collars, durable canvas/suede and the signature side stripe.'),
  (16, 'CAT0003', 'RS-X',                   'Puma',         469.00,  'Chunky retro-tech dad sneaker with bold layering and RS cushioning for a comfortable, statement look.'),
  (17, 'CAT0003', 'Classic Nylon',          'Reebok',       299.00,  'Retro running-inspired sneaker with a soft nylon/suede upper and cushioned EVA midsole for everyday comfort.'),
  (18, 'CAT0004', 'Free Metcon 6',          'Nike',         549.00,  'Flexible hybrid trainer with a stable heel for lifting and a free-flexing forefoot for runs and agility work.'),
  (19, 'CAT0004', 'Nanoflex TR',            'Reebok',       429.00,  'Flexible, budget-friendly gym trainer for HIIT, circuits and light lifting with a grippy, stable base.'),
  (20, 'CAT0004', 'Project Rock BSR 4',     'Under Armour', 569.00,  'Everyday training shoe with a breathable upper and a cushioned, stable platform for gym sessions and conditioning.'),
  (21, 'CAT0004', 'Rapidmove Trainer',      'Adidas',       499.00,  'Versatile studio and gym trainer with responsive cushioning and a flexible outsole for HIIT and cardio.'),
  (22, 'CAT0005', 'Phantom GX 2',           'Nike',         899.00,  'Precision firm-ground boot with a grippy touch texture and Gripknit upper for controlled passing and finishing.'),
  (23, 'CAT0005', 'Copa Pure 2',            'Adidas',       869.00,  'Soft-touch firm-ground boot with a Fusionskin leather-feel upper for a natural, comfortable touch on the ball.'),
  (24, 'CAT0005', 'King Ultimate',          'Puma',         749.00,  'Heritage firm-ground boot reborn with a premium K-leather upper and a soft, cushioned strike zone.'),
  (25, 'CAT0005', 'Tiempo Legend 10',       'Nike',         829.00,  'Classic firm-ground boot with a Tiempo touch-and-comfort leather upper and a cushioned Zoom Air heel unit.');

-- ── 1) Products — insert only names that don't already exist ANYWHERE ─────────
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
   WHERE x.productName = d.name AND x.productBrand = d.brand   -- global: any supplier
);

-- ── 2) Variants: 6 UK sizes for our just-created products (those with none) ───
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

-- ── 3) Images: 2 per product, for our just-created products (those with none) ─
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
