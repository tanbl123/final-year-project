-- Delivery issues reported by couriers (the "report an issue" flow).
--
-- A courier reports a structured reason (+ optional note/photo) when a delivery
-- can't proceed normally. Depending on the reason the parcel is marked Failed
-- or returned to the dispatch queue; either way the issue lands in the admin
-- "Delivery issues" queue and the customer is notified.
--
-- Apply to an existing database:
--   phpMyAdmin -> shoear database -> SQL -> paste -> Go

CREATE TABLE IF NOT EXISTS delivery_issue (
    issueId             VARCHAR(10)  NOT NULL,                 -- ISS0001
    deliveryId          VARCHAR(10)  NOT NULL,
    orderId             VARCHAR(10)  NOT NULL,
    deliveryPersonnelId VARCHAR(10)  NULL,                     -- who reported it
    reason              VARCHAR(60)  NOT NULL,                 -- categorised reason code
    note                VARCHAR(255) NULL,                     -- optional free text
    photoUrl            VARCHAR(255) NULL,                     -- optional evidence photo
    issueStatus         ENUM('Open','Resolved') NOT NULL DEFAULT 'Open',
    createdAt           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolvedAt          DATETIME     NULL,
    PRIMARY KEY (issueId),
    KEY idx_issue_status (issueStatus, createdAt),
    KEY idx_issue_delivery (deliveryId)
) ENGINE=InnoDB;
