CREATE TABLE IF NOT EXISTS frontdesk_office_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  expense_date DATE NOT NULL,
  category VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  vendor VARCHAR(180),
  amount DECIMAL(15,2) NOT NULL,
  payment_method ENUM('cash','bank','upi','card','other') NOT NULL DEFAULT 'cash',
  receipt_storage_key VARCHAR(500),
  receipt_original_name VARCHAR(255),
  receipt_mime_type VARCHAR(100),
  notes TEXT,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY ix_frontdesk_expense_date (company_id,expense_date),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
