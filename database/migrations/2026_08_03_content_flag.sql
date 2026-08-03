-- Reactive moderation for public customer content (review avatars). Customers
-- flag an inappropriate reviewer; an admin reviews Open flags and can remove the
-- avatar or suspend the user. Named "flag" to avoid clashing with sales Reports.
--
-- MariaDB (XAMPP). Apply: phpMyAdmin → shoear database → SQL → paste → Go

CREATE TABLE IF NOT EXISTS content_flag (
    flagId          VARCHAR(12) NOT NULL,
    reporterUserId  VARCHAR(10) NOT NULL,
    targetUserId    VARCHAR(10) NOT NULL,
    reviewId        VARCHAR(10) NULL,
    reason          VARCHAR(255) NOT NULL,
    flagStatus      ENUM('Open','Resolved','Dismissed') NOT NULL DEFAULT 'Open',
    resolutionNote  VARCHAR(255) NULL,
    reviewedBy      VARCHAR(10)  NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at     DATETIME NULL,
    PRIMARY KEY (flagId),
    KEY idx_flag_status (flagStatus),
    KEY idx_flag_target (targetUserId),
    CONSTRAINT fk_flag_reporter FOREIGN KEY (reporterUserId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_flag_target FOREIGN KEY (targetUserId) REFERENCES `user`(userId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;
