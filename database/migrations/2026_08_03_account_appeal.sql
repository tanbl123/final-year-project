-- Suspension appeals: when an admin suspends an account we record WHY (reused
-- rejectionReason), issue a one-time appeal token, and email the person a link
-- to a public appeal form. Their appeal lands in account_appeal for the admin
-- to approve (reinstate) or reject.
--
-- Apply on your local XAMPP DB:  mysql -u root shoear < this file

-- One-time token (hash) that authorises the public appeal page for this user.
ALTER TABLE `user`
  ADD COLUMN appealToken VARCHAR(255) NULL AFTER setPasswordExpires;

CREATE TABLE account_appeal (
    appealId     VARCHAR(12)  NOT NULL,                 -- APL0001
    userId       VARCHAR(10)  NOT NULL,
    message      VARCHAR(1000) NOT NULL,                -- the user's appeal text
    appealStatus ENUM('Open','Approved','Rejected') NOT NULL DEFAULT 'Open',
    adminNote    VARCHAR(255) NULL,                     -- admin's decision note (emailed to the user)
    reviewedBy   VARCHAR(10)  NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at  DATETIME     NULL,
    PRIMARY KEY (appealId),
    KEY idx_appeal_user (userId),
    KEY idx_appeal_status (appealStatus),
    CONSTRAINT fk_appeal_user FOREIGN KEY (userId)
        REFERENCES `user`(userId) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;
