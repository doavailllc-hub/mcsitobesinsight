ALTER TABLE collection_customers
  ADD COLUMN identity_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER rejection_reason,
  ADD COLUMN amount_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER identity_verified,
  ADD COLUMN verification_notes TEXT NULL AFTER amount_verified;
