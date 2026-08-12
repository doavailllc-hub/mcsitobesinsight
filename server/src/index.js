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
import { buildUserAccess, requirePermission } from './middleware/permissions.js';
import { getAllowedCompanyIds, requireCompanyAccess } from './middleware/companyAccess.js';


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

const allowedSettingKeys = new Set([
  'platform_name',
  'parent_company',
  'base_currency',
  'financial_year',
  'company_address',
  'support_email',
  'logo_url',
  'timezone'
]);

const normalizeSettingValue = value => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const decryptSecret = value => {
  if (!value) return null;
  const parts = String(value).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted secret format');
  }

  const [, ivB64, tagB64, encryptedB64] = parts;
  const key = crypto
    .createHash('sha256')
    .update(process.env.JWT_SECRET || 'dev-secret')
    .digest();

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );

  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

const companyIdsFromAccess = access =>
  Object.keys(access?.companyAccess || {})
    .map(Number)
    .filter(Boolean);

const hasCompanyAccess = (access, companyId) => {
  if (access?.globalRole === 'group_admin') return true;
  return Boolean(access?.companyAccess?.[Number(companyId)]);
};

const hasEffectivePermission = (access, permissionKey, companyId = null) => {
  if (access?.globalRole === 'group_admin') return true;

  if (access?.globalPermissions?.includes(permissionKey)) {
    return true;
  }

  if (companyId) {
    return Boolean(
      access?.companyAccess?.[Number(companyId)]?.permissions?.includes(permissionKey)
    );
  }

  return Object.values(access?.companyAccess || {}).some(entry =>
    entry?.permissions?.includes(permissionKey)
  );
};

const requireEffectivePermission = permissionKey =>
  safe(async (req, res, next) => {
    const access = await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, permissionKey)) {
      return res.status(403).json({
        message: 'You do not have permission to perform this action.',
        permission: permissionKey
      });
    }

    req.access = access;
    next();
  });

const requireGroupAdmin = safe(async (req, res, next) => {
  const access = await buildUserAccess(req.user);

  if (access.globalRole !== 'group_admin') {
    return res.status(403).json({
      message: 'Group Admin access is required.'
    });
  }

  req.access = access;
  next();
});

const requireBodyCompanyAccess = (permissionKey, field = 'company_id') =>
  safe(async (req, res, next) => {
    const access = req.access || await buildUserAccess(req.user);
    const companyId = Number(req.body?.[field]);

    if (!companyId) {
      return res.status(400).json({ message: 'Company is required.' });
    }

    if (!hasEffectivePermission(access, permissionKey, companyId)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    req.access = access;
    next();
  });

const requireQueryCompanyAccess = (permissionKey, field = 'company_id') =>
  safe(async (req, res, next) => {
    const access = req.access || await buildUserAccess(req.user);
    const companyId = Number(req.query?.[field]);

    if (!companyId) {
      return res.status(400).json({ message: 'company_id is required' });
    }

    if (!hasEffectivePermission(access, permissionKey, companyId)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    req.access = access;
    next();
  });

const ensureRecordCompanyAccess = (access, companyId, permissionKey) => {
  if (!hasEffectivePermission(access, permissionKey, companyId)) {
    const err = new Error('You do not have access to this company.');
    err.statusCode = 403;
    throw err;
  }
};

const getEmployeeCompanyId = async employeeId => {
  const [employee] = await q(
    'SELECT company_id FROM employees WHERE id=?',
    [employeeId]
  );
  return employee ? Number(employee.company_id) : null;
};

const getPayrollCompanyId = async payrollId => {
  const [row] = await q(
    `SELECT e.company_id
     FROM payroll p
     JOIN employees e ON e.id=p.employee_id
     WHERE p.id=?`,
    [payrollId]
  );
  return row ? Number(row.company_id) : null;
};

// Production safety: never silently use the development JWT secret.
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret')
) {
  throw new Error('JWT_SECRET must be configured in production');
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  next();
});


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
app.get('/api/auth/me', safe(async (req, res) => {
  const [user] = await q(
    'SELECT id,name,email,role,status FROM users WHERE id=? LIMIT 1',
    [req.user.id]
  );

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const access = await buildUserAccess(user);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: access.globalRole,
      status: user.status
    },
    permissions: access.globalPermissions,
    company_access: access.companyAccess
  });
}));


// ---------- USERS & ACCESS MANAGEMENT ----------

app.get('/api/access/roles',
  requirePermission('users.view'),
  safe(async (req, res) => {
    const rows = await q(
      `SELECT id,role_key,role_name,description
       FROM roles
       WHERE status='active'
       ORDER BY
         CASE role_key
           WHEN 'company_admin' THEN 1
           WHEN 'accountant' THEN 2
           WHEN 'hr_manager' THEN 3
           WHEN 'document_manager' THEN 4
           WHEN 'it_admin' THEN 5
           WHEN 'management_viewer' THEN 6
           WHEN 'viewer' THEN 7
           WHEN 'group_admin' THEN 8
           ELSE 99
         END,
         role_name`
    );
    res.json(rows);
  })
);

app.get('/api/access/users',
  requirePermission('users.view'),
  safe(async (req, res) => {
    const rows = await q(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role AS global_role,
         u.status,
         COALESCE(
           GROUP_CONCAT(
             DISTINCT CONCAT(c.name,' — ',COALESCE(r.role_name,uca.access_role))
             ORDER BY c.name
             SEPARATOR ', '
           ),
           ''
         ) AS company_access
       FROM users u
       LEFT JOIN user_company_access uca ON uca.user_id=u.id
       LEFT JOIN companies c ON c.id=uca.company_id
       LEFT JOIN roles r ON r.id=uca.role_id
       GROUP BY u.id,u.name,u.email,u.role,u.status
       ORDER BY u.name`
    );
    res.json(rows);
  })
);

app.get('/api/access/users/:id',
  requirePermission('users.view'),
  safe(async (req, res) => {
    const [user] = await q(
      `SELECT id,name,email,role,status
       FROM users
       WHERE id=?`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const access = await q(
      `SELECT
         uca.company_id,
         COALESCE(
           r.role_key,
           CASE
             WHEN uca.access_role='finance' THEN 'accountant'
             WHEN uca.access_role='hr' THEN 'hr_manager'
             ELSE uca.access_role
           END
         ) AS role_key
       FROM user_company_access uca
       LEFT JOIN roles r ON r.id=uca.role_id
       WHERE uca.user_id=?
       ORDER BY uca.company_id`,
      [req.params.id]
    );

    res.json({
      ...user,
      access
    });
  })
);

app.post('/api/access/users',
  requirePermission('users.manage'),
  safe(async (req, res) => {
    const { name, email, password, status='active', access=[] } = req.body;

    if (!text(name)) {
      return res.status(400).json({ message: 'Name is required' });
    }

    if (!text(email)) {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters'
      });
    }

    const cleanEmail = text(email).toLowerCase();
    const passwordHash = await bcrypt.hash(String(password), 12);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO users
         (name,email,password_hash,role,status)
         VALUES (?,?,?,?,?)`,
        [
          text(name),
          cleanEmail,
          passwordHash,
          'viewer',
          status === 'inactive' ? 'inactive' : 'active'
        ]
      );

      for (const item of Array.isArray(access) ? access : []) {
        if (!item.company_id || !item.role_key) continue;

        const [roleRows] = await conn.query(
          `SELECT id,role_key
           FROM roles
           WHERE role_key=? AND status='active'
           LIMIT 1`,
          [item.role_key]
        );

        const role = roleRows[0];
        if (!role || role.role_key === 'group_admin') continue;

        await conn.query(
          `INSERT INTO user_company_access
           (user_id,company_id,role_id,access_role)
           VALUES (?,?,?,?)`,
          [result.insertId, item.company_id, role.id, role.role_key]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (user_id,action,entity_type,entity_name,ip_address)
         VALUES (?,?,?,?,?)`,
        [req.user?.id || null, 'Created user access', 'user', cleanEmail, req.ip]
      );

      await conn.commit();
      res.status(201).json({ id: result.insertId });
    } catch (err) {
      await conn.rollback();

      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          message: 'A user with this email already exists'
        });
      }

      throw err;
    } finally {
      conn.release();
    }
  })
);

app.put('/api/access/users/:id',
  requirePermission('users.manage'),
  safe(async (req, res) => {
    const targetId = Number(req.params.id);
    const { name, email, password, status='active', access=[] } = req.body;

    const [existing] = await q(
      'SELECT id,email,role FROM users WHERE id=?',
      [targetId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (existing.role === 'group_admin' && targetId !== Number(req.user.id)) {
      return res.status(400).json({
        message: 'Group Admin accounts must be managed separately.'
      });
    }

    if (!text(name) || !text(email)) {
      return res.status(400).json({
        message: 'Name and email are required'
      });
    }

    if (password && String(password).length < 8) {
      return res.status(400).json({
        message: 'New password must be at least 8 characters'
      });
    }

    const cleanEmail = text(email).toLowerCase();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      if (password) {
        const passwordHash = await bcrypt.hash(String(password), 12);

        await conn.query(
          `UPDATE users
           SET name=?,email=?,password_hash=?,status=?
           WHERE id=?`,
          [
            text(name),
            cleanEmail,
            passwordHash,
            status === 'inactive' ? 'inactive' : 'active',
            targetId
          ]
        );
      } else {
        await conn.query(
          `UPDATE users
           SET name=?,email=?,status=?
           WHERE id=?`,
          [
            text(name),
            cleanEmail,
            status === 'inactive' ? 'inactive' : 'active',
            targetId
          ]
        );
      }

      if (existing.role !== 'group_admin') {
        await conn.query(
          'DELETE FROM user_company_access WHERE user_id=?',
          [targetId]
        );

        for (const item of Array.isArray(access) ? access : []) {
          if (!item.company_id || !item.role_key) continue;

          const [roleRows] = await conn.query(
            `SELECT id,role_key
             FROM roles
             WHERE role_key=? AND status='active'
             LIMIT 1`,
            [item.role_key]
          );

          const role = roleRows[0];
          if (!role || role.role_key === 'group_admin') continue;

          await conn.query(
            `INSERT INTO user_company_access
             (user_id,company_id,role_id,access_role)
             VALUES (?,?,?,?)`,
            [targetId, item.company_id, role.id, role.role_key]
          );
        }
      }

      await conn.query(
        `INSERT INTO audit_logs
         (user_id,action,entity_type,entity_name,ip_address)
         VALUES (?,?,?,?,?)`,
        [req.user?.id || null, 'Updated user access', 'user', cleanEmail, req.ip]
      );

      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();

      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          message: 'A user with this email already exists'
        });
      }

      throw err;
    } finally {
      conn.release();
    }
  })
);

app.put('/api/access/users/:id/status',
  requirePermission('users.manage'),
  safe(async (req, res) => {
    const targetId = Number(req.params.id);
    const status = req.body.status === 'inactive' ? 'inactive' : 'active';

    if (targetId === Number(req.user.id) && status === 'inactive') {
      return res.status(400).json({
        message: 'You cannot deactivate your own account.'
      });
    }

    const [user] = await q(
      'SELECT id,email,role FROM users WHERE id=?',
      [targetId]
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'group_admin') {
      return res.status(400).json({
        message: 'Group Admin cannot be deactivated from this screen.'
      });
    }

    await q(
      'UPDATE users SET status=? WHERE id=?',
      [status, targetId]
    );

    await audit(
      req,
      status === 'active' ? 'Activated user' : 'Deactivated user',
      'user',
      user.email
    );

    res.json({ ok: true });
  })
);

app.put('/api/access/users/:id/password',
  requirePermission('users.manage'),
  safe(async (req, res) => {
    const targetId = Number(req.params.id);
    const { password } = req.body;

    if (!password || String(password).length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters'
      });
    }

    const [user] = await q(
      'SELECT id,email FROM users WHERE id=?',
      [targetId]
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    await q(
      'UPDATE users SET password_hash=? WHERE id=?',
      [passwordHash, targetId]
    );

    await audit(
      req,
      'Reset user password',
      'user',
      user.email
    );

    res.json({ ok: true });
  })
);
app.get(
  '/api/settings',
  requireEffectivePermission('users.manage'),
  safe(async (req, res) => {
    const rows = await q(
      `SELECT
         setting_key,
         setting_value,
         value_type,
         is_public,
         updated_at
       FROM app_settings
       ORDER BY setting_key`
    );

    const settings = {};

    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }

    res.json({
      settings,
      metadata: rows
    });
  })
);

app.put(
  '/api/settings',
  requireEffectivePermission('users.manage'),
  safe(async (req, res) => {
    const incoming = req.body?.settings;

    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({
        message: 'Settings object is required'
      });
    }

    const entries = Object.entries(incoming)
      .filter(([key]) => allowedSettingKeys.has(key));

    if (!entries.length) {
      return res.status(400).json({
        message: 'No valid settings supplied'
      });
    }

    const cleaned = Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        normalizeSettingValue(value)
      ])
    );

    if (!cleaned.platform_name) {
      return res.status(400).json({
        message: 'Platform name is required'
      });
    }

    if (!cleaned.parent_company) {
      return res.status(400).json({
        message: 'Parent company is required'
      });
    }

    if (!cleaned.base_currency) {
      return res.status(400).json({
        message: 'Base currency is required'
      });
    }

    if (!cleaned.financial_year) {
      return res.status(400).json({
        message: 'Financial year is required'
      });
    }

    if (
      cleaned.support_email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.support_email)
    ) {
      return res.status(400).json({
        message: 'Enter a valid support email'
      });
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      for (const [key, value] of Object.entries(cleaned)) {
        await conn.query(
          `INSERT INTO app_settings
           (setting_key, setting_value, value_type, is_public, updated_by)
           VALUES (?, ?, 'string', 1, ?)
           ON DUPLICATE KEY UPDATE
             setting_value = VALUES(setting_value),
             updated_by = VALUES(updated_by)`,
          [
            key,
            value,
            req.user?.id || null
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (user_id, action, entity_type, entity_name, ip_address)
         VALUES (?, ?, ?, ?, ?)`,
        [
          req.user?.id || null,
          'Updated application settings',
          'settings',
          'Group settings',
          req.ip
        ]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const rows = await q(
      `SELECT setting_key, setting_value
       FROM app_settings
       ORDER BY setting_key`
    );

    const settings = {};

    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }

    res.json({
      ok: true,
      settings
    });
  })
);

app.get(
  '/api/dashboard',
  requireEffectivePermission('dashboard.view'),
  safe(async (req, res) => {
    const access = req.access || await buildUserAccess(req.user);

    if (access.globalRole === 'group_admin') {
      const [[stats]] = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM companies WHERE status='active') companies,
          (SELECT COUNT(*) FROM people) people,
          (SELECT COALESCE(SUM(
            CASE WHEN type='income' THEN amount ELSE -amount END
          ),0)
           FROM finance_transactions
           WHERE DATE_FORMAT(date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')) cashflow,
          (SELECT COUNT(*)
           FROM reminders
           WHERE status='pending'
             AND due_date>=CURDATE()
             AND due_date<=DATE_ADD(CURDATE(),INTERVAL 45 DAY)) reminders
      `);

      const companies = await q(`
        SELECT id,name,industry,sanleo_share
        FROM companies
        WHERE is_parent=0
        ORDER BY sanleo_share DESC,name
      `);

      const reminders = await q(`
        SELECT r.*,c.name company_name
        FROM reminders r
        LEFT JOIN companies c ON c.id=r.company_id
        WHERE r.status='pending'
          AND r.due_date>=CURDATE()
        ORDER BY r.due_date
        LIMIT 6
      `);

      return res.json({ stats, companies, reminders });
    }

    const companyIds = companyIdsFromAccess(access);

    if (!companyIds.length) {
      return res.json({
        stats: { companies: 0, people: 0, cashflow: 0, reminders: 0 },
        companies: [],
        reminders: []
      });
    }

    const placeholders = companyIds.map(() => '?').join(',');

    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*)
         FROM companies
         WHERE status='active'
           AND id IN (${placeholders})) companies,
        (SELECT COUNT(*)
         FROM people
         WHERE primary_company_id IN (${placeholders})) people,
        (SELECT COALESCE(SUM(
           CASE WHEN type='income' THEN amount ELSE -amount END
         ),0)
         FROM finance_transactions
         WHERE company_id IN (${placeholders})
           AND DATE_FORMAT(date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')) cashflow,
        (SELECT COUNT(*)
         FROM reminders
         WHERE company_id IN (${placeholders})
           AND status='pending'
           AND due_date>=CURDATE()
           AND due_date<=DATE_ADD(CURDATE(),INTERVAL 45 DAY)) reminders`,
      [...companyIds, ...companyIds, ...companyIds, ...companyIds]
    );

    const companies = await q(
      `SELECT id,name,industry,sanleo_share
       FROM companies
       WHERE is_parent=0
         AND id IN (${placeholders})
       ORDER BY sanleo_share DESC,name`,
      companyIds
    );

    const reminders = await q(
      `SELECT r.*,c.name company_name
       FROM reminders r
       LEFT JOIN companies c ON c.id=r.company_id
       WHERE r.company_id IN (${placeholders})
         AND r.status='pending'
         AND r.due_date>=CURDATE()
       ORDER BY r.due_date
       LIMIT 6`,
      companyIds
    );

    res.json({ stats, companies, reminders });
  })
);

app.get('/api/company-options', requireEffectivePermission('dashboard.view'), safe(async (req, res) => {
  const access = await buildUserAccess(req.user);

  if (access.globalRole === 'group_admin') {
    return res.json(
      await q(
        `SELECT id,name
         FROM companies
         WHERE status='active'
         ORDER BY is_parent DESC,name`
      )
    );
  }

  const companyIds = Object.keys(access.companyAccess || {})
    .map(Number)
    .filter(Boolean);

  if (!companyIds.length) {
    return res.json([]);
  }

  const placeholders = companyIds.map(() => '?').join(',');

  res.json(
    await q(
      `SELECT id,name
       FROM companies
       WHERE status='active'
         AND id IN (${placeholders})
       ORDER BY name`,
      companyIds
    )
  );
}));

app.get('/api/employee-options', requireEffectivePermission('employees.view'), safe(async (req, res) => {
  const access = await buildUserAccess(req.user);

  if (access.globalRole === 'group_admin') {
    return res.json(
      await q(`
        SELECT e.id,e.name,e.salary,c.name AS company_name
        FROM employees e
        JOIN companies c ON c.id=e.company_id
        WHERE e.status='Active'
        ORDER BY c.name,e.name
      `)
    );
  }

  const companyIds = Object.keys(access.companyAccess || {})
    .map(Number)
    .filter(Boolean);

  if (!companyIds.length) {
    return res.json([]);
  }

  const placeholders = companyIds.map(() => '?').join(',');

  res.json(
    await q(
      `SELECT e.id,e.name,e.salary,c.name AS company_name
       FROM employees e
       JOIN companies c ON c.id=e.company_id
       WHERE e.status='Active'
         AND e.company_id IN (${placeholders})
       ORDER BY c.name,e.name`,
      companyIds
    )
  );
}));

// ---------- COMPANIES ----------

app.get(
  '/api/companies',
  requireEffectivePermission('companies.view'),
  safe(async (req, res) => {
    const access = req.access || await buildUserAccess(req.user);

    if (access.globalRole === 'group_admin') {
      return res.json(
        await q(`SELECT * FROM companies WHERE is_parent=0 ORDER BY name`)
      );
    }

    const companyIds = companyIdsFromAccess(access);
    if (!companyIds.length) return res.json([]);

    const placeholders = companyIds.map(() => '?').join(',');

    res.json(
      await q(
        `SELECT *
         FROM companies
         WHERE is_parent=0
           AND id IN (${placeholders})
         ORDER BY name`,
        companyIds
      )
    );
  })
);

app.post(
  '/api/companies',
  requireEffectivePermission('companies.manage'),
  safe(async (req, res) => {
    const {
      name,
      legal_name,
      company_type,
      industry,
      sanleo_share,
      country='India',
      currency='INR',
      status='active',
      shareholders=[]
    } = req.body;

    if (!text(name)) {
      return res.status(400).json({ message: 'Company name is required' });
    }

    if (!text(industry)) {
      return res.status(400).json({ message: 'Industry is required' });
    }

    const sanleoShare = Number(sanleo_share);

    if (
      !Number.isFinite(sanleoShare) ||
      sanleoShare < 0 ||
      sanleoShare > 100
    ) {
      return res.status(400).json({
        message: 'Sanleo share must be between 0 and 100'
      });
    }

    const cleanShareholders = (Array.isArray(shareholders) ? shareholders : [])
      .filter(s => text(s?.shareholder_name))
      .map(s => ({
        shareholder_name: text(s.shareholder_name),
        shareholder_type:
          s.shareholder_type === 'Company' ? 'Company' : 'Individual',
        share_percent: Number(s.share_percent)
      }));

    if (
      cleanShareholders.some(
        s =>
          !Number.isFinite(s.share_percent) ||
          s.share_percent < 0 ||
          s.share_percent > 100
      )
    ) {
      return res.status(400).json({
        message: 'Each shareholder percentage must be between 0 and 100'
      });
    }

    if (cleanShareholders.length) {
      const total = cleanShareholders.reduce(
        (sum, s) => sum + s.share_percent,
        0
      );

      if (Math.abs(total - 100) > 0.001) {
        return res.status(400).json({
          message: `Shareholder total must be 100%. Current total is ${total}%`
        });
      }
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO companies
         (name,legal_name,company_type,industry,is_parent,parent_company_id,
          sanleo_share,country,currency,status)
         VALUES (?,?,?,?,0,1,?,?,?,?)`,
        [
          text(name),
          text(legal_name) || text(name),
          company_type || 'Subsidiary / Partner Company',
          text(industry),
          sanleoShare,
          country || 'India',
          currency || 'INR',
          status === 'inactive' ? 'inactive' : 'active'
        ]
      );

      for (const s of cleanShareholders) {
        await conn.query(
          `INSERT INTO company_shareholders
           (company_id,shareholder_name,shareholder_type,share_percent)
           VALUES (?,?,?,?)`,
          [
            result.insertId,
            s.shareholder_name,
            s.shareholder_type,
            s.share_percent
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (user_id,action,entity_type,entity_name,ip_address)
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Created company',
          'company',
          text(name),
          req.ip
        ]
      );

      await conn.commit();

      const [createdRows] = await conn.query(
        'SELECT * FROM companies WHERE id=?',
        [result.insertId]
      );

      res.status(201).json(createdRows[0]);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

app.get(
  '/api/companies/:id',
  requireEffectivePermission('companies.view'),
  safe(async (req, res) => {
    const companyId = Number(req.params.id);
    const access = req.access || await buildUserAccess(req.user);

    if (!hasCompanyAccess(access, companyId)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    const [company] = await q(
      'SELECT * FROM companies WHERE id=?',
      [companyId]
    );

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const shareholders = await q(
      `SELECT *
       FROM company_shareholders
       WHERE company_id=?
       ORDER BY share_percent DESC`,
      [companyId]
    );

    const products = await q(
      `SELECT *
       FROM products
       WHERE company_id=?
       ORDER BY name`,
      [companyId]
    );

    res.json({ company, shareholders, products });
  })
);

app.put(
  '/api/companies/:id',
  requireEffectivePermission('companies.manage'),
  safe(async (req, res) => {
    const companyId = Number(req.params.id);

    const [existing] = await q(
      'SELECT * FROM companies WHERE id=? AND is_parent=0',
      [companyId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const {
      name,
      legal_name,
      company_type,
      industry,
      sanleo_share,
      country='India',
      currency='INR',
      status='active',
      shareholders=[]
    } = req.body;

    if (!text(name) || !text(industry)) {
      return res.status(400).json({
        message: 'Company name and industry are required'
      });
    }

    const sanleoShare = Number(sanleo_share);

    if (
      !Number.isFinite(sanleoShare) ||
      sanleoShare < 0 ||
      sanleoShare > 100
    ) {
      return res.status(400).json({
        message: 'Sanleo share must be between 0 and 100'
      });
    }

    const cleanShareholders = (Array.isArray(shareholders) ? shareholders : [])
      .filter(s => text(s?.shareholder_name))
      .map(s => ({
        shareholder_name: text(s.shareholder_name),
        shareholder_type:
          s.shareholder_type === 'Company' ? 'Company' : 'Individual',
        share_percent: Number(s.share_percent)
      }));

    if (cleanShareholders.length) {
      const total = cleanShareholders.reduce(
        (sum, s) => sum + s.share_percent,
        0
      );

      if (
        cleanShareholders.some(
          s =>
            !Number.isFinite(s.share_percent) ||
            s.share_percent < 0 ||
            s.share_percent > 100
        ) ||
        Math.abs(total - 100) > 0.001
      ) {
        return res.status(400).json({
          message: 'Shareholder percentages must be valid and total 100%'
        });
      }
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE companies
         SET name=?,legal_name=?,company_type=?,industry=?,sanleo_share=?,
             country=?,currency=?,status=?
         WHERE id=?`,
        [
          text(name),
          text(legal_name) || text(name),
          company_type || existing.company_type,
          text(industry),
          sanleoShare,
          country || 'India',
          currency || 'INR',
          status === 'inactive' ? 'inactive' : 'active',
          companyId
        ]
      );

      await conn.query(
        'DELETE FROM company_shareholders WHERE company_id=?',
        [companyId]
      );

      for (const s of cleanShareholders) {
        await conn.query(
          `INSERT INTO company_shareholders
           (company_id,shareholder_name,shareholder_type,share_percent)
           VALUES (?,?,?,?)`,
          [
            companyId,
            s.shareholder_name,
            s.shareholder_type,
            s.share_percent
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (user_id,action,entity_type,entity_name,ip_address)
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Updated company',
          'company',
          text(name),
          req.ip
        ]
      );

      await conn.commit();
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

app.delete(
  '/api/companies/:id',
  requireEffectivePermission('companies.manage'),
  safe(async (req, res) => {
    const companyId = Number(req.params.id);

    const [existing] = await q(
      'SELECT id,name,is_parent FROM companies WHERE id=?',
      [companyId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Company not found' });
    }

    if (existing.is_parent) {
      return res.status(400).json({
        message: 'The parent holding company cannot be deleted.'
      });
    }

    try {
      await q('DELETE FROM companies WHERE id=?', [companyId]);

      await audit(
        req,
        'Deleted company',
        'company',
        existing.name
      );

      res.json({ ok: true });
    } catch (err) {
      if (
        err.code === 'ER_ROW_IS_REFERENCED_2' ||
        err.code === 'ER_ROW_IS_REFERENCED'
      ) {
        return res.status(409).json({
          message:
            'This company has related records. Deactivate it instead of deleting it.'
        });
      }

      throw err;
    }
  })
);

// ---------- CREATE RECORDS ----------

app.post(
  '/api/finance',
  requireEffectivePermission('finance.create'),
  requireBodyCompanyAccess('finance.create'),
  safe(async (req, res) => {

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

app.post('/api/people', requireEffectivePermission('people.manage'), requireBodyCompanyAccess('people.manage','primary_company_id'), safe(async (req, res) => {
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

app.post('/api/employees', requireEffectivePermission('employees.manage'), requireBodyCompanyAccess('employees.manage'), safe(async (req, res) => {
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

app.post('/api/payroll', requireEffectivePermission('payroll.manage'), safe(async (req, res) => {
  const { employee_id, month, gross_salary, deduction = 0, status = 'Pending', paid_date } = req.body;
  if (!employee_id || !month) return res.status(400).json({ message: 'Employee and salary month are required' });

  const access = req.access || await buildUserAccess(req.user);
  const employeeCompanyId = await getEmployeeCompanyId(employee_id);

  if (!employeeCompanyId) {
    return res.status(400).json({ message: 'Employee not found' });
  }

  if (!hasEffectivePermission(access, 'payroll.manage', employeeCompanyId)) {
    return res.status(403).json({
      message: 'You do not have access to this employee company.'
    });
  }

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

app.post('/api/reminders', requireEffectivePermission('reminders.manage'), safe(async (req, res) => {
  const { company_id, title, category, due_date, priority = 'Medium', status = 'pending', recurrence, notes } = req.body;
  if (!text(title) || !due_date) return res.status(400).json({ message: 'Reminder title and due date are required' });

  const access = req.access || await buildUserAccess(req.user);

  if (access.globalRole !== 'group_admin') {
    if (!company_id) {
      return res.status(400).json({
        message: 'Company is required for this reminder.'
      });
    }

    if (!hasEffectivePermission(access, 'reminders.manage', company_id)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }
  }

  const result = await q(
    `INSERT INTO reminders
     (company_id,title,category,due_date,priority,status,recurrence,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [nullable(company_id), text(title), text(category), due_date, priority, status, text(recurrence), text(notes)]
  );
  await audit(req, 'Created reminder', 'reminder', text(title));
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/assets', requireEffectivePermission('assets.manage'), requireBodyCompanyAccess('assets.manage'), safe(async (req, res) => {
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

app.post('/api/offices', requireEffectivePermission('offices.manage'), requireBodyCompanyAccess('offices.manage'), safe(async (req, res) => {
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

app.post('/api/domains', requireEffectivePermission('domains.manage'), requireBodyCompanyAccess('domains.manage'), safe(async (req, res) => {
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

app.post('/api/emails', requireEffectivePermission('emails.manage'), requireBodyCompanyAccess('emails.manage'), safe(async (req, res) => {
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

app.post('/api/social', requireEffectivePermission('social.manage'), requireBodyCompanyAccess('social.manage'), safe(async (req, res) => {
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

app.post('/api/credentials', requireEffectivePermission('credentials.manage'), requireBodyCompanyAccess('credentials.manage'), safe(async (req, res) => {
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

app.post('/api/files', requireEffectivePermission('files.manage'), requireBodyCompanyAccess('files.manage'), safe(async (req, res) => {
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

app.post('/api/products', requireEffectivePermission('products.manage'), requireBodyCompanyAccess('products.manage'), safe(async (req, res) => {
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

app.post('/api/bank-accounts', requireEffectivePermission('bank.manage'), requireBodyCompanyAccess('bank.manage'), safe(async (req, res) => {
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

app.post('/api/users', requireGroupAdmin, safe(async (req, res) => {
  const { name, email, password, role = 'viewer', status = 'active', company_ids = [] } = req.body;
  if (!text(name) || !text(email) || !password)
    return res.status(400).json({ message: 'Name, email and password are required' });
  if (String(password).length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const allowedRoles = ['group_admin', 'company_admin', 'accountant', 'hr_manager', 'document_manager', 'it_admin', 'management_viewer', 'viewer'];
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

app.get('/api/file-folders', requireEffectivePermission('files.view'), requireQueryCompanyAccess('files.view'), safe(async (req, res) => {
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

app.post('/api/file-folders', requireEffectivePermission('files.manage'), requireBodyCompanyAccess('files.manage'), safe(async (req, res) => {
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

app.put('/api/file-folders/:id', requireEffectivePermission('files.manage'), safe(async (req, res) => {
  const { name } = req.body;
  if (!text(name)) return res.status(400).json({ message: 'Folder name is required' });

  const [folder] = await q('SELECT * FROM document_folders WHERE id=?', [req.params.id]);
  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  const access = req.access || await buildUserAccess(req.user);
  if (!hasEffectivePermission(access, 'files.manage', folder.company_id)) {
    return res.status(403).json({
      message: 'You do not have access to this company.'
    });
  }

  await q('UPDATE document_folders SET name=? WHERE id=?', [text(name), req.params.id]);
  await audit(req, 'Renamed file folder', 'folder', text(name));
  res.json({ ok: true });
}));

app.delete('/api/file-folders/:id', requireEffectivePermission('files.manage'), safe(async (req, res) => {
  const [folder] = await q('SELECT * FROM document_folders WHERE id=?', [req.params.id]);
  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  const access = req.access || await buildUserAccess(req.user);
  if (!hasEffectivePermission(access, 'files.manage', folder.company_id)) {
    return res.status(403).json({
      message: 'You do not have access to this company.'
    });
  }

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

app.get('/api/files-gallery', requireEffectivePermission('files.view'), requireQueryCompanyAccess('files.view'), safe(async (req, res) => {
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

app.post('/api/files/upload', requireEffectivePermission('files.upload'), fileUpload.array('files', 20), safe(async (req, res) => {
  if (!requireS3(req, res)) return;

  const companyId = Number(req.body.company_id);
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
  const access = req.access || await buildUserAccess(req.user);

  if (!hasEffectivePermission(access, 'files.upload', companyId)) {
    return res.status(403).json({
      message: 'You do not have access to this company.'
    });
  }
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

app.put('/api/file-items/:id', requireEffectivePermission('files.manage'), safe(async (req, res) => {
  const [file] = await q('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ message: 'File not found' });

  const access = req.access || await buildUserAccess(req.user);
  if (!hasEffectivePermission(access, 'files.manage', file.company_id)) {
    return res.status(403).json({
      message: 'You do not have access to this company.'
    });
  }

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

app.delete('/api/file-items/:id', requireEffectivePermission('files.manage'), safe(async (req, res) => {
  if (!requireS3(req, res)) return;

  const [file] = await q('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ message: 'File not found' });

  const access = req.access || await buildUserAccess(req.user);
  if (!hasEffectivePermission(access, 'files.manage', file.company_id)) {
    return res.status(403).json({
      message: 'You do not have access to this company.'
    });
  }

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


// ---------- SECURE READ / UPDATE / DELETE RECORDS ----------

const crud = {
  people: {
    table: 'people',
    fields: ['name','position','primary_company_id','phone','email','notes'],
    detail: `SELECT id,name,position,primary_company_id,phone,email,notes
             FROM people WHERE id=?`,
    viewPermission: 'people.view',
    managePermission: 'people.manage',
    companyFromRow: row => Number(row.primary_company_id),
    companyFromBody: body => Number(body.primary_company_id),
    name: row => row.name
  },
  employees: {
    table: 'employees',
    fields: [
      'company_id','employee_code','name','designation','joining_date',
      'salary','phone','email','status'
    ],
    detail: `SELECT id,company_id,employee_code,name,designation,
                    DATE_FORMAT(joining_date,'%Y-%m-%d') joining_date,
                    salary,phone,email,status
             FROM employees WHERE id=?`,
    viewPermission: 'employees.view',
    managePermission: 'employees.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.name
  },
  payroll: {
    table: 'payroll',
    fields: [
      'employee_id','month','gross_salary','deduction','net_salary',
      'status','paid_date'
    ],
    detail: `SELECT p.id,p.employee_id,p.month,p.gross_salary,p.deduction,
                    p.net_salary,p.status,
                    DATE_FORMAT(p.paid_date,'%Y-%m-%d') paid_date,
                    e.company_id
             FROM payroll p
             JOIN employees e ON e.id=p.employee_id
             WHERE p.id=?`,
    viewPermission: 'payroll.view',
    managePermission: 'payroll.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBodyAsync: async body =>
      await getEmployeeCompanyId(body.employee_id),
    name: row => `${row.month} payroll`
  },
  reminders: {
    table: 'reminders',
    fields: [
      'company_id','title','category','due_date','priority','status',
      'recurrence','notes'
    ],
    detail: `SELECT id,company_id,title,category,
                    DATE_FORMAT(due_date,'%Y-%m-%d') due_date,
                    priority,status,recurrence,notes
             FROM reminders WHERE id=?`,
    viewPermission: 'reminders.view',
    managePermission: 'reminders.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    allowGroupOnlyNullCompany: true,
    name: row => row.title
  },
  assets: {
    table: 'assets',
    fields: [
      'company_id','asset_code','name','category','assigned_to',
      'purchase_date','purchase_cost','warranty_expiry','status'
    ],
    detail: `SELECT id,company_id,asset_code,name,category,assigned_to,
                    DATE_FORMAT(purchase_date,'%Y-%m-%d') purchase_date,
                    purchase_cost,
                    DATE_FORMAT(warranty_expiry,'%Y-%m-%d') warranty_expiry,
                    status
             FROM assets WHERE id=?`,
    viewPermission: 'assets.view',
    managePermission: 'assets.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.name
  },
  offices: {
    table: 'offices',
    fields: [
      'company_id','name','city','address','landlord','monthly_rent',
      'rent_due_day','lease_start','lease_end','security_deposit'
    ],
    detail: `SELECT id,company_id,name,city,address,landlord,monthly_rent,
                    rent_due_day,
                    DATE_FORMAT(lease_start,'%Y-%m-%d') lease_start,
                    DATE_FORMAT(lease_end,'%Y-%m-%d') lease_end,
                    security_deposit
             FROM offices WHERE id=?`,
    viewPermission: 'offices.view',
    managePermission: 'offices.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.name
  },
  domains: {
    table: 'domains',
    fields: [
      'company_id','domain','registrar','expiry_date','auto_renew','status'
    ],
    detail: `SELECT id,company_id,domain,registrar,
                    DATE_FORMAT(expiry_date,'%Y-%m-%d') expiry_date,
                    auto_renew,status
             FROM domains WHERE id=?`,
    viewPermission: 'domains.view',
    managePermission: 'domains.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.domain
  },
  emails: {
    table: 'email_accounts',
    fields: ['company_id','email','provider','assigned_to','status'],
    detail: `SELECT id,company_id,email,provider,assigned_to,status
             FROM email_accounts WHERE id=?`,
    viewPermission: 'emails.view',
    managePermission: 'emails.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.email
  },
  social: {
    table: 'social_accounts',
    fields: [
      'company_id','platform','username','url','manager','status'
    ],
    detail: `SELECT id,company_id,platform,username,url,manager,status
             FROM social_accounts WHERE id=?`,
    viewPermission: 'social.view',
    managePermission: 'social.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => `${row.platform} ${row.username || ''}`.trim()
  },
  credentials: {
    table: 'credentials',
    fields: [
      'company_id','service_name','username','url','twofa_owner',
      'recovery_info','notes'
    ],
    detail: `SELECT id,company_id,service_name,username,url,twofa_owner,
                    recovery_info,notes
             FROM credentials WHERE id=?`,
    viewPermission: 'credentials.view',
    managePermission: 'credentials.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.service_name
  },
  files: {
    table: 'documents',
    fields: [
      'company_id','name','category','expiry_date','confidential'
    ],
    detail: `SELECT id,company_id,name,category,
                    DATE_FORMAT(expiry_date,'%Y-%m-%d') expiry_date,
                    confidential
             FROM documents WHERE id=?`,
    viewPermission: 'files.view',
    managePermission: 'files.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.name
  },
  products: {
    table: 'products',
    fields: [
      'company_id','name','category','description','status','website'
    ],
    detail: `SELECT id,company_id,name,category,description,status,website
             FROM products WHERE id=?`,
    viewPermission: 'products.view',
    managePermission: 'products.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => row.name
  },
  'bank-accounts': {
    table: 'bank_accounts',
    fields: [
      'company_id','bank_name','account_name','account_number','iban',
      'swift','branch','currency','status'
    ],
    detail: `SELECT id,company_id,bank_name,account_name,account_number,
                    iban,swift,branch,currency,status
             FROM bank_accounts WHERE id=?`,
    viewPermission: 'bank.view',
    managePermission: 'bank.manage',
    companyFromRow: row => Number(row.company_id),
    companyFromBody: body => Number(body.company_id),
    name: row => `${row.bank_name} ${row.account_name || ''}`.trim()
  }
};

// ---------- SECURE FINANCE READ / UPDATE / DELETE ----------

app.get(
  '/api/finance/:id',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const id = Number(req.params.id);

    const [row] = await q(
      `SELECT f.id,f.company_id,
              DATE_FORMAT(f.date,'%Y-%m-%d') date,
              f.type,f.category,f.description,f.amount,f.currency,
              c.name company_name
       FROM finance_transactions f
       JOIN companies c ON c.id=f.company_id
       WHERE f.id=?`,
      [id]
    );

    if (!row) {
      return res.status(404).json({ message: 'Finance record not found' });
    }

    const access = req.access || await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, 'finance.view', row.company_id)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    res.json(row);
  })
);

app.put(
  '/api/finance/:id',
  requireEffectivePermission('finance.edit'),
  safe(async (req, res) => {
    const id = Number(req.params.id);

    const [existing] = await q(
      `SELECT id,company_id,description,category
       FROM finance_transactions
       WHERE id=?`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Finance record not found' });
    }

    const access = req.access || await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, 'finance.edit', existing.company_id)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    const targetCompanyId = Number(
      req.body.company_id || existing.company_id
    );

    if (!hasEffectivePermission(access, 'finance.edit', targetCompanyId)) {
      return res.status(403).json({
        message: 'You cannot move this transaction to that company.'
      });
    }

    const {
      date,
      type,
      category,
      description,
      amount,
      currency='INR'
    } = req.body;

    if (!date || !type) {
      return res.status(400).json({
        message: 'Date and transaction type are required'
      });
    }

    if (!['income','expense','capital','loan','intercompany'].includes(type)) {
      return res.status(400).json({
        message: 'Invalid finance transaction type'
      });
    }

    const amountNumber = Number(amount);

    if (!Number.isFinite(amountNumber) || amountNumber < 0) {
      return res.status(400).json({ message: 'Enter a valid amount' });
    }

    await q(
      `UPDATE finance_transactions
       SET company_id=?,date=?,type=?,category=?,description=?,amount=?,currency=?
       WHERE id=?`,
      [
        targetCompanyId,
        date,
        type,
        text(category),
        text(description),
        amountNumber,
        currency || 'INR',
        id
      ]
    );

    await audit(
      req,
      'Updated finance transaction',
      'finance',
      existing.description || existing.category || `Finance #${id}`
    );

    res.json({ ok: true });
  })
);

app.delete(
  '/api/finance/:id',
  requireEffectivePermission('finance.delete'),
  safe(async (req, res) => {
    const id = Number(req.params.id);

    const [existing] = await q(
      `SELECT id,company_id,description,category
       FROM finance_transactions
       WHERE id=?`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Finance record not found' });
    }

    const access = req.access || await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, 'finance.delete', existing.company_id)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    await q('DELETE FROM finance_transactions WHERE id=?', [id]);

    await audit(
      req,
      'Deleted finance transaction',
      'finance',
      existing.description || existing.category || `Finance #${id}`
    );

    res.json({ ok: true });
  })
);

// ---------- GENERIC SECURE MODULE CRUD ----------

for (const [path, cfg] of Object.entries(crud)) {
  app.get(
    `/api/${path}/:id`,
    requireEffectivePermission(cfg.viewPermission),
    safe(async (req, res) => {
      const [row] = await q(cfg.detail, [req.params.id]);

      if (!row) {
        return res.status(404).json({ message: 'Record not found' });
      }

      const access = req.access || await buildUserAccess(req.user);
      const companyId = cfg.companyFromRow(row);

      if (
        !companyId &&
        cfg.allowGroupOnlyNullCompany &&
        access.globalRole !== 'group_admin'
      ) {
        return res.status(403).json({
          message: 'This group-level record is restricted.'
        });
      }

      if (
        companyId &&
        !hasEffectivePermission(access, cfg.viewPermission, companyId)
      ) {
        return res.status(403).json({
          message: 'You do not have access to this company.'
        });
      }

      res.json(row);
    })
  );

  app.put(
    `/api/${path}/:id`,
    requireEffectivePermission(cfg.managePermission),
    safe(async (req, res) => {
      const [before] = await q(cfg.detail, [req.params.id]);

      if (!before) {
        return res.status(404).json({ message: 'Record not found' });
      }

      const access = req.access || await buildUserAccess(req.user);
      const beforeCompanyId = cfg.companyFromRow(before);

      if (
        !beforeCompanyId &&
        cfg.allowGroupOnlyNullCompany &&
        access.globalRole !== 'group_admin'
      ) {
        return res.status(403).json({
          message: 'This group-level record is restricted.'
        });
      }

      if (
        beforeCompanyId &&
        !hasEffectivePermission(
          access,
          cfg.managePermission,
          beforeCompanyId
        )
      ) {
        return res.status(403).json({
          message: 'You do not have access to this company.'
        });
      }

      const body = { ...req.body };

      let targetCompanyId = null;

      if (cfg.companyFromBodyAsync) {
        targetCompanyId = await cfg.companyFromBodyAsync(body);
      } else if (cfg.companyFromBody) {
        targetCompanyId = cfg.companyFromBody(body);
      }

      if (
        !targetCompanyId &&
        cfg.allowGroupOnlyNullCompany &&
        access.globalRole !== 'group_admin'
      ) {
        return res.status(400).json({
          message: 'Company is required for this record.'
        });
      }

      if (
        targetCompanyId &&
        !hasEffectivePermission(
          access,
          cfg.managePermission,
          targetCompanyId
        )
      ) {
        return res.status(403).json({
          message: 'You cannot move this record to that company.'
        });
      }

      if (path === 'payroll') {
        const gross = number(body.gross_salary);
        const deduction = number(body.deduction);

        if (gross < 0 || deduction < 0 || deduction > gross) {
          return res.status(400).json({
            message: 'Check gross salary and deduction values'
          });
        }

        body.net_salary = gross - deduction;
      }

      if (path === 'domains') {
        body.auto_renew = body.auto_renew ? 1 : 0;
      }

      if (path === 'files') {
        body.confidential = body.confidential ? 1 : 0;
      }

      const dateFields = new Set([
        'date','joining_date','paid_date','due_date','purchase_date',
        'warranty_expiry','lease_start','lease_end','expiry_date'
      ]);

      const values = cfg.fields.map(field => {
        const value = body[field];
        return dateFields.has(field) ? nullable(value) : (value ?? null);
      });

      const setSql = cfg.fields.map(field => `${field}=?`).join(',');

      await q(
        `UPDATE ${cfg.table} SET ${setSql} WHERE id=?`,
        [...values, req.params.id]
      );

      if (path === 'credentials' && text(req.body.secret)) {
        await q(
          `UPDATE credentials
           SET encrypted_secret=?
           WHERE id=?`,
          [
            encryptSecret(req.body.secret),
            req.params.id
          ]
        );
      }

      await audit(
        req,
        `Updated ${path}`,
        path,
        cfg.name(before)
      );

      res.json({ ok: true });
    })
  );

  app.delete(
    `/api/${path}/:id`,
    requireEffectivePermission(cfg.managePermission),
    safe(async (req, res) => {
      const [before] = await q(cfg.detail, [req.params.id]);

      if (!before) {
        return res.status(404).json({ message: 'Record not found' });
      }

      const access = req.access || await buildUserAccess(req.user);
      const companyId = cfg.companyFromRow(before);

      if (
        !companyId &&
        cfg.allowGroupOnlyNullCompany &&
        access.globalRole !== 'group_admin'
      ) {
        return res.status(403).json({
          message: 'This group-level record is restricted.'
        });
      }

      if (
        companyId &&
        !hasEffectivePermission(
          access,
          cfg.managePermission,
          companyId
        )
      ) {
        return res.status(403).json({
          message: 'You do not have access to this company.'
        });
      }

      try {
        const result = await q(
          `DELETE FROM ${cfg.table} WHERE id=?`,
          [req.params.id]
        );

        if (!result.affectedRows) {
          return res.status(404).json({ message: 'Record not found' });
        }

        await audit(
          req,
          `Deleted ${path}`,
          path,
          cfg.name(before)
        );

        res.json({ ok: true });
      } catch (err) {
        if (
          err.code === 'ER_ROW_IS_REFERENCED_2' ||
          err.code === 'ER_ROW_IS_REFERENCED'
        ) {
          return res.status(409).json({
            message:
              'This record is used by another record and cannot be deleted yet.'
          });
        }

        throw err;
      }
    })
  );
}

// ---------- CREDENTIAL SECRET REVEAL ----------

app.get(
  '/api/credentials/:id/reveal',
  requireEffectivePermission('credentials.view_secret'),
  safe(async (req, res) => {
    const [row] = await q(
      `SELECT id,company_id,service_name,encrypted_secret
       FROM credentials
       WHERE id=?`,
      [req.params.id]
    );

    if (!row) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    const access = req.access || await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'credentials.view_secret',
        row.company_id
      )
    ) {
      return res.status(403).json({
        message: 'You do not have access to this credential.'
      });
    }

    const secret = row.encrypted_secret
      ? decryptSecret(row.encrypted_secret)
      : null;

    await audit(
      req,
      'Revealed credential secret',
      'credential',
      row.service_name
    );

    res.json({ secret });
  })
);

// Users need password hashing and company-access handling.
app.get('/api/users/:id', requireGroupAdmin, safe(async (req, res) => {
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

app.put('/api/users/:id', requireGroupAdmin, safe(async (req, res) => {
  const [before] = await q('SELECT id,name,email,role,status FROM users WHERE id=?', [req.params.id]);
  if (!before) return res.status(404).json({ message: 'User not found' });

  const { name, email, password, role = 'viewer', status = 'active', company_ids = [] } = req.body;
  if (!text(name) || !text(email)) return res.status(400).json({ message: 'Name and email are required' });

  const allowedRoles = ['group_admin', 'company_admin', 'accountant', 'hr_manager', 'document_manager', 'it_admin', 'management_viewer', 'viewer'];
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

app.delete('/api/users/:id', requireGroupAdmin, safe(async (req, res) => {
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


// ---------- SECURE LIST RECORDS ----------

const secureLists = {
  people: {
    permission: 'people.view',
    companyColumn: 'p.primary_company_id',
    sql: `SELECT p.id,p.primary_company_id company_id,p.name,p.position,
                 c.name company_name,p.phone,p.email
          FROM people p
          LEFT JOIN companies c ON c.id=p.primary_company_id`
  },
  employees: {
    permission: 'employees.view',
    companyColumn: 'e.company_id',
    sql: `SELECT e.id,e.company_id,e.employee_code,e.name,
                 c.name company_name,e.designation,
                 DATE_FORMAT(e.joining_date,'%Y-%m-%d') joining_date,
                 e.salary
          FROM employees e
          JOIN companies c ON c.id=e.company_id`
  },
  payroll: {
    permission: 'payroll.view',
    companyColumn: 'e.company_id',
    sql: `SELECT p.id,e.company_id,p.month,e.name employee_name,
                 c.name company_name,p.gross_salary,p.deduction,
                 p.net_salary,p.status
          FROM payroll p
          JOIN employees e ON e.id=p.employee_id
          JOIN companies c ON c.id=e.company_id`
  },
  reminders: {
    permission: 'reminders.view',
    companyColumn: 'r.company_id',
    sql: `SELECT r.id,r.company_id,
                 DATE_FORMAT(r.due_date,'%Y-%m-%d') due_date,
                 r.title,c.name company_name,r.category,r.priority,r.status
          FROM reminders r
          LEFT JOIN companies c ON c.id=r.company_id`
  },
  assets: {
    permission: 'assets.view',
    companyColumn: 'a.company_id',
    sql: `SELECT a.id,a.company_id,a.asset_code,a.name,
                 c.name company_name,a.category,a.assigned_to,a.status
          FROM assets a
          JOIN companies c ON c.id=a.company_id`
  },
  offices: {
    permission: 'offices.view',
    companyColumn: 'o.company_id',
    sql: `SELECT o.id,o.company_id,o.name,c.name company_name,o.city,
                 o.monthly_rent,o.rent_due_day,
                 DATE_FORMAT(o.lease_end,'%Y-%m-%d') lease_end
          FROM offices o
          JOIN companies c ON c.id=o.company_id`
  },
  domains: {
    permission: 'domains.view',
    companyColumn: 'd.company_id',
    sql: `SELECT d.id,d.company_id,d.domain,c.name company_name,d.registrar,
                 DATE_FORMAT(d.expiry_date,'%Y-%m-%d') expiry_date,
                 d.auto_renew,d.status
          FROM domains d
          JOIN companies c ON c.id=d.company_id`
  },
  emails: {
    permission: 'emails.view',
    companyColumn: 'e.company_id',
    sql: `SELECT e.id,e.company_id,e.email,c.name company_name,e.provider,
                 e.assigned_to,e.status
          FROM email_accounts e
          JOIN companies c ON c.id=e.company_id`
  },
  social: {
    permission: 'social.view',
    companyColumn: 's.company_id',
    sql: `SELECT s.id,s.company_id,s.platform,s.username,
                 c.name company_name,s.manager,s.status
          FROM social_accounts s
          JOIN companies c ON c.id=s.company_id`
  },
  credentials: {
    permission: 'credentials.view',
    companyColumn: 'cr.company_id',
    sql: `SELECT cr.id,cr.company_id,cr.service_name,c.name company_name,
                 cr.username,cr.url,cr.twofa_owner,
                 DATE_FORMAT(cr.updated_at,'%Y-%m-%d %H:%i') updated_at
          FROM credentials cr
          JOIN companies c ON c.id=cr.company_id`
  },
  files: {
    permission: 'files.view',
    companyColumn: 'd.company_id',
    sql: `SELECT d.id,d.company_id,d.name,c.name company_name,d.category,
                 DATE_FORMAT(d.expiry_date,'%Y-%m-%d') expiry_date,
                 d.confidential,
                 DATE_FORMAT(d.updated_at,'%Y-%m-%d %H:%i') updated_at
          FROM documents d
          JOIN companies c ON c.id=d.company_id`
  },
  products: {
    permission: 'products.view',
    companyColumn: 'p.company_id',
    sql: `SELECT p.id,p.company_id,p.name,c.name company_name,p.category,
                 p.status,p.website
          FROM products p
          JOIN companies c ON c.id=p.company_id`
  },
  'bank-accounts': {
    permission: 'bank.view',
    companyColumn: 'b.company_id',
    sql: `SELECT b.id,b.company_id,c.name company_name,b.bank_name,
                 b.account_name,
                 CONCAT('•••• ',RIGHT(b.account_number,4)) masked_account,
                 b.currency,b.status
          FROM bank_accounts b
          JOIN companies c ON c.id=b.company_id`
  }
};

for (const [path, cfg] of Object.entries(secureLists)) {
  app.get(
    `/api/${path}`,
    requireEffectivePermission(cfg.permission),
    safe(async (req, res) => {
      const access = req.access || await buildUserAccess(req.user);

      if (access.globalRole === 'group_admin') {
        return res.json(
          await q(`${cfg.sql} ORDER BY 1 DESC`)
        );
      }

      const companyIds = companyIdsFromAccess(access).filter(companyId =>
        hasEffectivePermission(access, cfg.permission, companyId)
      );

      if (!companyIds.length) {
        return res.json([]);
      }

      const placeholders = companyIds.map(() => '?').join(',');

      res.json(
        await q(
          `${cfg.sql}
           WHERE ${cfg.companyColumn} IN (${placeholders})
           ORDER BY 1 DESC`,
          companyIds
        )
      );
    })
  );
}

app.get(
  '/api/finance',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const access = req.access || await buildUserAccess(req.user);

    if (access.globalRole === 'group_admin') {
      return res.json(
        await q(
          `SELECT f.id,f.company_id,
                  DATE_FORMAT(f.date,'%Y-%m-%d') date,
                  c.name company_name,f.type,f.category,f.description,f.amount
           FROM finance_transactions f
           JOIN companies c ON c.id=f.company_id
           ORDER BY f.date DESC`
        )
      );
    }

    const companyIds = companyIdsFromAccess(access).filter(companyId =>
      hasEffectivePermission(access, 'finance.view', companyId)
    );

    if (!companyIds.length) {
      return res.json([]);
    }

    const placeholders = companyIds.map(() => '?').join(',');

    res.json(
      await q(
        `SELECT f.id,f.company_id,
                DATE_FORMAT(f.date,'%Y-%m-%d') date,
                c.name company_name,f.type,f.category,f.description,f.amount
         FROM finance_transactions f
         JOIN companies c ON c.id=f.company_id
         WHERE f.company_id IN (${placeholders})
         ORDER BY f.date DESC`,
        companyIds
      )
    );
  })
);

app.get(
  '/api/users',
  requireEffectivePermission('users.view'),
  safe(async (req, res) => {
    const rows = await q(
      `SELECT u.id,u.name,u.email,u.role,
              COALESCE(
                GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', '),
                'Group / No company'
              ) company_access,
              u.status
       FROM users u
       LEFT JOIN user_company_access a ON a.user_id=u.id
       LEFT JOIN companies c ON c.id=a.company_id
       GROUP BY u.id,u.name,u.email,u.role,u.status
       ORDER BY u.name`
    );

    res.json(rows);
  })
);

app.get(
  '/api/audit',
  requireEffectivePermission('audit.view'),
  safe(async (req, res) => {
    res.json(
      await q(
        `SELECT a.id,
                DATE_FORMAT(a.created_at,'%Y-%m-%d %H:%i') created_at,
                u.name user_name,a.action,a.entity_type,a.entity_name,
                a.ip_address
         FROM audit_logs a
         LEFT JOIN users u ON u.id=a.user_id
         ORDER BY a.created_at DESC
         LIMIT 250`
      )
    );
  })
);

app.use((err, req, res, next) => {
  console.error(err);

  const status =
    Number(err.statusCode) ||
    (err instanceof multer.MulterError ? 400 : 500);

  res.status(status).json({
    message:
      status === 500
        ? 'Server error'
        : (err.message || 'Request failed'),
    detail:
      process.env.NODE_ENV === 'development'
        ? err.message
        : undefined
  });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Insight API running on http://localhost:${port}`));