-- Courier vehicle/licence change requests (post-approval re-verification).
-- The vehicle plate and driving-licence fields decide who is legally allowed to
-- deliver, so an approved courier can't silently edit them. Instead they submit
-- a change request; the account stays Active and keeps delivering while an admin
-- reviews it. On approval the proposed values are copied onto the live
-- delivery_personnel row; on rejection the live row is untouched and the courier
-- sees the reason. (Operational fields — name, phone, vehicle type/brand/model,
-- coverage zones — remain instantly editable and never come through here.)
--
-- Apply to an existing database:
--   phpMyAdmin → shoear database → SQL → paste → Go

CREATE TABLE IF NOT EXISTS courier_change_request (
    requestId           VARCHAR(10)  NOT NULL,                 -- CCR0001
    deliveryPersonnelId VARCHAR(10)  NOT NULL,
    vehiclePlate        VARCHAR(20)  NOT NULL,                 -- proposed values
    licenseNumber       VARCHAR(50)  NOT NULL,
    licenseClass        VARCHAR(60)  NOT NULL,                 -- comma-separated, e.g. 'B2,D'
    licenseExpiry       DATE         NULL,
    licensePhotoUrl     VARCHAR(255) NULL,
    requestStatus       ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    reviewNote          VARCHAR(255) NULL,                     -- admin reason on reject
    reviewedBy          VARCHAR(10)  NULL,                     -- admin userId who reviewed
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at         DATETIME     NULL,
    PRIMARY KEY (requestId),
    KEY idx_ccr_courier (deliveryPersonnelId),
    KEY idx_ccr_status (requestStatus),
    CONSTRAINT fk_ccr_courier FOREIGN KEY (deliveryPersonnelId)
        REFERENCES delivery_personnel(deliveryPersonnelId)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;
