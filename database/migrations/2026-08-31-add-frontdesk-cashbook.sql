CREATE TABLE IF NOT EXISTS frontdesk_cash_days (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  cash_date DATE NOT NULL,
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  actual_closing_balance DECIMAL(15,2) NULL,
  closing_notes TEXT,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_by INT NULL,
  closed_at DATETIME NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_frontdesk_cash_day (company_id,cash_date),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS frontdesk_cash_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  entry_date DATE NOT NULL,
  direction ENUM('received','paid') NOT NULL,
  category VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  reference_no VARCHAR(100),
  notes TEXT,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY ix_frontdesk_cash_entry_date (company_id,entry_date),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
