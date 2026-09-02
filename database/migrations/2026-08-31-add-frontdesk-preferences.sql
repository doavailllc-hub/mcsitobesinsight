CREATE TABLE IF NOT EXISTS frontdesk_user_preferences (
  user_id INT PRIMARY KEY,
  default_company_id INT NOT NULL,
  approved_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (default_company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);
