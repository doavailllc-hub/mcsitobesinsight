import bcrypt from 'bcryptjs'; import {pool} from './db.js';
const password=await bcrypt.hash('Admin@123',12);
await pool.query(`INSERT INTO users (name,email,password_hash,role,status) VALUES ('Group Admin','admin@insight.local',?,'group_admin','active') ON DUPLICATE KEY UPDATE name=VALUES(name)`,[password]);
console.log('Seed complete. Login: admin@insight.local / Admin@123'); await pool.end();
