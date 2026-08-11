import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { pool } from './db.js';
import { auth } from './middleware/auth.js';

dotenv.config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  } : {})
});

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg','image/png','image/webp','image/gif','image/svg+xml',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv',
      'application/zip','application/x-zip-compressed'
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  }
});

const app = express();
app.use(cors({
  origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(x => x.trim()),
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));

const q = async (sql, p = []) => {
  const [r] = await pool.query(sql, p);
  return r;
};

const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const text = v => String(v ?? '').trim();
const nullable = v => text(v) === '' ? null : v;
const number = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const audit = async (req, action, entityType, entityName) => {
  await q(
    `INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address)
     VALUES (?,?,?,?,?)`,
    [req.user?.id || null, action, entityType, entityName, req.ip]
  );
};

const encryptSecret = value => {
  if (!value) return null;
  const key = crypto.createHash('sha256').update(process.env.JWT_SECRET || 'dev-secret').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
};

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Insight MCSITOBES API' }));

app.post('/api/auth/login', safe(async (req, res) => {
  const { email, password } = req.body;
  const rows = await q('SELECT * FROM users WHERE email=? AND status="active" LIMIT 1', [email]);
  const u = rows[0];
  if (!u || !await bcrypt.compare(password, u.password_hash))
    return res.status(401).json({ message: 'Invalid email or password' });

  const token = jwt.sign(
    { id: u.id, email: u.email, role: u.role },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '12h' }
  );

  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

app.use('/api', auth);

app.get('/api/dashboard', safe(async (req, res) => {
  const [[stats]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE status='active') companies,
      (SELECT COUNT(*) FROM people) people,
      (SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)
       FROM finance_transactions
       WHERE DATE_FORMAT(date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')) cashflow,
      (SELECT COUNT(*) FROM reminders
       WHERE status='pending' AND due_date>=CURDATE()
       AND due_date<=DATE_ADD(CURDATE(),INTERVAL 45 DAY)) reminders
  `);

  const companies = await q(`
    SELECT id,name,industry,sanleo_share
    FROM companies WHERE is_parent=0
    ORDER BY sanleo_share DESC,name
  `);

  const reminders = await q(`
    SELECT r.*,c.name company_name
    FROM reminders r
    LEFT JOIN companies c ON c.id=r.company_id
    WHERE r.status='pending' AND r.due_date>=CURDATE()
    ORDER BY r.due_date LIMIT 6
  `);

  res.json({ stats, companies, reminders });
}));

app.get('/api/company-options', safe(async (req, res) => {
  res.json(await q(`SELECT id,name FROM companies WHERE status='active' ORDER BY is_parent DESC,name`));
}));

app.get('/api/employee-options', safe(async (req, res) => {
  res.json(await q(`
    SELECT e.id,e.name,e.salary,c.name company_name
    FROM employees e
    JOIN companies c ON c.id=e.company_id
    WHERE e.status='Active'
    ORDER BY c.name,e.name
  `));
}));

app.get('/api/companies', safe(async (req, res) => {
  res.json(await q(`SELECT * FROM companies WHERE is_parent=0 ORDER BY name`));
}));

app.post('/api/companies', safe(async (req, res) => {
  const {
    name, legal_name, company_type, industry, sanleo_share, country = 'India',
    currency = 'INR', status = 'active', shareholders = []
  } = req.body;

  if (!text(name)) return res.status(400).json({ message: 'Company name is required' });
  if (!text(industry)) return res.status(400).json({ message: 'Industry is required' });

  const sanleoShare = Number(sanleo_share);
  if (!Number.isFinite(sanleoShare) || sanleoShare < 0 || sanleoShare > 100)
    return res.status(400).json({ message: 'Sanleo share must be between 0 and 100' });

  const cleanShareholders = (Array.isArray(shareholders) ? shareholders : [])
    .filter(s => text(s?.shareholder_name))
    .map(s => ({
      shareholder_name: text(s.shareholder_name),
      shareholder_type: s.shareholder_type === 'Company' ? 'Company' : 'Individual',
      share_percent: Number(s.share_percent)
    }));

  if (cleanShareholders.some(s => !Number.isFinite(s.share_percent) || s.share_percent < 0 || s.share_percent > 100))
    return res.status(400).json({ message: 'Each shareholder percentage must be between 0 and 100' });

  if (cleanShareholders.length) {
    const total = cleanShareholders.reduce((sum, s) => sum + s.share_percent, 0);
    if (Math.abs(total - 100) > 0.001)
      return res.status(400).json({ message: `Shareholder total must be 100%. Current total is ${total}%` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO companies
       (name,legal_name,company_type,industry,is_parent,parent_company_id,sanleo_share,country,currency,status)
       VALUES (?,?,?,?,0,1,?,?,?,?)`,
      [
        text(name), text(legal_name) || text(name),
        company_type || 'Subsidiary / Partner Company',
        text(industry), sanleoShare, country || 'India', currency || 'INR',
        status === 'inactive' ? 'inactive' : 'active'
      ]
    );

    for (const s of cleanShareholders) {
      await conn.query(
        `INSERT INTO company_shareholders
         (company_id,shareholder_name,shareholder_type,share_percent)
         VALUES (?,?,?,?)`,
        [result.insertId, s.shareholder_name, s.shareholder_type, s.share_percent]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address)
       VALUES (?,?,?,?,?)`,
      [req.user?.id || null, 'Created company', 'company', text(name), req.ip]
    );

    await conn.commit();
    const [createdRows] = await conn.query('SELECT * FROM companies WHERE id=?', [result.insertId]);
    res.status(201).json(createdRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

app.get('/api/companies/:id', safe(async (req, res) => {
  const [company] = await q('SELECT * FROM companies WHERE id=?', [req.params.id]);
  if (!company) return res.status(404).json({ message: 'Company not found' });

  const shareholders = await q(
    'SELECT * FROM company_shareholders WHERE company_id=? ORDER BY share_percent DESC',
    [req.params.id]
  );
  const products = await q('SELECT * FROM products WHERE company_id=? ORDER BY name', [req.params.id]);
  res.json({ company, shareholders, products });
}));

// ---------- CREATE RECORDS ----------

app.post('/api/finance', safe(async (req, res) => {
  const { company_id, date, type, category, description, amount, currency = 'INR' } = req.body;
  if (!company_id || !date || !type) return res.status(400).json({ message: 'Company, date and type are required' });
  if (!['income', 'expense', 'capital', 'loan', 'intercompany'].includes(type))
    return res.status(400).json({ message: 'Invalid finance transaction type' });
  if (!Number.isFinite(Number(amount)) || Number(amount) < 0)
    return res.status(400).json({ message: 'Enter a valid amount' });

  const result = await q(
    `INSERT INTO finance_transactions
     (company_id,date,type,category,description,amount,currency)
     VALUES (?,?,?,?,?,?,?)`,
    [company_id, date, type, text(category), text(description), Number(amount), currency || 'INR']
  );
  await audit(req, 'Created finance transaction', 'finance', text(description) || text(category) || `Transaction #${result.insertId}`);
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/people', safe(async (req, res) => {
  const { name, position, primary_company_id, phone, email, notes } = req.body;
  if (!text(name)) return res.status(400).json({ message: 'Name is required' });
  if (!text(position)) return res.status(400).json({ message: 'Position is required' });
  if (!primary_company_id) return res.status(400).json({ message: 'Primary company is required' });

  const result = await q(
    `INSERT INTO people (name,position,primary_company_id,phone,email,notes)
     VALUES (?,?,?,?,?,?)`,
    [text(name), text(position), primary_company_id, text(phone), text(email), text(notes)]
  );
  await audit(req, 'Created key person', 'person', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/employees', safe(async (req, res) => {
  const { company_id, employee_code, name, designation, joining_date, salary, phone, email, status = 'Active' } = req.body;
  if (!company_id || !text(name)) return res.status(400).json({ message: 'Company and employee name are required' });

  const result = await q(
    `INSERT INTO employees
     (company_id,employee_code,name,designation,joining_date,salary,phone,email,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [company_id, text(employee_code), text(name), text(designation), nullable(joining_date), number(salary), text(phone), text(email), status]
  );
  await audit(req, 'Created employee', 'employee', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/payroll', safe(async (req, res) => {
  const { employee_id, month, gross_salary, deduction = 0, status = 'Pending', paid_date } = req.body;
  if (!employee_id || !month) return res.status(400).json({ message: 'Employee and salary month are required' });

  const gross = number(gross_salary);
  const deduct = number(deduction);
  if (gross < 0 || deduct < 0 || deduct > gross)
    return res.status(400).json({ message: 'Check gross salary and deduction values' });

  const net = gross - deduct;
  const result = await q(
    `INSERT INTO payroll
     (employee_id,month,gross_salary,deduction,net_salary,status,paid_date)
     VALUES (?,?,?,?,?,?,?)`,
    [employee_id, month, gross, deduct, net, status, nullable(paid_date)]
  );
  await audit(req, 'Created payroll record', 'payroll', `${month} / employee ${employee_id}`);
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/reminders', safe(async (req, res) => {
  const { company_id, title, category, due_date, priority = 'Medium', status = 'pending', recurrence, notes } = req.body;
  if (!text(title) || !due_date) return res.status(400).json({ message: 'Reminder title and due date are required' });

  const result = await q(
    `INSERT INTO reminders
     (company_id,title,category,due_date,priority,status,recurrence,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [nullable(company_id), text(title), text(category), due_date, priority, status, text(recurrence), text(notes)]
  );
  await audit(req, 'Created reminder', 'reminder', text(title));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/assets', safe(async (req, res) => {
  const {
    company_id, asset_code, name, category, assigned_to, purchase_date,
    purchase_cost, warranty_expiry, status = 'Available'
  } = req.body;
  if (!company_id || !text(name)) return res.status(400).json({ message: 'Company and asset name are required' });

  const result = await q(
    `INSERT INTO assets
     (company_id,asset_code,name,category,assigned_to,purchase_date,purchase_cost,warranty_expiry,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      company_id, text(asset_code), text(name), text(category), text(assigned_to),
      nullable(purchase_date), nullable(purchase_cost), nullable(warranty_expiry), status
    ]
  );
  await audit(req, 'Created asset', 'asset', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/offices', safe(async (req, res) => {
  const {
    company_id, name, city, address, landlord, monthly_rent,
    rent_due_day, lease_start, lease_end, security_deposit
  } = req.body;
  if (!company_id || !text(name)) return res.status(400).json({ message: 'Company and office name are required' });

  const dueDay = nullable(rent_due_day);
  if (dueDay !== null && (Number(dueDay) < 1 || Number(dueDay) > 31))
    return res.status(400).json({ message: 'Rent due day must be between 1 and 31' });

  const result = await q(
    `INSERT INTO offices
     (company_id,name,city,address,landlord,monthly_rent,rent_due_day,lease_start,lease_end,security_deposit)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      company_id, text(name), text(city), text(address), text(landlord), number(monthly_rent),
      dueDay, nullable(lease_start), nullable(lease_end), number(security_deposit)
    ]
  );
  await audit(req, 'Created office', 'office', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/domains', safe(async (req, res) => {
  const { company_id, domain, registrar, expiry_date, auto_renew, status = 'Active' } = req.body;
  if (!company_id || !text(domain)) return res.status(400).json({ message: 'Company and domain are required' });

  const result = await q(
    `INSERT INTO domains (company_id,domain,registrar,expiry_date,auto_renew,status)
     VALUES (?,?,?,?,?,?)`,
    [company_id, text(domain), text(registrar), nullable(expiry_date), auto_renew ? 1 : 0, status]
  );
  await audit(req, 'Created domain record', 'domain', text(domain));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/emails', safe(async (req, res) => {
  const { company_id, email, provider, assigned_to, status = 'Active' } = req.body;
  if (!company_id || !text(email)) return res.status(400).json({ message: 'Company and email are required' });

  const result = await q(
    `INSERT INTO email_accounts (company_id,email,provider,assigned_to,status)
     VALUES (?,?,?,?,?)`,
    [company_id, text(email), text(provider), text(assigned_to), status]
  );
  await audit(req, 'Created email account', 'email', text(email));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/social', safe(async (req, res) => {
  const { company_id, platform, username, url, manager, status = 'Active' } = req.body;
  if (!company_id || !text(platform)) return res.status(400).json({ message: 'Company and platform are required' });

  const result = await q(
    `INSERT INTO social_accounts (company_id,platform,username,url,manager,status)
     VALUES (?,?,?,?,?,?)`,
    [company_id, text(platform), text(username), text(url), text(manager), status]
  );
  await audit(req, 'Created social account', 'social', `${text(platform)} ${text(username)}`);
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/credentials', safe(async (req, res) => {
  const {
    company_id, service_name, username, secret, url,
    twofa_owner, recovery_info, notes
  } = req.body;
  if (!company_id || !text(service_name))
    return res.status(400).json({ message: 'Company and service name are required' });

  const result = await q(
    `INSERT INTO credentials
     (company_id,service_name,username,encrypted_secret,url,twofa_owner,recovery_info,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      company_id, text(service_name), text(username), encryptSecret(secret),
      text(url), text(twofa_owner), text(recovery_info), text(notes)
    ]
  );
  await audit(req, 'Created credential record', 'credential', text(service_name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/files', safe(async (req, res) => {
  const { company_id, name, category, expiry_date, confidential } = req.body;
  if (!company_id || !text(name))
    return res.status(400).json({ message: 'Company and document name are required' });

  const result = await q(
    `INSERT INTO documents (company_id,name,category,expiry_date,confidential)
     VALUES (?,?,?,?,?)`,
    [company_id, text(name), text(category), nullable(expiry_date), confidential ? 1 : 0]
  );
  await audit(req, 'Created document record', 'document', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/products', safe(async (req, res) => {
  const { company_id, name, category, description, status = 'Active', website } = req.body;
  if (!company_id || !text(name))
    return res.status(400).json({ message: 'Company and product name are required' });

  const result = await q(
    `INSERT INTO products (company_id,name,category,description,status,website)
     VALUES (?,?,?,?,?,?)`,
    [company_id, text(name), text(category), text(description), status, text(website)]
  );
  await audit(req, 'Created product/project', 'product', text(name));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/bank-accounts', safe(async (req, res) => {
  const {
    company_id, bank_name, account_name, account_number,
    iban, swift, branch, currency = 'INR', status = 'Active'
  } = req.body;
  if (!company_id || !text(bank_name) || !text(account_number))
    return res.status(400).json({ message: 'Company, bank name and account number are required' });

  const result = await q(
    `INSERT INTO bank_accounts
     (company_id,bank_name,account_name,account_number,iban,swift,branch,currency,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      company_id, text(bank_name), text(account_name), text(account_number),
      text(iban), text(swift), text(branch), currency || 'INR', status
    ]
  );
  await audit(req, 'Created bank account', 'bank_account', `${text(bank_name)} / ${text(account_name)}`);
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/users', safe(async (req, res) => {
  const { name, email, password, role = 'viewer', status = 'active', company_ids = [] } = req.body;
  if (!text(name) || !text(email) || !password)
    return res.status(400).json({ message: 'Name, email and password are required' });
  if (String(password).length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const allowedRoles = ['group_admin', 'company_admin', 'finance', 'hr', 'it_admin', 'viewer'];
  if (!allowedRoles.includes(role))
    return res.status(400).json({ message: 'Invalid user role' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const passwordHash = await bcrypt.hash(String(password), 12);
    const [result] = await conn.query(
      `INSERT INTO users (name,email,password_hash,role,status)
       VALUES (?,?,?,?,?)`,
      [text(name), text(email).toLowerCase(), passwordHash, role, status === 'inactive' ? 'inactive' : 'active']
    );

    const uniqueCompanyIds = [...new Set((Array.isArray(company_ids) ? company_ids : []).map(Number).filter(Boolean))];
    for (const companyId of uniqueCompanyIds) {
      await conn.query(
        `INSERT INTO user_company_access (user_id,company_id,access_role)
         VALUES (?,?,?)`,
        [result.insertId, companyId, role]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address)
       VALUES (?,?,?,?,?)`,
      [req.user?.id || null, 'Created user', 'user', text(email).toLowerCase(), req.ip]
    );

    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'A user with this email already exists' });
    throw err;
  } finally {
    conn.release();
  }
}));



// ---------- AWS S3 FILE MANAGER ----------

const requireS3 = (req, res) => {
  if (!process.env.S3_BUCKET || !process.env.AWS_REGION) {
    res.status(500).json({ message: 'AWS S3 is not configured. Set S3_BUCKET and AWS_REGION in server .env.' });
    return false;
  }
  return true;
};

const safeFileName = name =>
  String(name || 'file')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(-180);

const s3KeyFor = (companyId, folderId, originalName) =>
  `insight/company-${companyId}/${folderId ? `folder-${folderId}/` : 'root/'}${Date.now()}-${crypto.randomUUID()}-${safeFileName(originalName)}`;

const signedFileUrls = async row => {
  if (!row.storage_key || !process.env.S3_BUCKET) return row;

  const previewCommand = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: row.storage_key,
    ResponseContentDisposition: 'inline'
  });

  const downloadCommand = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: row.storage_key,
    ResponseContentDisposition: `attachment; filename="${safeFileName(row.original_name || row.name)}"`
  });

  return {
    ...row,
    preview_url: await getSignedUrl(s3, previewCommand, { expiresIn: 900 }),
    download_url: await getSignedUrl(s3, downloadCommand, { expiresIn: 900 })
  };
};

app.get('/api/file-folders', safe(async (req, res) => {
  const companyId = Number(req.query.company_id);
  if (!companyId) return res.status(400).json({ message: 'company_id is required' });

  const rows = await q(
    `SELECT f.id,f.company_id,f.parent_folder_id,f.name,
            DATE_FORMAT(f.created_at,'%Y-%m-%d %H:%i') created_at,
            (SELECT COUNT(*) FROM document_folders c WHERE c.parent_folder_id=f.id) child_folders,
            (SELECT COUNT(*) FROM documents d WHERE d.folder_id=f.id) file_count
     FROM document_folders f
     WHERE f.company_id=?
     ORDER BY f.name`,
    [companyId]
  );
  res.json(rows);
}));

app.post('/api/file-folders', safe(async (req, res) => {
  const { company_id, parent_folder_id, name } = req.body;
  if (!company_id || !text(name))
    return res.status(400).json({ message: 'Company and folder name are required' });

  if (parent_folder_id) {
    const [parent] = await q(
      'SELECT id FROM document_folders WHERE id=? AND company_id=?',
      [parent_folder_id, company_id]
    );
    if (!parent) return res.status(400).json({ message: 'Parent folder was not found' });
  }

  try {
    const result = await q(
      `INSERT INTO document_folders (company_id,parent_folder_id,name,created_by)
       VALUES (?,?,?,?)`,
      [company_id, nullable(parent_folder_id), text(name), req.user?.id || null]
    );
    await audit(req, 'Created file folder', 'folder', text(name));
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'A folder with this name already exists here.' });
    throw err;
  }
}));

app.put('/api/file-folders/:id', safe(async (req, res) => {
  const { name } = req.body;
  if (!text(name)) return res.status(400).json({ message: 'Folder name is required' });

  const [folder] = await q('SELECT * FROM document_folders WHERE id=?', [req.params.id]);
  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  await q('UPDATE document_folders SET name=? WHERE id=?', [text(name), req.params.id]);
  await audit(req, 'Renamed file folder', 'folder', text(name));
  res.json({ ok: true });
}));

app.delete('/api/file-folders/:id', safe(async (req, res) => {
  const [folder] = await q('SELECT * FROM document_folders WHERE id=?', [req.params.id]);
  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  const [[counts]] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM document_folders WHERE parent_folder_id=?) folders,
      (SELECT COUNT(*) FROM documents WHERE folder_id=?) files`,
    [req.params.id, req.params.id]
  );

  if (Number(counts.folders) || Number(counts.files))
    return res.status(409).json({ message: 'Folder is not empty. Move or delete its files/subfolders first.' });

  await q('DELETE FROM document_folders WHERE id=?', [req.params.id]);
  await audit(req, 'Deleted file folder', 'folder', folder.name);
  res.json({ ok: true });
}));

app.get('/api/files-gallery', safe(async (req, res) => {
  const companyId = Number(req.query.company_id);
  const folderId = req.query.folder_id ? Number(req.query.folder_id) : null;
  if (!companyId) return res.status(400).json({ message: 'company_id is required' });

  const rows = await q(
    `SELECT d.id,d.company_id,d.folder_id,d.name,d.original_name,d.category,d.storage_key,
            d.mime_type,d.file_size,d.expiry_date,d.confidential,
            DATE_FORMAT(d.created_at,'%Y-%m-%d %H:%i') created_at,
            DATE_FORMAT(d.updated_at,'%Y-%m-%d %H:%i') updated_at,
            u.name uploaded_by_name
     FROM documents d
     LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.company_id=? AND ${folderId ? 'd.folder_id=?' : 'd.folder_id IS NULL'}
     ORDER BY d.created_at DESC`,
    folderId ? [companyId, folderId] : [companyId]
  );

  res.json(await Promise.all(rows.map(signedFileUrls)));
}));

app.post('/api/files/upload', fileUpload.array('files', 20), safe(async (req, res) => {
  if (!requireS3(req, res)) return;

  const companyId = Number(req.body.company_id);
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
  const category = text(req.body.category) || 'General';
  const confidential = String(req.body.confidential) === 'true' || String(req.body.confidential) === '1';
  const expiryDate = nullable(req.body.expiry_date);
  const files = req.files || [];

  if (!companyId) return res.status(400).json({ message: 'Company is required' });
  if (!files.length) return res.status(400).json({ message: 'Select at least one file' });

  if (folderId) {
    const [folder] = await q(
      'SELECT id FROM document_folders WHERE id=? AND company_id=?',
      [folderId, companyId]
    );
    if (!folder) return res.status(400).json({ message: 'Selected folder was not found' });
  }

  const uploaded = [];

  for (const file of files) {
    const key = s3KeyFor(companyId, folderId, file.originalname);

    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        company_id: String(companyId),
        uploaded_by: String(req.user?.id || '')
      }
    }));

    try {
      const result = await q(
        `INSERT INTO documents
         (company_id,folder_id,name,original_name,category,storage_key,mime_type,file_size,
          expiry_date,confidential,uploaded_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [
          companyId, folderId, file.originalname, file.originalname, category, key,
          file.mimetype, file.size, expiryDate, confidential ? 1 : 0, req.user?.id || null
        ]
      );
      uploaded.push({ id: result.insertId, name: file.originalname });
      await audit(req, 'Uploaded document', 'document', file.originalname);
    } catch (err) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch(() => {});
      throw err;
    }
  }

  res.status(201).json({ uploaded });
}));

app.put('/api/file-items/:id', safe(async (req, res) => {
  const [file] = await q('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ message: 'File not found' });

  const { name, folder_id, category, expiry_date, confidential } = req.body;

  if (folder_id) {
    const [folder] = await q(
      'SELECT id FROM document_folders WHERE id=? AND company_id=?',
      [folder_id, file.company_id]
    );
    if (!folder) return res.status(400).json({ message: 'Destination folder was not found' });
  }

  await q(
    `UPDATE documents
     SET name=?,folder_id=?,category=?,expiry_date=?,confidential=?
     WHERE id=?`,
    [
      text(name) || file.name,
      nullable(folder_id),
      text(category) || file.category,
      nullable(expiry_date),
      confidential ? 1 : 0,
      req.params.id
    ]
  );

  await audit(req, 'Updated document', 'document', text(name) || file.name);
  res.json({ ok: true });
}));

app.delete('/api/file-items/:id', safe(async (req, res) => {
  if (!requireS3(req, res)) return;

  const [file] = await q('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ message: 'File not found' });

  if (file.storage_key) {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.storage_key
    }));
  }

  await q('DELETE FROM documents WHERE id=?', [req.params.id]);
  await audit(req, 'Deleted document', 'document', file.name);
  res.json({ ok: true });
}));


// ---------- READ / UPDATE / DELETE RECORDS ----------

const crud = {
  finance: {
    table: 'finance_transactions',
    fields: ['company_id','date','type','category','description','amount','currency'],
    detail: `SELECT id,company_id,DATE_FORMAT(date,'%Y-%m-%d') date,type,category,description,amount,currency FROM finance_transactions WHERE id=?`,
    name: r => r.description || r.category || `Finance #${r.id}`
  },
  people: {
    table: 'people',
    fields: ['name','position','primary_company_id','phone','email','notes'],
    detail: `SELECT id,name,position,primary_company_id,phone,email,notes FROM people WHERE id=?`,
    name: r => r.name
  },
  employees: {
    table: 'employees',
    fields: ['company_id','employee_code','name','designation','joining_date','salary','phone','email','status'],
    detail: `SELECT id,company_id,employee_code,name,designation,DATE_FORMAT(joining_date,'%Y-%m-%d') joining_date,salary,phone,email,status FROM employees WHERE id=?`,
    name: r => r.name
  },
  payroll: {
    table: 'payroll',
    fields: ['employee_id','month','gross_salary','deduction','net_salary','status','paid_date'],
    detail: `SELECT id,employee_id,month,gross_salary,deduction,net_salary,status,DATE_FORMAT(paid_date,'%Y-%m-%d') paid_date FROM payroll WHERE id=?`,
    name: r => `${r.month} payroll`
  },
  reminders: {
    table: 'reminders',
    fields: ['company_id','title','category','due_date','priority','status','recurrence','notes'],
    detail: `SELECT id,company_id,title,category,DATE_FORMAT(due_date,'%Y-%m-%d') due_date,priority,status,recurrence,notes FROM reminders WHERE id=?`,
    name: r => r.title
  },
  assets: {
    table: 'assets',
    fields: ['company_id','asset_code','name','category','assigned_to','purchase_date','purchase_cost','warranty_expiry','status'],
    detail: `SELECT id,company_id,asset_code,name,category,assigned_to,DATE_FORMAT(purchase_date,'%Y-%m-%d') purchase_date,purchase_cost,DATE_FORMAT(warranty_expiry,'%Y-%m-%d') warranty_expiry,status FROM assets WHERE id=?`,
    name: r => r.name
  },
  offices: {
    table: 'offices',
    fields: ['company_id','name','city','address','landlord','monthly_rent','rent_due_day','lease_start','lease_end','security_deposit'],
    detail: `SELECT id,company_id,name,city,address,landlord,monthly_rent,rent_due_day,DATE_FORMAT(lease_start,'%Y-%m-%d') lease_start,DATE_FORMAT(lease_end,'%Y-%m-%d') lease_end,security_deposit FROM offices WHERE id=?`,
    name: r => r.name
  },
  domains: {
    table: 'domains',
    fields: ['company_id','domain','registrar','expiry_date','auto_renew','status'],
    detail: `SELECT id,company_id,domain,registrar,DATE_FORMAT(expiry_date,'%Y-%m-%d') expiry_date,auto_renew,status FROM domains WHERE id=?`,
    name: r => r.domain
  },
  emails: {
    table: 'email_accounts',
    fields: ['company_id','email','provider','assigned_to','status'],
    detail: `SELECT id,company_id,email,provider,assigned_to,status FROM email_accounts WHERE id=?`,
    name: r => r.email
  },
  social: {
    table: 'social_accounts',
    fields: ['company_id','platform','username','url','manager','status'],
    detail: `SELECT id,company_id,platform,username,url,manager,status FROM social_accounts WHERE id=?`,
    name: r => `${r.platform} ${r.username || ''}`.trim()
  },
  credentials: {
    table: 'credentials',
    fields: ['company_id','service_name','username','url','twofa_owner','recovery_info','notes'],
    detail: `SELECT id,company_id,service_name,username,url,twofa_owner,recovery_info,notes FROM credentials WHERE id=?`,
    name: r => r.service_name
  },
  files: {
    table: 'documents',
    fields: ['company_id','name','category','expiry_date','confidential'],
    detail: `SELECT id,company_id,name,category,DATE_FORMAT(expiry_date,'%Y-%m-%d') expiry_date,confidential FROM documents WHERE id=?`,
    name: r => r.name
  },
  products: {
    table: 'products',
    fields: ['company_id','name','category','description','status','website'],
    detail: `SELECT id,company_id,name,category,description,status,website FROM products WHERE id=?`,
    name: r => r.name
  },
  'bank-accounts': {
    table: 'bank_accounts',
    fields: ['company_id','bank_name','account_name','account_number','iban','swift','branch','currency','status'],
    detail: `SELECT id,company_id,bank_name,account_name,account_number,iban,swift,branch,currency,status FROM bank_accounts WHERE id=?`,
    name: r => `${r.bank_name} ${r.account_name || ''}`.trim()
  }
};

for (const [path, cfg] of Object.entries(crud)) {
  app.get(`/api/${path}/:id`, safe(async (req, res) => {
    const [row] = await q(cfg.detail, [req.params.id]);
    if (!row) return res.status(404).json({ message: 'Record not found' });
    res.json(row);
  }));

  app.put(`/api/${path}/:id`, safe(async (req, res) => {
    const [before] = await q(cfg.detail, [req.params.id]);
    if (!before) return res.status(404).json({ message: 'Record not found' });

    const body = { ...req.body };

    if (path === 'payroll') {
      const gross = number(body.gross_salary);
      const deduction = number(body.deduction);
      if (deduction > gross) return res.status(400).json({ message: 'Deduction cannot exceed gross salary' });
      body.net_salary = gross - deduction;
    }

    if (path === 'domains' || path === 'files') {
      if ('auto_renew' in body) body.auto_renew = body.auto_renew ? 1 : 0;
      if ('confidential' in body) body.confidential = body.confidential ? 1 : 0;
    }

    const values = cfg.fields.map(field => {
      const v = body[field];
      if (['date','joining_date','paid_date','due_date','purchase_date','warranty_expiry','lease_start','lease_end','expiry_date'].includes(field))
        return nullable(v);
      return v ?? null;
    });

    const setSql = cfg.fields.map(field => `${field}=?`).join(',');
    await q(`UPDATE ${cfg.table} SET ${setSql} WHERE id=?`, [...values, req.params.id]);

    // Credential secret is intentionally updated separately and never returned by GET.
    if (path === 'credentials' && text(req.body.secret)) {
      await q('UPDATE credentials SET encrypted_secret=? WHERE id=?', [encryptSecret(req.body.secret), req.params.id]);
    }

    await audit(req, `Updated ${path}`, path, cfg.name(before));
    res.json({ ok: true });
  }));

  app.delete(`/api/${path}/:id`, safe(async (req, res) => {
    const [before] = await q(cfg.detail, [req.params.id]);
    if (!before) return res.status(404).json({ message: 'Record not found' });

    try {
      const result = await q(`DELETE FROM ${cfg.table} WHERE id=?`, [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ message: 'Record not found' });
      await audit(req, `Deleted ${path}`, path, cfg.name(before));
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED')
        return res.status(409).json({ message: 'This record is used by another record and cannot be deleted yet.' });
      throw err;
    }
  }));
}

// Users need password hashing and company-access handling.
app.get('/api/users/:id', safe(async (req, res) => {
  const [user] = await q(
    `SELECT id,name,email,role,status FROM users WHERE id=?`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ message: 'User not found' });

  const access = await q(
    `SELECT company_id FROM user_company_access WHERE user_id=?`,
    [req.params.id]
  );
  user.company_ids = access.map(x => Number(x.company_id));
  res.json(user);
}));

app.put('/api/users/:id', safe(async (req, res) => {
  const [before] = await q('SELECT id,name,email,role,status FROM users WHERE id=?', [req.params.id]);
  if (!before) return res.status(404).json({ message: 'User not found' });

  const { name, email, password, role = 'viewer', status = 'active', company_ids = [] } = req.body;
  if (!text(name) || !text(email)) return res.status(400).json({ message: 'Name and email are required' });

  const allowedRoles = ['group_admin', 'company_admin', 'finance', 'hr', 'it_admin', 'viewer'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ message: 'Invalid user role' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (text(password)) {
      if (String(password).length < 8)
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      const passwordHash = await bcrypt.hash(String(password), 12);
      await conn.query(
        `UPDATE users SET name=?,email=?,password_hash=?,role=?,status=? WHERE id=?`,
        [text(name), text(email).toLowerCase(), passwordHash, role, status === 'inactive' ? 'inactive' : 'active', req.params.id]
      );
    } else {
      await conn.query(
        `UPDATE users SET name=?,email=?,role=?,status=? WHERE id=?`,
        [text(name), text(email).toLowerCase(), role, status === 'inactive' ? 'inactive' : 'active', req.params.id]
      );
    }

    await conn.query('DELETE FROM user_company_access WHERE user_id=?', [req.params.id]);
    const uniqueCompanyIds = [...new Set((Array.isArray(company_ids) ? company_ids : []).map(Number).filter(Boolean))];

    for (const companyId of uniqueCompanyIds) {
      await conn.query(
        `INSERT INTO user_company_access (user_id,company_id,access_role) VALUES (?,?,?)`,
        [req.params.id, companyId, role]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address)
       VALUES (?,?,?,?,?)`,
      [req.user?.id || null, 'Updated user', 'user', text(email).toLowerCase(), req.ip]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'A user with this email already exists' });
    throw err;
  } finally {
    conn.release();
  }
}));

app.delete('/api/users/:id', safe(async (req, res) => {
  const id = Number(req.params.id);
  if (id === Number(req.user?.id))
    return res.status(400).json({ message: 'You cannot delete the account you are currently logged in with.' });

  const [before] = await q('SELECT id,name,email FROM users WHERE id=?', [id]);
  if (!before) return res.status(404).json({ message: 'User not found' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM user_company_access WHERE user_id=?', [id]);
    await conn.query('UPDATE audit_logs SET user_id=NULL WHERE user_id=?', [id]);
    await conn.query('DELETE FROM users WHERE id=?', [id]);
    await conn.query(
      `INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address)
       VALUES (?,?,?,?,?)`,
      [req.user?.id || null, 'Deleted user', 'user', before.email, req.ip]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));


// ---------- LIST RECORDS ----------

const routes = {
  '/finance': `SELECT f.id,DATE_FORMAT(f.date,'%Y-%m-%d') date,c.name company_name,f.type,f.category,f.description,f.amount FROM finance_transactions f JOIN companies c ON c.id=f.company_id ORDER BY f.date DESC`,
  '/people': `SELECT p.id,p.name,p.position,c.name company_name,p.phone,p.email FROM people p LEFT JOIN companies c ON c.id=p.primary_company_id ORDER BY p.name`,
  '/employees': `SELECT e.id,e.employee_code,e.name,c.name company_name,e.designation,DATE_FORMAT(e.joining_date,'%Y-%m-%d') joining_date,e.salary FROM employees e JOIN companies c ON c.id=e.company_id ORDER BY e.name`,
  '/payroll': `SELECT p.id,p.month,e.name employee_name,c.name company_name,p.gross_salary,p.deduction,p.net_salary,p.status FROM payroll p JOIN employees e ON e.id=p.employee_id JOIN companies c ON c.id=e.company_id ORDER BY p.month DESC`,
  '/reminders': `SELECT r.id,DATE_FORMAT(r.due_date,'%Y-%m-%d') due_date,r.title,c.name company_name,r.category,r.priority,r.status FROM reminders r LEFT JOIN companies c ON c.id=r.company_id ORDER BY r.due_date`,
  '/assets': `SELECT a.id,a.asset_code,a.name,c.name company_name,a.category,a.assigned_to,a.status FROM assets a JOIN companies c ON c.id=a.company_id ORDER BY a.name`,
  '/offices': `SELECT o.id,o.name,c.name company_name,o.city,o.monthly_rent,o.rent_due_day,DATE_FORMAT(o.lease_end,'%Y-%m-%d') lease_end FROM offices o JOIN companies c ON c.id=o.company_id`,
  '/domains': `SELECT d.id,d.domain,c.name company_name,d.registrar,DATE_FORMAT(d.expiry_date,'%Y-%m-%d') expiry_date,d.auto_renew,d.status FROM domains d JOIN companies c ON c.id=d.company_id`,
  '/emails': `SELECT e.id,e.email,c.name company_name,e.provider,e.assigned_to,e.status FROM email_accounts e JOIN companies c ON c.id=e.company_id`,
  '/social': `SELECT s.id,s.platform,s.username,c.name company_name,s.manager,s.status FROM social_accounts s JOIN companies c ON c.id=s.company_id`,
  '/credentials': `SELECT cr.id,cr.service_name,c.name company_name,cr.username,cr.url,cr.twofa_owner,DATE_FORMAT(cr.updated_at,'%Y-%m-%d %H:%i') updated_at FROM credentials cr JOIN companies c ON c.id=cr.company_id`,
  '/files': `SELECT d.id,d.name,c.name company_name,d.category,DATE_FORMAT(d.expiry_date,'%Y-%m-%d') expiry_date,d.confidential,DATE_FORMAT(d.updated_at,'%Y-%m-%d %H:%i') updated_at FROM documents d JOIN companies c ON c.id=d.company_id`,
  '/products': `SELECT p.id,p.name,c.name company_name,p.category,p.status,p.website FROM products p JOIN companies c ON c.id=p.company_id`,
  '/bank-accounts': `SELECT b.id,c.name company_name,b.bank_name,b.account_name,CONCAT('•••• ',RIGHT(b.account_number,4)) masked_account,b.currency,b.status FROM bank_accounts b JOIN companies c ON c.id=b.company_id`,
  '/users': `SELECT u.id,u.name,u.email,u.role,COALESCE(GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', '),'Group / No company') company_access,u.status FROM users u LEFT JOIN user_company_access a ON a.user_id=u.id LEFT JOIN companies c ON c.id=a.company_id GROUP BY u.id,u.name,u.email,u.role,u.status ORDER BY u.name`,
  '/audit': `SELECT a.id,DATE_FORMAT(a.created_at,'%Y-%m-%d %H:%i') created_at,u.name user_name,a.action,a.entity_type,a.entity_name,a.ip_address FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 250`
};

Object.entries(routes).forEach(([path, sql]) =>
  app.get('/api' + path, safe(async (req, res) => res.json(await q(sql))))
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    message: 'Server error',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Insight API running on http://localhost:${port}`));