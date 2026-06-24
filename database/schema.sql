-- =====================================================================
--  ShoeAR — AR-Based Sport Shoe Virtual Try-On with ML Recommendation
--  MySQL Database Schema (Data Layer)
-- ---------------------------------------------------------------------
--  Derived from the Data Dictionary (Section 4) of the project report.
--  This single database is the shared source of truth for BOTH the
--  web portal (admin + supplier) and the mobile apps (customer +
--  delivery), accessed only through the PHP REST API (three-tier
--  client-server architecture).
--
--  Conventions:
--    * Human-readable string IDs with prefixes (USR0001, PRD0001 ...)
--      exactly as in the report's Data Dictionary.
--    * InnoDB engine + utf8mb4 -> required for transactions, foreign
--      keys, and atomic stock decrement (the "last pair" problem).
--    * Every status field uses an ENUM so invalid states are impossible.
--    * created_at / updated_at added for auditing and reporting.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS shoear
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE shoear;

-- Drop in reverse-dependency order so the script is re-runnable.
DROP TABLE IF EXISTS supplier_change_request;
DROP TABLE IF EXISTS supplier_payout;
DROP TABLE IF EXISTS commission;
DROP TABLE IF EXISTS refund;
DROP TABLE IF EXISTS review;
DROP TABLE IF EXISTS delivery;
DROP TABLE IF EXISTS receipt;
DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS `order`;
DROP TABLE IF EXISTS wishlist_item;
DROP TABLE IF EXISTS wishlist;
DROP TABLE IF EXISTS cart_item;
DROP TABLE IF EXISTS cart;
DROP TABLE IF EXISTS product_model;
DROP TABLE IF EXISTS product_image;
DROP TABLE IF EXISTS product_variant;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS delivery_personnel;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS supplier;
DROP TABLE IF EXISTS admin;
DROP TABLE IF EXISTS `user`;

-- =====================================================================
--  1. USER & ROLE TABLES
--  One base `user` row per account; one role-specific row extends it.
-- =====================================================================

CREATE TABLE `user` (
    userId        VARCHAR(10)  NOT NULL,                 -- USR0001
    username      VARCHAR(50)  NOT NULL,
    password      VARCHAR(255) NULL,                     -- NULL for Google Sign-In-only accounts
    googleId      VARCHAR(255) NULL,                     -- Google sub claim; NULL for email/password accounts
    email         VARCHAR(120) NOT NULL,
    fullName      VARCHAR(120) NOT NULL,
    phoneNumber   VARCHAR(20)  NULL,                     -- NULL for Google users until collected at checkout
    avatarUrl     VARCHAR(255) NULL,                     -- profile picture URL (NULL = initials fallback)
    role          ENUM('Admin','Supplier','Customer','DeliveryPersonnel') NOT NULL,
    -- Pending  : supplier/delivery awaiting admin approval
    -- Active    : approved & usable (customers are Active immediately)
    -- Rejected  : registration rejected — supplier may fix & resubmit
    -- Banned    : registration rejected permanently (terminal)
    -- Suspended : disabled by admin
    -- Deleted   : soft-deleted account
    status        ENUM('Pending','Active','Rejected','Banned','Suspended','Deleted') NOT NULL DEFAULT 'Pending',
    -- why a registration was rejected, shown to the supplier so they know what
    -- to fix before resubmitting; cleared when they resubmit or are approved
    rejectionReason VARCHAR(255) NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (userId),
    UNIQUE KEY uq_user_username (username),
    UNIQUE KEY uq_user_email (email),
    UNIQUE KEY uq_user_googleid (googleId)
) ENGINE=InnoDB;

CREATE TABLE admin (
    adminId   VARCHAR(10) NOT NULL,                       -- ADM0001
    userId    VARCHAR(10) NOT NULL,
    PRIMARY KEY (adminId),
    UNIQUE KEY uq_admin_user (userId),
    CONSTRAINT fk_admin_user FOREIGN KEY (userId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE supplier (
    supplierId      VARCHAR(10)  NOT NULL,                -- SUP0001
    userId          VARCHAR(10)  NOT NULL,
    companyName     VARCHAR(150) NOT NULL,
    companyAddress  VARCHAR(255) NOT NULL,                -- registered business address (matches SSM)
    operationalAddress VARCHAR(255) NOT NULL,             -- where couriers collect orders (pickup); defaults to companyAddress
    businessRegNo   VARCHAR(50)  NOT NULL,                -- SSM / company registration no.
    businessLicenseUrl VARCHAR(255) NOT NULL,             -- uploaded registration certificate
    taxNumber       VARCHAR(50)  NULL,                    -- SST / tax no. (optional)
    bankName          VARCHAR(100) NULL,                  -- supplier's bank, for payouts
    bankAccountName   VARCHAR(150) NULL,                  -- account holder's name
    bankAccountNumber VARCHAR(34)  NULL,                  -- account number
    stripeAccountId VARCHAR(60)  NULL,                    -- Stripe Connect account (acct_...)
    payoutsEnabled  TINYINT(1)   NOT NULL DEFAULT 0,      -- set once Stripe verifies payouts
    PRIMARY KEY (supplierId),
    UNIQUE KEY uq_supplier_user (userId),
    CONSTRAINT fk_supplier_user FOREIGN KEY (userId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customer (
    customerId       VARCHAR(10)  NOT NULL,               -- CUS0001
    userId           VARCHAR(10)  NOT NULL,
    shippingAddress  VARCHAR(255) NULL,
    PRIMARY KEY (customerId),
    UNIQUE KEY uq_customer_user (userId),
    CONSTRAINT fk_customer_user FOREIGN KEY (userId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE delivery_personnel (
    deliveryPersonnelId VARCHAR(10)  NOT NULL,            -- DEL0001
    userId              VARCHAR(10)  NOT NULL,
    vehicleType         ENUM('Motorcycle','Car','Van','Truck') NOT NULL DEFAULT 'Motorcycle',
    vehicleBrand        VARCHAR(50) NOT NULL DEFAULT '',
    vehicleModel        VARCHAR(50) NOT NULL DEFAULT '',
    vehiclePlate        VARCHAR(20) NOT NULL DEFAULT '',
    PRIMARY KEY (deliveryPersonnelId),
    UNIQUE KEY uq_delivery_user (userId),
    CONSTRAINT fk_delivery_user FOREIGN KEY (userId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  2. CATALOG TABLES
-- =====================================================================

CREATE TABLE category (
    categoryId    VARCHAR(10)  NOT NULL,                  -- CAT0001
    categoryName  VARCHAR(80)  NOT NULL,
    PRIMARY KEY (categoryId),
    UNIQUE KEY uq_category_name (categoryName)
) ENGINE=InnoDB;

CREATE TABLE product (
    productId           VARCHAR(10)   NOT NULL,           -- PRD0001
    supplierId          VARCHAR(10)   NOT NULL,
    categoryId          VARCHAR(10)   NOT NULL,
    productName         VARCHAR(150)  NOT NULL,
    productBrand        VARCHAR(80)   NOT NULL,            -- e.g. Nike, Adidas (the shoe's brand, not the supplier)
    productDescription  TEXT          NULL,
    productPrice        DECIMAL(10,2) NOT NULL,
    -- NOTE: stock is NOT stored here. It is tracked PER SIZE in
    -- product_variant (Option B). A product's total stock is the sum of
    -- its variants' stock. See database/NOTES.md.
    -- Pending  : just uploaded, awaiting admin approval
    -- Approved : visible on the platform
    -- Rejected : rejected by admin
    -- Removed  : taken down by supplier/admin (soft delete)
    productStatus       ENUM('Pending','Approved','Rejected','Removed') NOT NULL DEFAULT 'Pending',
    virtualTryOnEnable  BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (productId),
    KEY idx_product_supplier (supplierId),
    KEY idx_product_category (categoryId),
    KEY idx_product_status (productStatus),
    CONSTRAINT fk_product_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_product_category FOREIGN KEY (categoryId) REFERENCES category(categoryId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_product_price CHECK (productPrice >= 0)
) ENGINE=InnoDB;

-- Per-size stock (Option B). Each (product, size) is one sellable variant.
-- The atomic stock decrement at payment runs on THIS table's row:
--   UPDATE product_variant SET stockQuantity = stockQuantity - :qty
--   WHERE productVariantId = :id AND stockQuantity >= :qty;
CREATE TABLE product_variant (
    productVariantId VARCHAR(10) NOT NULL,                -- VAR0001
    productId        VARCHAR(10) NOT NULL,
    size             VARCHAR(10) NOT NULL,                -- e.g. "UK8", "EU42"
    stockQuantity    INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (productVariantId),
    UNIQUE KEY uq_variant_product_size (productId, size), -- a size appears once per product
    KEY idx_variant_product (productId),
    CONSTRAINT fk_variant_product FOREIGN KEY (productId) REFERENCES product(productId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_variant_stock CHECK (stockQuantity >= 0)
) ENGINE=InnoDB;

CREATE TABLE product_image (
    productImageId  VARCHAR(10)  NOT NULL,                -- IMG0001
    productId       VARCHAR(10)  NOT NULL,
    productImageUrl VARCHAR(255) NOT NULL,                -- path / Firebase URL
    PRIMARY KEY (productImageId),
    KEY idx_image_product (productId),
    CONSTRAINT fk_image_product FOREIGN KEY (productId) REFERENCES product(productId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE product_model (
    productModelId  VARCHAR(10)  NOT NULL,                -- MOD0001
    productId       VARCHAR(10)  NOT NULL,
    productModelUrl VARCHAR(255) NOT NULL,                -- .glb/.gltf in Firebase Storage
    PRIMARY KEY (productModelId),
    KEY idx_model_product (productId),
    CONSTRAINT fk_model_product FOREIGN KEY (productId) REFERENCES product(productId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  3. CART & WISHLIST TABLES
-- =====================================================================

CREATE TABLE cart (
    cartId         VARCHAR(10) NOT NULL,                  -- CRT0001
    customerId     VARCHAR(10) NOT NULL,
    cartCreatedAt  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cartId),
    UNIQUE KEY uq_cart_customer (customerId),             -- one active cart per customer
    CONSTRAINT fk_cart_customer FOREIGN KEY (customerId) REFERENCES customer(customerId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cart_item (
    cartItemId        VARCHAR(10)   NOT NULL,             -- CIT0001
    cartId            VARCHAR(10)   NOT NULL,
    productVariantId  VARCHAR(10)   NOT NULL,             -- the specific size chosen
    cartItemQuantity  INT           NOT NULL DEFAULT 1,
    cartItemSubtotal  DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (cartItemId),
    UNIQUE KEY uq_cart_variant (cartId, productVariantId), -- same size once per cart
    KEY idx_cartitem_variant (productVariantId),
    CONSTRAINT fk_cartitem_cart FOREIGN KEY (cartId) REFERENCES cart(cartId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cartitem_variant FOREIGN KEY (productVariantId) REFERENCES product_variant(productVariantId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_cartitem_qty CHECK (cartItemQuantity > 0)
) ENGINE=InnoDB;

CREATE TABLE wishlist (
    wishlistId         VARCHAR(10) NOT NULL,              -- WLT0001
    customerId         VARCHAR(10) NOT NULL,
    wishlistCreatedAt  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wishlistId),
    UNIQUE KEY uq_wishlist_customer (customerId),
    CONSTRAINT fk_wishlist_customer FOREIGN KEY (customerId) REFERENCES customer(customerId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE wishlist_item (
    wishlistItemId  VARCHAR(10) NOT NULL,                 -- WLI0001
    wishlistId      VARCHAR(10) NOT NULL,
    productId       VARCHAR(10) NOT NULL,
    wishlistAddedAt DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wishlistItemId),
    UNIQUE KEY uq_wishlist_product (wishlistId, productId),
    KEY idx_wishlistitem_product (productId),
    CONSTRAINT fk_wishlistitem_wishlist FOREIGN KEY (wishlistId) REFERENCES wishlist(wishlistId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_wishlistitem_product FOREIGN KEY (productId) REFERENCES product(productId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  4. ORDER, PAYMENT & RECEIPT TABLES
-- =====================================================================

CREATE TABLE `order` (
    orderId              VARCHAR(10)   NOT NULL,          -- ORD0001
    customerId           VARCHAR(10)   NOT NULL,
    orderDate            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    orderStatus          ENUM('Placed','Paid','Processing','Shipped',
                              'OutForDelivery','Delivered','Completed','Cancelled')
                              NOT NULL DEFAULT 'Placed',
    orderTotalAmount     DECIMAL(10,2) NOT NULL,
    orderDeliveryAddress VARCHAR(255)  NOT NULL,
    PRIMARY KEY (orderId),
    KEY idx_order_customer (customerId),
    KEY idx_order_status (orderStatus),
    CONSTRAINT fk_order_customer FOREIGN KEY (customerId) REFERENCES customer(customerId)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE order_item (
    orderItemId      VARCHAR(10)   NOT NULL,              -- OIT0001
    orderId          VARCHAR(10)   NOT NULL,
    productVariantId VARCHAR(10)   NOT NULL,              -- the size that was bought
    orderSize        VARCHAR(10)   NOT NULL,              -- size snapshot (kept even if variant changes)
    orderQuantity    INT           NOT NULL,
    orderUnitPrice   DECIMAL(10,2) NOT NULL,              -- price snapshot at purchase time
    orderSubtotal    DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (orderItemId),
    KEY idx_orderitem_order (orderId),
    KEY idx_orderitem_variant (productVariantId),
    CONSTRAINT fk_orderitem_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_orderitem_variant FOREIGN KEY (productVariantId) REFERENCES product_variant(productVariantId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_orderitem_qty CHECK (orderQuantity > 0)
) ENGINE=InnoDB;

CREATE TABLE payment (
    paymentId      VARCHAR(10)   NOT NULL,                -- PAY0001
    orderId        VARCHAR(10)   NOT NULL,
    transactionId  VARCHAR(100)  NULL,                    -- gateway reference (Stripe/PayPal)
    paymentMethod  ENUM('Stripe','PayPal') NOT NULL,
    paymentAmount  DECIMAL(10,2) NOT NULL,
    paymentDate    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paymentStatus  ENUM('Pending','Successful','Failed','Refunded') NOT NULL DEFAULT 'Pending',
    PRIMARY KEY (paymentId),
    UNIQUE KEY uq_payment_order (orderId),
    CONSTRAINT fk_payment_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE receipt (
    receiptId            VARCHAR(10) NOT NULL,            -- RCP0001
    orderId              VARCHAR(10) NOT NULL,
    receiptGeneratedDate DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (receiptId),
    UNIQUE KEY uq_receipt_order (orderId),
    CONSTRAINT fk_receipt_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  5. DELIVERY TABLE
-- =====================================================================

CREATE TABLE delivery (
    deliveryId          VARCHAR(10)  NOT NULL,            -- DLV0001
    orderId             VARCHAR(10)  NOT NULL,
    supplierId          VARCHAR(10)  NOT NULL,            -- one delivery per supplier in the order (split fulfilment)
    deliveryPersonnelId VARCHAR(10)  NULL,                -- assigned later by admin
    deliveryStatus      ENUM('Pending','Assigned','PickedUp',
                            'OutForDelivery','Delivered','Failed')
                            NOT NULL DEFAULT 'Pending',
    deliveryDate        DATETIME     NULL,
    estimatedDeliveryTime DATETIME   NULL,
    otpCode             VARCHAR(10)  NULL,                -- customer confirmation OTP (per parcel)
    proofOfDelivery     VARCHAR(255) NULL,                -- photo path / URL
    PRIMARY KEY (deliveryId),
    UNIQUE KEY uq_delivery_order_supplier (orderId, supplierId),
    KEY idx_delivery_personnel (deliveryPersonnelId),
    KEY idx_delivery_supplier (supplierId),
    KEY idx_delivery_status (deliveryStatus),
    CONSTRAINT fk_delivery_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_delivery_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_delivery_personnel FOREIGN KEY (deliveryPersonnelId) REFERENCES delivery_personnel(deliveryPersonnelId)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- =====================================================================
--  6. REVIEW & RATING TABLE
-- =====================================================================

CREATE TABLE review (
    reviewId      VARCHAR(10) NOT NULL,                   -- REV0001
    customerId    VARCHAR(10) NOT NULL,
    productId     VARCHAR(10) NOT NULL,
    ratingScore   TINYINT     NOT NULL,                   -- 1..5
    reviewComment TEXT        NULL,
    reviewDate    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewStatus  ENUM('Published','Removed') NOT NULL DEFAULT 'Published',
    supplierReply     TEXT     NULL,                     -- supplier's public reply (one per review)
    supplierReplyDate DATETIME NULL,
    PRIMARY KEY (reviewId),
    UNIQUE KEY uq_review_customer_product (customerId, productId), -- one review per product
    KEY idx_review_product (productId),
    CONSTRAINT fk_review_customer FOREIGN KEY (customerId) REFERENCES customer(customerId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_review_product FOREIGN KEY (productId) REFERENCES product(productId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_review_rating CHECK (ratingScore BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- =====================================================================
--  7. REFUND TABLE
-- =====================================================================

CREATE TABLE refund (
    refundId     VARCHAR(10)   NOT NULL,                  -- REF0001
    orderId      VARCHAR(10)   NOT NULL,
    customerId   VARCHAR(10)   NOT NULL,
    refundReason VARCHAR(255)  NOT NULL,
    refundAmount DECIMAL(10,2) NOT NULL,
    refundStatus ENUM('Pending','Approved','Rejected','Completed') NOT NULL DEFAULT 'Pending',
    requestDate  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    refundProof  VARCHAR(255)  NULL,                      -- supporting evidence photo
    PRIMARY KEY (refundId),
    KEY idx_refund_order (orderId),
    KEY idx_refund_customer (customerId),
    KEY idx_refund_status (refundStatus),
    CONSTRAINT fk_refund_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_refund_customer FOREIGN KEY (customerId) REFERENCES customer(customerId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  8. COMMISSION TABLE
--  Admin-configured commission rate applied to supplier sales.
-- =====================================================================

CREATE TABLE commission (
    commissionId        VARCHAR(10)   NOT NULL,           -- COM0001
    adminId             VARCHAR(10)   NOT NULL,
    commissionRateValue DECIMAL(5,2)  NOT NULL,           -- percentage, e.g. 10.00
    effectiveDate       DATETIME      NOT NULL,
    commissionStatus    ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    PRIMARY KEY (commissionId),
    KEY idx_commission_admin (adminId),
    CONSTRAINT fk_commission_admin FOREIGN KEY (adminId) REFERENCES admin(adminId)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_commission_rate CHECK (commissionRateValue >= 0 AND commissionRateValue <= 100)
) ENGINE=InnoDB;

-- Record of money actually paid out to a supplier for an order, via Stripe
-- Connect (separate charges & transfers). The customer pays the platform once
-- (one `payment` row); the platform keeps the commission and sends each
-- supplier their net as a Stripe Transfer — one supplier_payout row per
-- supplier per order. This is the DB-side proof of "each supplier received
-- money", alongside the balances visible in the Stripe dashboard.
CREATE TABLE supplier_payout (
    payoutId         VARCHAR(10)   NOT NULL,             -- PYT0001
    supplierId       VARCHAR(10)   NOT NULL,
    orderId          VARCHAR(10)   NOT NULL,
    stripeTransferId VARCHAR(60)   NULL,                 -- tr_... returned by Stripe
    grossAmount      DECIMAL(10,2) NOT NULL,             -- supplier's share of the order
    commissionAmount DECIMAL(10,2) NOT NULL,             -- platform commission on that share
    netAmount        DECIMAL(10,2) NOT NULL,             -- amount transferred to the supplier
    currency         CHAR(3)       NOT NULL DEFAULT 'myr',
    payoutStatus     ENUM('Pending','Paid','Failed') NOT NULL DEFAULT 'Pending',
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (payoutId),
    KEY idx_payout_supplier (supplierId),
    KEY idx_payout_order (orderId),
    CONSTRAINT fk_payout_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_payout_order FOREIGN KEY (orderId) REFERENCES `order`(orderId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_payout_amounts CHECK (grossAmount >= 0 AND commissionAmount >= 0 AND netAmount >= 0)
) ENGINE=InnoDB;

-- Supplier business-detail change requests (post-approval re-verification).
-- Verified KYB fields (company name, SSM, SST, business document) can't be
-- silently edited after approval; a supplier submits a change request and the
-- account stays Active while an admin reviews it. On approval the proposed
-- values are copied onto the live supplier row; on rejection it's left as-is.
CREATE TABLE supplier_change_request (
    requestId          VARCHAR(10)  NOT NULL,                 -- SCR0001
    supplierId         VARCHAR(10)  NOT NULL,
    companyName        VARCHAR(150) NOT NULL,                 -- proposed values
    companyAddress     VARCHAR(255) NOT NULL,                 -- registered business address (verified)
    businessRegNo      VARCHAR(50)  NOT NULL,
    taxNumber          VARCHAR(50)  NULL,
    businessLicenseUrl VARCHAR(255) NOT NULL,
    requestStatus      ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    reviewNote         VARCHAR(255) NULL,                     -- admin reason on reject
    reviewedBy         VARCHAR(10)  NULL,                     -- admin userId who reviewed
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at        DATETIME     NULL,
    PRIMARY KEY (requestId),
    KEY idx_scr_supplier (supplierId),
    KEY idx_scr_status (requestStatus),
    CONSTRAINT fk_scr_supplier FOREIGN KEY (supplierId) REFERENCES supplier(supplierId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Email-verification codes for supplier registration.
-- Suppliers must prove they own their email before the account is created:
-- the form requests a 6-digit code (emailed to them) and the account is only
-- created once that code is entered back. One pending code per email; only a
-- HASH of the code is stored. See migrations/2026_06_20_email_verification.sql.
CREATE TABLE email_verification (
    email        VARCHAR(120) NOT NULL,                 -- the email being verified
    codeHash     VARCHAR(255) NOT NULL,                 -- bcrypt hash of the 6-digit code
    attempts     INT          NOT NULL DEFAULT 0,       -- failed verify attempts (cap at 5)
    expires_at   DATETIME     NOT NULL,                 -- code is invalid after this
    last_sent_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP, -- for the resend cooldown
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (email)
) ENGINE=InnoDB;

-- Password-reset codes ("forgot password" flow). Same shape as
-- email_verification but kept separate so a reset code and a sign-up code for
-- the same address never collide. A user requests a code (emailed to their
-- registered address) then enters it with a new password. Only a HASH of the
-- code is stored. See migrations/2026_06_20_password_reset.sql.
CREATE TABLE password_reset (
    email        VARCHAR(120) NOT NULL,                 -- the account's email
    codeHash     VARCHAR(255) NOT NULL,                 -- bcrypt hash of the 6-digit code
    attempts     INT          NOT NULL DEFAULT 0,       -- failed verify attempts (cap at 5)
    expires_at   DATETIME     NOT NULL,                 -- code is invalid after this
    last_sent_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP, -- for the resend cooldown
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (email)
) ENGINE=InnoDB;

-- =====================================================================
--  9. NOTIFICATIONS
-- =====================================================================

-- In-app notifications shown in the customer app's bell. The backend inserts a
-- row whenever an order or refund changes status. See
-- migrations/2026_06_22_notifications.sql.
CREATE TABLE notification (
    notificationId VARCHAR(10)  NOT NULL,                  -- NTF0001
    userId         VARCHAR(10)  NOT NULL,                  -- recipient (the customer's userId)
    type           VARCHAR(40)  NOT NULL,                  -- 'order' | 'refund' | 'system'
    title          VARCHAR(120) NOT NULL,
    body           VARCHAR(255) NOT NULL,
    orderId        VARCHAR(10)  NULL,                       -- deep-link target (optional)
    isRead         TINYINT(1)   NOT NULL DEFAULT 0,
    createdAt      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notificationId),
    KEY idx_notification_user (userId, createdAt)
) ENGINE=InnoDB;

-- Device push tokens (Firebase Cloud Messaging) for real background push. Push
-- is a swap seam (backend/lib/push.php): it only fires once FCM is configured.
CREATE TABLE device_token (
    deviceTokenId VARCHAR(10)  NOT NULL,                    -- DVT0001
    userId        VARCHAR(10)  NOT NULL,
    token         VARCHAR(255) NOT NULL,                    -- the FCM registration token
    platform      VARCHAR(20)  NOT NULL DEFAULT 'android',  -- 'android' | 'ios'
    updatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (deviceTokenId),
    UNIQUE KEY uq_device_token (token),
    KEY idx_device_user (userId)
) ENGINE=InnoDB;

-- Delivery issues reported by couriers (the "report an issue" flow). See
-- migrations/2026_06_22_delivery_issue.sql.
CREATE TABLE delivery_issue (
    issueId             VARCHAR(10)  NOT NULL,                 -- ISS0001
    deliveryId          VARCHAR(10)  NOT NULL,
    orderId             VARCHAR(10)  NOT NULL,
    deliveryPersonnelId VARCHAR(10)  NULL,
    reason              VARCHAR(60)  NOT NULL,
    note                VARCHAR(255) NULL,
    photoUrl            VARCHAR(255) NULL,
    issueStatus         ENUM('Open','Resolved') NOT NULL DEFAULT 'Open',
    createdAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolvedAt          DATETIME     NULL,
    PRIMARY KEY (issueId),
    KEY idx_issue_status (issueStatus, createdAt),
    KEY idx_issue_delivery (deliveryId)
) ENGINE=InnoDB;

-- =====================================================================
--  END OF SCHEMA
-- =====================================================================
