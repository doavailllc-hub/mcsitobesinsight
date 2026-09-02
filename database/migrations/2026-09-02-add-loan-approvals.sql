ALTER TABLE collection_customers
  ADD COLUMN approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER status,
  ADD COLUMN submitted_by INT NULL AFTER approval_status,
  ADD COLUMN reviewed_by INT NULL AFTER submitted_by,
  ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
  ADD COLUMN rejection_reason TEXT NULL AFTER reviewed_at,
  ADD KEY ix_collection_approval (approval_status,company_id),
  ADD CONSTRAINT fk_collection_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_collection_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
