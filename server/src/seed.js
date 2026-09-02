import bcrypt from 'bcryptjs'; import {pool} from './db.js';
const password=await bcrypt.hash('Admin@123',12);
const frontdeskPassword=await bcrypt.hash('Frontdesk@123',12);
await pool.query(`INSERT INTO users (name,email,password_hash,role,status) VALUES ('Group Admin','admin@insight.local',?,'group_admin','active') ON DUPLICATE KEY UPDATE name=VALUES(name)`,[password]);
const [frontdesk] = await pool.query(`INSERT INTO users (name,email,password_hash,role,status) VALUES ('Collection Front Desk','frontdesk@insight.local',?,'frontdesk','active') ON DUPLICATE KEY UPDATE name=VALUES(name),password_hash=VALUES(password_hash),role='frontdesk',status='active'`,[frontdeskPassword]);
const [[frontdeskUser]] = await pool.query('SELECT id FROM users WHERE email=?', ['frontdesk@insight.local']);
const [[company]] = await pool.query('SELECT id FROM companies WHERE is_parent=0 ORDER BY id LIMIT 1');
if (frontdeskUser && company) {
  await pool.query(`INSERT INTO user_company_access (user_id,company_id,access_role) VALUES (?,?,'frontdesk') ON DUPLICATE KEY UPDATE access_role='frontdesk'`, [frontdeskUser.id, company.id]);
}
console.log('Seed complete. Admin: admin@insight.local / Admin@123');
console.log('Front desk: frontdesk@insight.local / Frontdesk@123'); await pool.end();
