-- Drop the position / department columns from ar_specialist. They were added by
-- an earlier version of 2026_08_03_ar_specialist_identity.sql but dropped from the
-- design: "position" just restated the AR-Specialist role, and "department" needs a
-- controlled vocabulary to be useful. Only icNumber is kept.
--
-- Run this ONLY if you already applied the earlier 3-column migration. MariaDB
-- (XAMPP); IF EXISTS makes it safe to re-run / safe if the columns aren't there.
-- Apply: phpMyAdmin → shoear database → SQL → paste → Go

ALTER TABLE ar_specialist
  DROP COLUMN IF EXISTS `position`,
  DROP COLUMN IF EXISTS `department`;
