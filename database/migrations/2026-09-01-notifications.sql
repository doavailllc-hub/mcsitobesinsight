CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  message VARCHAR(700) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'info',
  target_path VARCHAR(255),
  dedupe_key VARCHAR(255),
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_dedupe(user_id,dedupe_key),
  KEY ix_notification_inbox(user_id,is_read,created_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
