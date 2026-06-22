-- In-app notifications + device push tokens.
--
-- `notification` powers the bell in the customer app: the backend inserts a row
-- whenever an order or refund changes status, and the app lists them. This is
-- the in-app notification centre and needs no external service.
--
-- `device_token` stores each device's Firebase Cloud Messaging (FCM) token so
-- the backend can ALSO send a real background push. This is a swap seam: push
-- only fires once FCM is configured (see backend/lib/push.php); until then the
-- in-app notifications work on their own.
--
-- Apply to an existing database that was built before these tables existed:
--   phpMyAdmin -> shoear database -> SQL -> paste -> Go

CREATE TABLE IF NOT EXISTS notification (
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

CREATE TABLE IF NOT EXISTS device_token (
    deviceTokenId VARCHAR(10)  NOT NULL,                    -- DVT0001
    userId        VARCHAR(10)  NOT NULL,                    -- owner
    token         VARCHAR(255) NOT NULL,                    -- the FCM registration token
    platform      VARCHAR(20)  NOT NULL DEFAULT 'android',  -- 'android' | 'ios'
    updatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (deviceTokenId),
    UNIQUE KEY uq_device_token (token),                     -- one row per device token
    KEY idx_device_user (userId)
) ENGINE=InnoDB;
