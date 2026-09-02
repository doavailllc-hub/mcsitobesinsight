ALTER TABLE collection_payments
  ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(60) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS periods_count INT NOT NULL DEFAULT 1 AFTER interest_for_date,
  ADD COLUMN IF NOT EXISTS penalty_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER amount,
  ADD COLUMN IF NOT EXISTS status ENUM('posted','voided') NOT NULL DEFAULT 'posted' AFTER notes,
  ADD COLUMN IF NOT EXISTS voided_by INT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS voided_at DATETIME NULL AFTER voided_by,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(255) NULL AFTER voided_at;

ALTER TABLE frontdesk_office_expenses
  ADD COLUMN IF NOT EXISTS status ENUM('posted','voided') NOT NULL DEFAULT 'posted' AFTER notes,
  ADD COLUMN IF NOT EXISTS voided_by INT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS voided_at DATETIME NULL AFTER voided_by,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(255) NULL AFTER voided_at;

ALTER TABLE frontdesk_cash_entries
  ADD COLUMN IF NOT EXISTS status ENUM('posted','voided') NOT NULL DEFAULT 'posted' AFTER notes,
  ADD COLUMN IF NOT EXISTS voided_by INT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS voided_at DATETIME NULL AFTER voided_by,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(255) NULL AFTER voided_at;

CREATE TABLE IF NOT EXISTS collection_principal_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_type ENUM('additional_loan','principal_repayment') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'cash',
  reference_no VARCHAR(100),
  notes TEXT,
  status ENUM('posted','voided') NOT NULL DEFAULT 'posted',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES collection_customers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  KEY ix_principal_customer_date (customer_id,transaction_date)
);

CREATE TABLE IF NOT EXISTS frontdesk_login_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(80),
  user_agent VARCHAR(500),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_frontdesk_login_user (user_id,login_at)
);
