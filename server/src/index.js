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

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Logo must be a PNG, JPG, WebP or SVG image'), allowed.includes(file.mimetype));
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

const notifyUser = async (userId,title,message,type='info',targetPath=null,dedupeKey=null) => {
  if(!userId)return;
  await q(`INSERT INTO notifications(user_id,title,message,type,target_path,dedupe_key) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[userId,title,message,type,targetPath,dedupeKey]);
};
const notifyRole = async (role,title,message,type='info',targetPath=null,dedupeKey=null) => {
  await q(`INSERT INTO notifications(user_id,title,message,type,target_path,dedupe_key) SELECT id,?,?,?,?,? FROM users WHERE role=? AND status='active' ON DUPLICATE KEY UPDATE id=id`,[title,message,type,targetPath,dedupeKey,role]);
};
const notifyPartner = async (partnerId,title,message,type='info',targetPath='/partner',dedupeKey=null) => {
  const [profile]=await q('SELECT user_id FROM partner_profiles WHERE id=?',[partnerId]);
  if(profile)await notifyUser(profile.user_id,title,message,type,targetPath,dedupeKey);
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
const calculateInvoiceTotals = (items = [], discountAmount = 0) => {
  const cleanItems = (Array.isArray(items) ? items : [])
    .filter(item => text(item?.item_name))
    .map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const taxRate = Number(item.tax_rate || 0);

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        const err = new Error(
          `Invalid quantity for invoice item ${index + 1}`
        );
        err.statusCode = 400;
        throw err;
      }

      if (
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        const err = new Error(
          `Invalid unit price for invoice item ${index + 1}`
        );
        err.statusCode = 400;
        throw err;
      }

      if (
        !Number.isFinite(taxRate) ||
        taxRate < 0 ||
        taxRate > 100
      ) {
        const err = new Error(
          `Invalid tax rate for invoice item ${index + 1}`
        );
        err.statusCode = 400;
        throw err;
      }

      const lineSubtotal =
        Number((quantity * unitPrice).toFixed(2));

      const taxAmount =
        Number(
          (
            lineSubtotal *
            (taxRate / 100)
          ).toFixed(2)
        );

      const lineTotal =
        Number(
          (
            lineSubtotal +
            taxAmount
          ).toFixed(2)
        );

      return {
        item_name: text(item.item_name),
        description: text(item.description),
        quantity,
        unit_price: unitPrice,
        line_subtotal: lineSubtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        line_total: lineTotal,
        sort_order: Number(item.sort_order || index)
      };
    });

  if (!cleanItems.length) {
    const err = new Error(
      'At least one invoice item is required'
    );
    err.statusCode = 400;
    throw err;
  }

  const subtotal =
    Number(
      cleanItems
        .reduce(
          (sum, item) =>
            sum + item.line_subtotal,
          0
        )
        .toFixed(2)
    );

  const taxAmount =
    Number(
      cleanItems
        .reduce(
          (sum, item) =>
            sum + item.tax_amount,
          0
        )
        .toFixed(2)
    );

  const discount =
    Number(discountAmount || 0);

  if (
    !Number.isFinite(discount) ||
    discount < 0
  ) {
    const err = new Error(
      'Invalid discount amount'
    );
    err.statusCode = 400;
    throw err;
  }

  const totalAmount =
    Number(
      Math.max(
        0,
        subtotal +
          taxAmount -
          discount
      ).toFixed(2)
    );

  return {
    items: cleanItems,
    subtotal,
    tax_amount: taxAmount,
    discount_amount: discount,
    total_amount: totalAmount
  };
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
const loadFinanceForApproval = safe(async (req, res, next) => {
  const financeId = Number(req.params.id);

  if (!financeId) {
    return res.status(400).json({
      message: 'Invalid finance transaction.'
    });
  }

  const [row] = await q(
    `SELECT
       id,
       company_id,
       date,
       type,
       category,
       description,
       amount,
       currency,
       approval_status,
       created_by,
       approved_by,
       approved_at,
       rejected_by,
       rejected_at,
       rejection_reason
     FROM finance_transactions
     WHERE id=?
     LIMIT 1`,
    [financeId]
  );

  if (!row) {
    return res.status(404).json({
      message: 'Finance transaction not found.'
    });
  }

  req.financeRecord = row;
  next();
});



const canApproveFinance = (access, companyId) => {
  if (access?.globalRole === 'group_admin') return true;

  const entry = access?.companyAccess?.[Number(companyId)];

  if (!entry) return false;

  const roleKey =
    entry.role_key ||
    entry.roleKey ||
    entry.access_role ||
    entry.role;

  return roleKey === 'company_admin';
};

const requireFinanceApprovalAccess = safe(async (req, res, next) => {
  const access = req.access || await buildUserAccess(req.user);
  const companyId = Number(req.financeRecord?.company_id);

  if (!companyId) {
    return res.status(400).json({
      message: 'Finance company could not be resolved.'
    });
  }

  if (!canApproveFinance(access, companyId)) {
    return res.status(403).json({
      message:
        'Only Company Admin or Group Admin can approve or reject finance transactions.'
    });
  }

  req.access = access;
  next();
});



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
  const rows = await q('SELECT * FROM users WHERE email=? AND status="active" LIMIT 1', [text(email).toLowerCase()]);
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

app.post('/api/auth/frontdesk-login', safe(async (req, res) => {
  const email = text(req.body?.email).toLowerCase();
  const password = String(req.body?.password || '');
  const [u] = await q(
    `SELECT * FROM users
     WHERE email=? AND role='frontdesk' AND status='active' LIMIT 1`,
    [email]
  );
  if (!u || !await bcrypt.compare(password, u.password_hash)) {
    return res.status(401).json({ message: 'Invalid front-desk email or password' });
  }
  const token = jwt.sign(
    { id: u.id, email: u.email, role: u.role },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '12h' }
  );
  await q(`INSERT INTO frontdesk_login_history (user_id,ip_address,user_agent) VALUES (?,?,?)`, [u.id,req.ip,text(req.headers['user-agent']).slice(0,500)]).catch(() => {});
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

app.post('/api/auth/partner-login', safe(async (req,res)=>{
  const email=text(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
  const [u]=await q(`SELECT u.*,pp.id partner_id,pp.status partner_status FROM users u JOIN partner_profiles pp ON pp.user_id=u.id WHERE u.email=? AND u.role='partner' AND u.status='active' LIMIT 1`,[email]);
  if(!u||u.partner_status!=='active'||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({message:'Invalid partner email or password'});
  const token=jwt.sign({id:u.id,email:u.email,role:'partner',partner_id:u.partner_id},process.env.JWT_SECRET||'dev-secret',{expiresIn:'12h'});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:'partner',partner_id:u.partner_id}});
}));

app.post('/api/auth/register', safe(async (req, res) => {
  const name = text(req.body?.name);
  const email = text(req.body?.email).toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2) return res.status(400).json({ message: 'Enter your full name' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid business email' });
  if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ message: 'Password must contain 8 characters, uppercase, lowercase and a number' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await q(
      `INSERT INTO users (name,email,password_hash,role,status) VALUES (?,?,?,'viewer','inactive')`,
      [name, email, passwordHash]
    );
    await q(`INSERT INTO audit_logs (user_id,action,entity_type,entity_name,ip_address) VALUES (NULL,?,?,?,?)`, ['Requested account access', 'user', email, req.ip]);
    res.status(201).json({ id: result.insertId, message: 'Account request submitted for administrator approval.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An account with this email already exists' });
    throw err;
  }
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

app.get('/api/notifications',safe(async(req,res)=>{if(req.user.role==='frontdesk'){const [due]=await q(`SELECT COUNT(*) count FROM collection_customers WHERE status='active' AND next_interest_date<=CURDATE()`);if(Number(due?.count)>0)await notifyUser(req.user.id,'Collections need attention',`${due.count} customer account${Number(due.count)===1?' is':'s are'} due or overdue today.`,'warning','/frontdesk',`frontdesk-due-${req.user.id}-${new Date().toISOString().slice(0,10)}`);}const rows=await q(`SELECT id,title,message,type,target_path,is_read,created_at,read_at FROM notifications WHERE user_id=? ORDER BY is_read,created_at DESC LIMIT 50`,[req.user.id]);const [{count}]=await q('SELECT COUNT(*) count FROM notifications WHERE user_id=? AND is_read=0',[req.user.id]);res.json({notifications:rows,unread:Number(count)});}));
app.patch('/api/notifications/:id/read',safe(async(req,res)=>{await q('UPDATE notifications SET is_read=1,read_at=COALESCE(read_at,NOW()) WHERE id=? AND user_id=?',[req.params.id,req.user.id]);res.json({ok:true});}));
app.post('/api/notifications/read-all',safe(async(req,res)=>{await q('UPDATE notifications SET is_read=1,read_at=COALESCE(read_at,NOW()) WHERE user_id=? AND is_read=0',[req.user.id]);res.json({ok:true});}));


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

app.get('/api/payroll-employee-options', requireEffectivePermission('payroll.view'), safe(async (req, res) => {
  const access = req.access || await buildUserAccess(req.user);

  if (access.globalRole === 'group_admin') {
    return res.json(await q(`
      SELECT e.id,e.name,e.salary,e.company_id,c.name AS company_name
      FROM employees e
      JOIN companies c ON c.id=e.company_id
      WHERE e.status='Active'
      ORDER BY c.name,e.name
    `));
  }

  const companyIds = companyIdsFromAccess(access).filter(companyId =>
    hasEffectivePermission(access, 'payroll.view', companyId)
  );

  if (!companyIds.length) return res.json([]);
  const placeholders = companyIds.map(() => '?').join(',');

  res.json(await q(
    `SELECT e.id,e.name,e.salary,e.company_id,c.name AS company_name
     FROM employees e
     JOIN companies c ON c.id=e.company_id
     WHERE e.status='Active' AND e.company_id IN (${placeholders})
     ORDER BY c.name,e.name`,
    companyIds
  ));
}));

// ---------- COMPANIES ----------

app.get(
  '/api/companies',
  requireEffectivePermission('companies.view'),
  safe(async (req, res) => {
    const access = req.access || await buildUserAccess(req.user);

    if (access.globalRole === 'group_admin') {
      const rows = await q(`SELECT * FROM companies WHERE is_parent=0 ORDER BY name`);
      return res.json(await Promise.all(rows.map(withCompanyLogoUrl)));
    }

    const companyIds = companyIdsFromAccess(access);
    if (!companyIds.length) return res.json([]);

    const placeholders = companyIds.map(() => '?').join(',');

    const rows = await q(
        `SELECT *
         FROM companies
         WHERE is_parent=0
           AND id IN (${placeholders})
         ORDER BY name`,
        companyIds
      );
    res.json(await Promise.all(rows.map(withCompanyLogoUrl)));
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

    res.json({ company: await withCompanyLogoUrl(company), shareholders, products });
  })
);

app.post(
  '/api/companies/:id/logo',
  requireEffectivePermission('companies.manage'),
  logoUpload.single('logo'),
  safe(async (req, res) => {
    if (!requireS3(req, res)) return;
    const companyId = Number(req.params.id);
    const access = req.access || await buildUserAccess(req.user);
    if (!hasEffectivePermission(access, 'companies.manage', companyId)) {
      return res.status(403).json({ message: 'You do not have access to manage this company.' });
    }
    const [company] = await q('SELECT id,name,logo_storage_key FROM companies WHERE id=? AND is_parent=0', [companyId]);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    if (!req.file) return res.status(400).json({ message: 'Select a logo image' });
    const key = `insight/company-${companyId}/branding/${Date.now()}-${crypto.randomUUID()}-${safeFileName(req.file.originalname)}`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
    await q('UPDATE companies SET logo_storage_key=? WHERE id=?', [key, companyId]);
    if (company.logo_storage_key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: company.logo_storage_key })).catch(() => {});
    await audit(req, 'Updated company logo', 'company', company.name);
    res.json(await withCompanyLogoUrl({ ...company, logo_storage_key: key }));
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
     (
       company_id,
       date,
       type,
       category,
       description,
       amount,
       currency,
       approval_status,
       created_by
     )
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      company_id,
      date,
      type,
      text(category),
      text(description),
      Number(amount),
      currency || 'INR',
      'pending',
      req.user?.id || null
    ]
  );

   await audit(
    req,
    'Created finance transaction - pending approval',
    'finance',
    text(description) ||
      text(category) ||
      `Transaction #${result.insertId}`
  );

  res.status(201).json({
    id: result.insertId,
    approval_status: 'pending'
  });
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

const withCompanyLogoUrl = async company => {
  if (!company?.logo_storage_key || !process.env.S3_BUCKET) return company;
  const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: company.logo_storage_key, ResponseContentDisposition: 'inline' });
  return { ...company, logo_url: await getSignedUrl(s3, command, { expiresIn: 900 }) };
};

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
      `SELECT
         f.id,
         f.company_id,
         DATE_FORMAT(f.date,'%Y-%m-%d') date,
         f.type,
         f.category,
         f.description,
         f.amount,
         f.currency,

         f.approval_status,
         f.created_by,
         creator.name AS created_by_name,

         f.approved_by,
         approver.name AS approved_by_name,
         DATE_FORMAT(f.approved_at,'%Y-%m-%d %H:%i') approved_at,

         f.rejected_by,
         rejector.name AS rejected_by_name,
         DATE_FORMAT(f.rejected_at,'%Y-%m-%d %H:%i') rejected_at,
         f.rejection_reason,

         c.name company_name

       FROM finance_transactions f

       JOIN companies c
         ON c.id=f.company_id

       LEFT JOIN users creator
         ON creator.id=f.created_by

       LEFT JOIN users approver
         ON approver.id=f.approved_by

       LEFT JOIN users rejector
         ON rejector.id=f.rejected_by

       WHERE f.id=?`,
      [id]
    );

    if (!row) {
      return res.status(404).json({
        message: 'Finance record not found'
      });
    }

    const access =
      req.access || await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.view',
        row.company_id
      )
    ) {
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
      `SELECT
         id,
         company_id,
         description,
         category,
         approval_status
       FROM finance_transactions
       WHERE id=?`,
      [id]
    );


 
    if (!existing) {
      return res.status(404).json({
        message: 'Finance record not found'
      });
    }
 if (existing.approval_status === 'approved') {
      return res.status(409).json({
        message:
          'Approved finance transactions are locked and cannot be edited.'
      });
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
      `SELECT
         id,
         company_id,
         description,
         category,
         approval_status
       FROM finance_transactions
       WHERE id=?`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({
        message: 'Finance record not found'
      });
    }

    const access =
      req.access || await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.delete',
        existing.company_id
      )
    ) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    if (existing.approval_status === 'approved') {
      return res.status(409).json({
        message:
          'Approved finance transactions are locked and cannot be deleted.'
      });
    }

    await q(
      'DELETE FROM finance_transactions WHERE id=?',
      [id]
    );

    await audit(
      req,
      'Deleted finance transaction',
      'finance',
      existing.description ||
        existing.category ||
        `Finance #${id}`
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

// ---------- GROUP ADMIN PROGRAM REGISTRY ----------

const verifyCurrentAdminPassword = async (req, password) => {
  const [user] = await q(`SELECT id,password_hash,role,status FROM users WHERE id=?`, [req.user.id]);
  return Boolean(user && user.role === 'group_admin' && user.status === 'active' && await bcrypt.compare(String(password || ''), user.password_hash));
};

app.get('/api/program-registry', requireGroupAdmin, safe(async (req, res) => {
  res.json(await q(
    `SELECT pr.id,pr.program_name,pr.environment,pr.status,pr.public_url,pr.git_url,pr.git_branch,
            pr.server_host,pr.ssh_user,pr.ssh_port,pr.deployment_path,pr.process_manager,pr.notes,
            (pr.encrypted_pem IS NOT NULL) has_pem,(pr.encrypted_env IS NOT NULL) has_env,
            pr.created_at,pr.updated_at,cu.name created_by_name,uu.name updated_by_name
     FROM program_registry pr LEFT JOIN users cu ON cu.id=pr.created_by LEFT JOIN users uu ON uu.id=pr.updated_by
     ORDER BY pr.status='active' DESC,pr.program_name,pr.environment`
  ));
}));

app.post('/api/program-registry', requireGroupAdmin, safe(async (req, res) => {
  const name = text(req.body.program_name);
  const environment = text(req.body.environment) || 'production';
  if (!name) return res.status(400).json({ message: 'Program name is required.' });
  try {
    const result = await q(
      `INSERT INTO program_registry
       (program_name,environment,status,public_url,git_url,git_branch,server_host,ssh_user,ssh_port,deployment_path,process_manager,encrypted_pem,encrypted_env,notes,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name,environment,text(req.body.status)||'active',text(req.body.public_url),text(req.body.git_url),text(req.body.git_branch),text(req.body.server_host),text(req.body.ssh_user),number(req.body.ssh_port,22)||22,text(req.body.deployment_path),text(req.body.process_manager),encryptSecret(req.body.pem_key),encryptSecret(req.body.env_content),text(req.body.notes),req.user.id,req.user.id]
    );
    await audit(req,'Created protected program record','program_registry',`${name} (${environment})`);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This program and environment already exist.' });
    throw err;
  }
}));

app.put('/api/program-registry/:id', requireGroupAdmin, safe(async (req, res) => {
  const [existing] = await q('SELECT * FROM program_registry WHERE id=?',[req.params.id]);
  if (!existing) return res.status(404).json({ message: 'Program record not found.' });
  const name=text(req.body.program_name),environment=text(req.body.environment)||'production';
  if (!name) return res.status(400).json({ message: 'Program name is required.' });
  const pem = text(req.body.pem_key) ? encryptSecret(req.body.pem_key) : existing.encrypted_pem;
  const env = text(req.body.env_content) ? encryptSecret(req.body.env_content) : existing.encrypted_env;
  await q(
    `UPDATE program_registry SET program_name=?,environment=?,status=?,public_url=?,git_url=?,git_branch=?,server_host=?,ssh_user=?,ssh_port=?,deployment_path=?,process_manager=?,encrypted_pem=?,encrypted_env=?,notes=?,updated_by=? WHERE id=?`,
    [name,environment,text(req.body.status)||'active',text(req.body.public_url),text(req.body.git_url),text(req.body.git_branch),text(req.body.server_host),text(req.body.ssh_user),number(req.body.ssh_port,22)||22,text(req.body.deployment_path),text(req.body.process_manager),pem,env,text(req.body.notes),req.user.id,existing.id]
  );
  await audit(req,'Updated protected program record','program_registry',`${name} (${environment})`);
  res.json({ ok:true });
}));

app.post('/api/program-registry/:id/reveal', requireGroupAdmin, safe(async (req, res) => {
  const field = req.body.field === 'pem_key' ? 'pem_key' : req.body.field === 'env_content' ? 'env_content' : null;
  if (!field) return res.status(400).json({ message: 'A valid protected field is required.' });
  if (!await verifyCurrentAdminPassword(req,req.body.password)) return res.status(401).json({ message: 'Your Group Admin password is incorrect.' });
  const [row] = await q('SELECT id,program_name,environment,encrypted_pem,encrypted_env FROM program_registry WHERE id=?',[req.params.id]);
  if (!row) return res.status(404).json({ message: 'Program record not found.' });
  const encrypted = field === 'pem_key' ? row.encrypted_pem : row.encrypted_env;
  await audit(req,`Revealed protected ${field === 'pem_key' ? 'PEM key' : 'environment configuration'}`,'program_registry',`${row.program_name} (${row.environment})`);
  res.set('Cache-Control','no-store, private, max-age=0');
  res.set('Pragma','no-cache');
  res.json({ value: encrypted ? decryptSecret(encrypted) : '' });
}));

app.post('/api/program-registry/:id/archive', requireGroupAdmin, safe(async (req, res) => {
  if (!await verifyCurrentAdminPassword(req,req.body.password)) return res.status(401).json({ message: 'Your Group Admin password is incorrect.' });
  const [row]=await q('SELECT id,program_name,environment FROM program_registry WHERE id=?',[req.params.id]);
  if(!row)return res.status(404).json({message:'Program record not found.'});
  await q(`UPDATE program_registry SET status='archived',updated_by=? WHERE id=?`,[req.user.id,row.id]);
  await audit(req,'Archived protected program record','program_registry',`${row.program_name} (${row.environment})`);
  res.json({ok:true});
}));

// ---------- PARTNER MANAGEMENT AND PORTAL ----------

const requirePartner = (req,res,next) => req.user?.role === 'partner' && req.user?.partner_id ? next() : res.status(403).json({message:'Partner portal access is required.'});

app.get('/api/partner-admin/overview',requireGroupAdmin,safe(async(req,res)=>{
  const partners=await q(`SELECT pp.id,pp.status,p.id person_id,p.name,p.position,p.email,p.phone,u.email login_email,u.status login_status,
    COUNT(DISTINCT pca.company_id) company_count,COALESCE(SUM(DISTINCT pca.ownership_percent),0) ownership_total,
    COALESCE((SELECT SUM(pi.amount) FROM partner_investments pi WHERE pi.partner_id=pp.id),0) invested_total,
    COALESCE((SELECT COUNT(*) FROM partner_tasks pt WHERE pt.partner_id=pp.id AND pt.status<>'completed'),0) open_tasks
    FROM partner_profiles pp JOIN people p ON p.id=pp.person_id JOIN users u ON u.id=pp.user_id
    LEFT JOIN partner_company_access pca ON pca.partner_id=pp.id GROUP BY pp.id,p.id,u.id ORDER BY p.name`);
  res.json({partners,people:await q(`SELECT id,name,email,position FROM people ORDER BY name`),companies:await q(`SELECT id,name,currency FROM companies WHERE status='active' AND is_parent=0 ORDER BY name`)});
}));

app.get('/api/partner-admin/withdrawals',requireGroupAdmin,safe(async(req,res)=>{const rows=await q(`SELECT pwr.*,p.name partner_name,c.name company_name,c.currency,u.name reviewed_by_name FROM partner_withdrawal_requests pwr JOIN partner_profiles pp ON pp.id=pwr.partner_id JOIN people p ON p.id=pp.person_id JOIN companies c ON c.id=pwr.company_id LEFT JOIN users u ON u.id=pwr.reviewed_by ORDER BY FIELD(pwr.status,'pending','approved','paid','rejected','cancelled'),pwr.created_at DESC`);res.json(rows);}));

app.patch('/api/partner-admin/withdrawals/:id',requireGroupAdmin,safe(async(req,res)=>{const status=['approved','rejected','paid'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({message:'Valid withdrawal decision is required.'});const [row]=await q('SELECT * FROM partner_withdrawal_requests WHERE id=?',[req.params.id]);if(!row)return res.status(404).json({message:'Withdrawal request not found.'});const allowed=(row.status==='pending'&&['approved','rejected'].includes(status))||(row.status==='approved'&&status==='paid');if(!allowed)return res.status(409).json({message:`A ${row.status} request cannot be changed to ${status}.`});if(status==='paid'){const [balance]=await q(`SELECT COALESCE((SELECT SUM(amount) FROM partner_investments WHERE partner_id=? AND company_id=?),0)-COALESCE((SELECT SUM(amount) FROM partner_withdrawal_requests WHERE partner_id=? AND company_id=? AND status='paid'),0) available`,[row.partner_id,row.company_id,row.partner_id,row.company_id]);if(Number(row.amount)>Number(balance.available))return res.status(409).json({message:'Available partner capital is no longer sufficient for this payment.'});}await q(`UPDATE partner_withdrawal_requests SET status=?,admin_notes=?,reviewed_by=?,reviewed_at=NOW(),paid_at=IF(?='paid',NOW(),paid_at) WHERE id=?`,[status,text(req.body.admin_notes),req.user.id,status,row.id]);await audit(req,`${status[0].toUpperCase()+status.slice(1)} partner withdrawal request`,'partner_withdrawal',String(row.id));await notifyPartner(row.partner_id,`Withdrawal ${status}`,`Your withdrawal request has been ${status}.`,status==='rejected'?'error':'success','/partner',`withdrawal-${row.id}-${status}`);res.json({ok:true});}));

app.get('/api/partner-admin/meetings',requireGroupAdmin,safe(async(req,res)=>{const meetings=await q(`SELECT pm.*,c.name company_name,u.name created_by_name,COUNT(pmr.id) recipient_count,SUM(pmr.response_status<>'pending') response_count,SUM(pmr.response_status='approved') approved_count,SUM(pmr.response_status='rejected') rejected_count FROM partner_meetings pm JOIN companies c ON c.id=pm.company_id LEFT JOIN users u ON u.id=pm.created_by LEFT JOIN partner_meeting_responses pmr ON pmr.meeting_id=pm.id GROUP BY pm.id,c.id,u.id ORDER BY pm.scheduled_at DESC,pm.id DESC`);const responses=await q(`SELECT pmr.*,p.name partner_name FROM partner_meeting_responses pmr JOIN partner_profiles pp ON pp.id=pmr.partner_id JOIN people p ON p.id=pp.person_id ORDER BY pmr.responded_at DESC,p.name`);res.json({meetings,responses});}));

app.post('/api/partner-admin/meetings',requireGroupAdmin,safe(async(req,res)=>{const companyId=Number(req.body.company_id),title=text(req.body.title),scheduled=text(req.body.scheduled_at),action=['acknowledgement','approval'].includes(req.body.action_type)?req.body.action_type:'acknowledgement',status=req.body.status==='published'?'published':'draft';if(!companyId||!title||!scheduled)return res.status(400).json({message:'Company, meeting title and scheduled date are required.'});const conn=await pool.getConnection();try{await conn.beginTransaction();const [result]=await conn.query(`INSERT INTO partner_meetings(company_id,title,meeting_type,scheduled_at,location,agenda,minutes,resolution_text,action_type,response_due_date,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[companyId,title,text(req.body.meeting_type)||'Partner meeting',scheduled,text(req.body.location),text(req.body.agenda),text(req.body.minutes),text(req.body.resolution_text),action,nullable(req.body.response_due_date),status,req.user.id]);if(status==='published')await conn.query(`INSERT IGNORE INTO partner_meeting_responses(meeting_id,partner_id) SELECT ?,pca.partner_id FROM partner_company_access pca JOIN partner_profiles pp ON pp.id=pca.partner_id WHERE pca.company_id=? AND pp.status='active'`,[result.insertId,companyId]);await conn.commit();await audit(req,`${status==='published'?'Published':'Created draft'} partner meeting`,'partner_meeting',String(result.insertId));if(status==='published')await q(`INSERT INTO notifications(user_id,title,message,type,target_path,dedupe_key) SELECT pp.user_id,'New meeting or decision',?,'action','/partner',CONCAT('meeting-',?,'-',pp.user_id) FROM partner_meeting_responses pmr JOIN partner_profiles pp ON pp.id=pmr.partner_id WHERE pmr.meeting_id=? ON DUPLICATE KEY UPDATE id=id`,[title,result.insertId,result.insertId]);res.status(201).json({id:result.insertId});}catch(err){await conn.rollback();throw err}finally{conn.release()}}));

app.patch('/api/partner-admin/meetings/:id',requireGroupAdmin,safe(async(req,res)=>{const [meeting]=await q('SELECT * FROM partner_meetings WHERE id=?',[req.params.id]);if(!meeting)return res.status(404).json({message:'Meeting record not found.'});const status=['draft','published','closed'].includes(req.body.status)?req.body.status:meeting.status;if(meeting.status==='closed')return res.status(409).json({message:'A closed meeting record cannot be changed.'});const conn=await pool.getConnection();try{await conn.beginTransaction();await conn.query(`UPDATE partner_meetings SET minutes=?,resolution_text=?,status=?,updated_by=? WHERE id=?`,[req.body.minutes===undefined?meeting.minutes:text(req.body.minutes),req.body.resolution_text===undefined?meeting.resolution_text:text(req.body.resolution_text),status,req.user.id,meeting.id]);if(status==='published')await conn.query(`INSERT IGNORE INTO partner_meeting_responses(meeting_id,partner_id) SELECT ?,pca.partner_id FROM partner_company_access pca JOIN partner_profiles pp ON pp.id=pca.partner_id WHERE pca.company_id=? AND pp.status='active'`,[meeting.id,meeting.company_id]);await conn.commit();await audit(req,`${status==='published'?'Published':status==='closed'?'Closed':'Updated'} partner meeting`,'partner_meeting',String(meeting.id));if(status==='published')await q(`INSERT INTO notifications(user_id,title,message,type,target_path,dedupe_key) SELECT pp.user_id,'New meeting or decision',?,'action','/partner',CONCAT('meeting-',?,'-',pp.user_id) FROM partner_meeting_responses pmr JOIN partner_profiles pp ON pp.id=pmr.partner_id WHERE pmr.meeting_id=? ON DUPLICATE KEY UPDATE id=id`,[meeting.title,meeting.id,meeting.id]);res.json({ok:true});}catch(err){await conn.rollback();throw err}finally{conn.release()}}));

app.post('/api/partner-admin/accounts',requireGroupAdmin,safe(async(req,res)=>{
  const personId=Number(req.body.person_id),email=text(req.body.email).toLowerCase(),password=String(req.body.password||'');
  if(!personId||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return res.status(400).json({message:'Person, valid email and password of at least 8 characters are required.'});
  const [person]=await q('SELECT * FROM people WHERE id=?',[personId]);if(!person)return res.status(404).json({message:'Key person not found.'});
  const conn=await pool.getConnection();try{await conn.beginTransaction();const [userResult]=await conn.query(`INSERT INTO users(name,email,password_hash,role,status) VALUES (?,?,?,'partner','active')`,[person.name,email,await bcrypt.hash(password,12)]);const [profileResult]=await conn.query(`INSERT INTO partner_profiles(person_id,user_id,status) VALUES (?,?,'active')`,[person.id,userResult.insertId]);await conn.commit();await audit(req,'Created partner portal account','partner_profile',person.name);res.status(201).json({id:profileResult.insertId});}catch(err){await conn.rollback();if(err.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This person or login email already has an account.'});throw err;}finally{conn.release();}
}));

app.get('/api/partner-admin/:id',requireGroupAdmin,safe(async(req,res)=>{
  const [partner]=await q(`SELECT pp.id,pp.status,p.id person_id,p.name,p.position,p.email,p.phone,u.email login_email,u.status login_status FROM partner_profiles pp JOIN people p ON p.id=pp.person_id JOIN users u ON u.id=pp.user_id WHERE pp.id=?`,[req.params.id]);
  if(!partner)return res.status(404).json({message:'Partner account not found.'});
  const companies=await q(`SELECT pca.*,c.name company_name,c.currency,COALESCE((SELECT SUM(pi.amount) FROM partner_investments pi WHERE pi.partner_id=pca.partner_id AND pi.company_id=pca.company_id),0) invested_total FROM partner_company_access pca JOIN companies c ON c.id=pca.company_id WHERE pca.partner_id=? ORDER BY c.name`,[partner.id]);
  const investments=await q(`SELECT pi.*,c.name company_name,u.name created_by_name FROM partner_investments pi JOIN companies c ON c.id=pi.company_id LEFT JOIN users u ON u.id=pi.created_by WHERE pi.partner_id=? ORDER BY pi.investment_date DESC,pi.id DESC`,[partner.id]);
  const tasks=await q(`SELECT pt.*,c.name company_name,u.name assigned_by_name FROM partner_tasks pt LEFT JOIN companies c ON c.id=pt.company_id LEFT JOIN users u ON u.id=pt.created_by WHERE pt.partner_id=? ORDER BY pt.status='completed',pt.due_date,pt.id DESC`,[partner.id]);
  const companyIds=companies.map(item=>Number(item.company_id));const ph=companyIds.map(()=>'?').join(',');
  const assets=companyIds.length?await q(`SELECT a.*,c.name company_name,c.currency FROM assets a JOIN companies c ON c.id=a.company_id WHERE a.company_id IN (${ph}) ORDER BY a.purchase_date DESC,a.id DESC`,companyIds):[];
  const transactions=companyIds.length?await q(`SELECT ft.*,c.name company_name FROM finance_transactions ft JOIN companies c ON c.id=ft.company_id WHERE ft.company_id IN (${ph}) ORDER BY ft.date DESC,ft.id DESC LIMIT 50`,companyIds):[];
  const withdrawals=await q(`SELECT pwr.*,c.name company_name,c.currency,u.name reviewed_by_name FROM partner_withdrawal_requests pwr JOIN companies c ON c.id=pwr.company_id LEFT JOIN users u ON u.id=pwr.reviewed_by WHERE pwr.partner_id=? ORDER BY pwr.created_at DESC`,[partner.id]);
  res.json({partner,companies,investments,tasks,assets,transactions,withdrawals});
}));

app.post('/api/partner-admin/:id/companies',requireGroupAdmin,safe(async(req,res)=>{const partnerId=Number(req.params.id),companyId=Number(req.body.company_id);if(!companyId)return res.status(400).json({message:'Company is required.'});await q(`INSERT INTO partner_company_access(partner_id,company_id,relationship_type,ownership_percent,notes) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE relationship_type=VALUES(relationship_type),ownership_percent=VALUES(ownership_percent),notes=VALUES(notes)`,[partnerId,companyId,text(req.body.relationship_type)||'Partner',number(req.body.ownership_percent),text(req.body.notes)]);await audit(req,'Updated partner company relationship','partner_profile',String(partnerId));res.status(201).json({ok:true});}));

app.post('/api/partner-admin/:id/investments',requireGroupAdmin,safe(async(req,res)=>{const partnerId=Number(req.params.id),companyId=Number(req.body.company_id),amount=number(req.body.amount),date=text(req.body.investment_date);const [access]=await q('SELECT id FROM partner_company_access WHERE partner_id=? AND company_id=?',[partnerId,companyId]);if(!access)return res.status(400).json({message:'Assign this company to the partner before recording investment.'});if(amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({message:'Valid investment amount and date are required.'});const result=await q(`INSERT INTO partner_investments(partner_id,company_id,investment_date,investment_type,amount,currency,reference_no,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)`,[partnerId,companyId,date,text(req.body.investment_type)||'Capital contribution',amount,text(req.body.currency)||'INR',text(req.body.reference_no),text(req.body.notes),req.user.id]);await audit(req,'Recorded partner investment','partner_investment',String(result.insertId));res.status(201).json({id:result.insertId});}));

app.post('/api/partner-admin/:id/tasks',requireGroupAdmin,safe(async(req,res)=>{const title=text(req.body.title);if(!title)return res.status(400).json({message:'Task title is required.'});const companyId=Number(req.body.company_id)||null;if(companyId){const [access]=await q('SELECT id FROM partner_company_access WHERE partner_id=? AND company_id=?',[req.params.id,companyId]);if(!access)return res.status(400).json({message:'Task company must be assigned to this partner.'});}const result=await q(`INSERT INTO partner_tasks(partner_id,company_id,title,description,due_date,priority,status,created_by) VALUES (?,?,?,?,?,?,?,?)`,[req.params.id,companyId,title,text(req.body.description),nullable(req.body.due_date),text(req.body.priority)||'Medium','pending',req.user.id]);await audit(req,'Assigned partner task','partner_task',title);await notifyPartner(req.params.id,'New task assigned',title,'info','/partner',`partner-task-${result.insertId}`);res.status(201).json({id:result.insertId});}));

app.post('/api/partner-admin/:id/reset-password',requireGroupAdmin,safe(async(req,res)=>{const password=String(req.body.password||'');if(password.length<8)return res.status(400).json({message:'Password must contain at least 8 characters.'});const [partner]=await q('SELECT user_id FROM partner_profiles WHERE id=?',[req.params.id]);if(!partner)return res.status(404).json({message:'Partner not found.'});await q('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(password,12),partner.user_id]);await audit(req,'Reset partner portal password','partner_profile',String(req.params.id));res.json({ok:true});}));

app.get('/api/partner/overview',requirePartner,safe(async(req,res)=>{const partnerId=req.user.partner_id;const [profile]=await q(`SELECT pp.id,p.name,p.position,p.email,p.phone FROM partner_profiles pp JOIN people p ON p.id=pp.person_id WHERE pp.id=? AND pp.status='active'`,[partnerId]);if(!profile)return res.status(403).json({message:'Partner account is inactive.'});const companies=await q(`SELECT pca.company_id,pca.relationship_type,pca.ownership_percent,pca.notes,c.name company_name,c.currency,COALESCE((SELECT SUM(pi.amount) FROM partner_investments pi WHERE pi.partner_id=pca.partner_id AND pi.company_id=pca.company_id),0) invested_total,COALESCE((SELECT SUM(w.amount) FROM partner_withdrawal_requests w WHERE w.partner_id=pca.partner_id AND w.company_id=pca.company_id AND w.status='paid'),0) withdrawn_total,COALESCE((SELECT SUM(w.amount) FROM partner_withdrawal_requests w WHERE w.partner_id=pca.partner_id AND w.company_id=pca.company_id AND w.status IN ('pending','approved')),0) reserved_total,COALESCE((SELECT COUNT(*) FROM assets a WHERE a.company_id=c.id),0) asset_count,COALESCE((SELECT SUM(a.purchase_cost) FROM assets a WHERE a.company_id=c.id),0) asset_value FROM partner_company_access pca JOIN companies c ON c.id=pca.company_id WHERE pca.partner_id=? ORDER BY c.name`,[partnerId]);const investments=await q(`SELECT pi.*,c.name company_name FROM partner_investments pi JOIN companies c ON c.id=pi.company_id WHERE pi.partner_id=? ORDER BY pi.investment_date DESC,pi.id DESC`,[partnerId]);const withdrawals=await q(`SELECT pwr.*,c.name company_name,c.currency FROM partner_withdrawal_requests pwr JOIN companies c ON c.id=pwr.company_id WHERE pwr.partner_id=? ORDER BY pwr.created_at DESC`,[partnerId]);const tasks=await q(`SELECT pt.*,c.name company_name FROM partner_tasks pt LEFT JOIN companies c ON c.id=pt.company_id WHERE pt.partner_id=? ORDER BY pt.status='completed',pt.due_date,pt.id DESC`,[partnerId]);const ids=companies.map(x=>Number(x.company_id)),ph=ids.map(()=>'?').join(',');const assets=ids.length?await q(`SELECT a.*,c.name company_name,c.currency FROM assets a JOIN companies c ON c.id=a.company_id WHERE a.company_id IN (${ph}) ORDER BY a.purchase_date DESC,a.id DESC`,ids):[];const transactions=ids.length?await q(`SELECT ft.*,c.name company_name FROM finance_transactions ft JOIN companies c ON c.id=ft.company_id WHERE ft.company_id IN (${ph}) ORDER BY ft.date DESC,ft.id DESC LIMIT 25`,ids):[];res.json({profile,companies,investments,withdrawals,tasks,assets,recent_transactions:transactions});}));

app.post('/api/partner/withdrawals',requirePartner,safe(async(req,res)=>{const partnerId=req.user.partner_id,companyId=Number(req.body.company_id),amount=number(req.body.amount),method=text(req.body.payment_method)||'Bank transfer',reason=text(req.body.reason);if(!companyId||amount<=0||reason.length<5)return res.status(400).json({message:'Company, valid amount and a short reason are required.'});const [position]=await q(`SELECT pca.id,c.currency,c.name company_name,COALESCE((SELECT SUM(amount) FROM partner_investments WHERE partner_id=pca.partner_id AND company_id=pca.company_id),0)-COALESCE((SELECT SUM(amount) FROM partner_withdrawal_requests WHERE partner_id=pca.partner_id AND company_id=pca.company_id AND status IN ('pending','approved','paid')),0) available FROM partner_company_access pca JOIN companies c ON c.id=pca.company_id WHERE pca.partner_id=? AND pca.company_id=?`,[partnerId,companyId]);if(!position)return res.status(403).json({message:'You do not have access to this company.'});if(amount>Number(position.available))return res.status(409).json({message:'Requested amount exceeds your available capital after existing requests.'});const result=await q(`INSERT INTO partner_withdrawal_requests(partner_id,company_id,amount,currency,payment_method,reason,status) VALUES (?,?,?,?,?,?,'pending')`,[partnerId,companyId,amount,position.currency,method,reason]);await audit(req,'Submitted partner withdrawal request','partner_withdrawal',String(result.insertId));await notifyRole('group_admin','New withdrawal request',`${req.user.name||'A partner'} requested ${position.currency} ${amount} from ${position.company_name}.`,'warning','/partner-operations',`withdrawal-request-${result.insertId}`);res.status(201).json({id:result.insertId});}));

app.patch('/api/partner/withdrawals/:id/cancel',requirePartner,safe(async(req,res)=>{const result=await q(`UPDATE partner_withdrawal_requests SET status='cancelled' WHERE id=? AND partner_id=? AND status='pending'`,[req.params.id,req.user.partner_id]);if(!result.affectedRows)return res.status(409).json({message:'Only a pending withdrawal request can be cancelled.'});await audit(req,'Cancelled partner withdrawal request','partner_withdrawal',String(req.params.id));res.json({ok:true});}));

app.get('/api/partner/meetings',requirePartner,safe(async(req,res)=>{const rows=await q(`SELECT pm.id,pm.title,pm.meeting_type,pm.scheduled_at,pm.location,pm.agenda,pm.minutes,pm.resolution_text,pm.action_type,pm.response_due_date,pm.status,c.name company_name,pmr.response_status,pmr.comment,pmr.responded_at FROM partner_meeting_responses pmr JOIN partner_meetings pm ON pm.id=pmr.meeting_id JOIN companies c ON c.id=pm.company_id WHERE pmr.partner_id=? AND pm.status IN ('published','closed') ORDER BY pm.status='published' DESC,pm.scheduled_at DESC,pm.id DESC`,[req.user.partner_id]);res.json(rows);}));

app.post('/api/partner/meetings/:id/respond',requirePartner,safe(async(req,res)=>{const [row]=await q(`SELECT pm.title,pm.action_type,pm.status,pm.response_due_date,pmr.response_status FROM partner_meeting_responses pmr JOIN partner_meetings pm ON pm.id=pmr.meeting_id WHERE pmr.meeting_id=? AND pmr.partner_id=?`,[req.params.id,req.user.partner_id]);if(!row)return res.status(404).json({message:'Meeting or resolution is not assigned to you.'});if(row.status!=='published')return res.status(409).json({message:'This decision record is no longer open for response.'});if(row.response_status!=='pending')return res.status(409).json({message:'Your response has already been recorded.'});const response=row.action_type==='acknowledgement'?'acknowledged':(['approved','rejected'].includes(req.body.response_status)?req.body.response_status:null);if(!response)return res.status(400).json({message:'Approve or reject this resolution.'});await q(`UPDATE partner_meeting_responses SET response_status=?,comment=?,responded_at=NOW() WHERE meeting_id=? AND partner_id=?`,[response,text(req.body.comment),req.params.id,req.user.partner_id]);await audit(req,`${response[0].toUpperCase()+response.slice(1)} partner decision`,'partner_meeting',String(req.params.id));await notifyRole('group_admin','Partner decision received',`${req.user.name||'A partner'} ${response}: ${row.title}`,'info','/partner-governance',`meeting-response-${req.params.id}-${req.user.partner_id}`);res.json({ok:true});}));

app.get('/api/partner/transactions',requirePartner,safe(async(req,res)=>{const partnerId=req.user.partner_id,companyId=Number(req.query.company_id),from=text(req.query.from),to=text(req.query.to);const [access]=await q('SELECT id FROM partner_company_access WHERE partner_id=? AND company_id=?',[partnerId,companyId]);if(!access)return res.status(403).json({message:'You do not have access to this company report.'});if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return res.status(400).json({message:'Valid report dates are required.'});const rows=await q(`SELECT ft.id,ft.date,ft.type,ft.category,ft.description,ft.amount,ft.currency FROM finance_transactions ft WHERE ft.company_id=? AND ft.date BETWEEN ? AND ? ORDER BY ft.date DESC,ft.id DESC`,[companyId,from,to]);const income=rows.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.amount),0),expense=rows.filter(x=>x.type==='expense').reduce((s,x)=>s+Number(x.amount),0);res.json({summary:{income,expense,net:income-expense,count:rows.length},transactions:rows});}));

app.patch('/api/partner/tasks/:id',requirePartner,safe(async(req,res)=>{const status=['pending','in_progress','completed'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({message:'Valid task status is required.'});const result=await q(`UPDATE partner_tasks SET status=? WHERE id=? AND partner_id=?`,[status,req.params.id,req.user.partner_id]);if(!result.affectedRows)return res.status(404).json({message:'Task not found.'});res.json({ok:true});}));

app.put('/api/partner/change-password',requirePartner,safe(async(req,res)=>{const [user]=await q(`SELECT id,password_hash FROM users WHERE id=? AND role='partner' AND status='active'`,[req.user.id]);if(!user||!await bcrypt.compare(String(req.body.current_password||''),user.password_hash))return res.status(401).json({message:'Current password is incorrect.'});const next=String(req.body.new_password||'');if(next.length<8||!/[A-Z]/.test(next)||!/[a-z]/.test(next)||!/[0-9]/.test(next))return res.status(400).json({message:'New password must contain at least 8 characters, uppercase, lowercase and a number.'});if(await bcrypt.compare(next,user.password_hash))return res.status(400).json({message:'New password must be different from your current password.'});await q('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(next,12),user.id]);await audit(req,'Changed partner portal password','partner_profile',String(req.user.partner_id));res.json({ok:true});}));

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
                 e.salary,e.phone,e.email,e.status
          FROM employees e
          JOIN companies c ON c.id=e.company_id`
  },
  payroll: {
    permission: 'payroll.view',
    companyColumn: 'e.company_id',
    sql: `SELECT p.id,p.employee_id,e.company_id,p.month,e.name employee_name,
                 e.employee_code,e.designation,c.name company_name,
                 p.gross_salary,p.deduction,p.net_salary,p.status,
                 DATE_FORMAT(p.paid_date,'%Y-%m-%d') paid_date
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
app.get(
  '/api/finance/invoice-settings/:companyId',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const companyId = Number(req.params.companyId);
    const access = req.access || await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, 'finance.view', companyId)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    const [company] = await q(
      `SELECT id,name,legal_name,country
       FROM companies
       WHERE id=?
       LIMIT 1`,
      [companyId]
    );

    if (!company) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    const [settings] = await q(
      `SELECT *
       FROM finance_invoice_settings
       WHERE company_id=?
       LIMIT 1`,
      [companyId]
    );

    res.json({
      company,
      settings: settings || {
        company_id: companyId,
        invoice_prefix: 'INV',
        logo_url: '',
        company_address: '',
        tax_label: '',
        tax_number: '',
        payment_terms: '',
        payment_instructions: '',
        bank_name: '',
        bank_account_name: '',
        bank_account_number: '',
        bank_iban: '',
        bank_swift: '',
        authorized_signatory: '',
        signature_note: '',
        footer_note: ''
      }
    });
  })
);
app.put(
  '/api/finance/invoice-settings/:companyId',
  requireEffectivePermission('finance.edit'),
  safe(async (req, res) => {
    const companyId = Number(req.params.companyId);
    const access = req.access || await buildUserAccess(req.user);

    if (!hasEffectivePermission(access, 'finance.edit', companyId)) {
      return res.status(403).json({
        message: 'You do not have access to this company.'
      });
    }

    const {
      invoice_prefix='INV',
      logo_url,
      company_address,
      tax_label,
      tax_number,
      payment_terms,
      payment_instructions,
      bank_name,
      bank_account_name,
      bank_account_number,
      bank_iban,
      bank_swift,
      authorized_signatory,
      signature_note,
      footer_note
    } = req.body;

    const cleanPrefix =
      text(invoice_prefix || 'INV')
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 30) || 'INV';

    await q(
      `INSERT INTO finance_invoice_settings
       (
         company_id,invoice_prefix,logo_url,company_address,
         tax_label,tax_number,payment_terms,payment_instructions,
         bank_name,bank_account_name,bank_account_number,
         bank_iban,bank_swift,authorized_signatory,
         signature_note,footer_note
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         invoice_prefix=VALUES(invoice_prefix),
         logo_url=VALUES(logo_url),
         company_address=VALUES(company_address),
         tax_label=VALUES(tax_label),
         tax_number=VALUES(tax_number),
         payment_terms=VALUES(payment_terms),
         payment_instructions=VALUES(payment_instructions),
         bank_name=VALUES(bank_name),
         bank_account_name=VALUES(bank_account_name),
         bank_account_number=VALUES(bank_account_number),
         bank_iban=VALUES(bank_iban),
         bank_swift=VALUES(bank_swift),
         authorized_signatory=VALUES(authorized_signatory),
         signature_note=VALUES(signature_note),
         footer_note=VALUES(footer_note)`,
      [
        companyId,
        cleanPrefix,
        text(logo_url),
        text(company_address),
        text(tax_label),
        text(tax_number),
        text(payment_terms),
        text(payment_instructions),
        text(bank_name),
        text(bank_account_name),
        text(bank_account_number),
        text(bank_iban),
        text(bank_swift),
        text(authorized_signatory),
        text(signature_note),
        text(footer_note)
      ]
    );

    await audit(
      req,
      'Updated invoice settings',
      'finance_invoice_settings',
      `Company #${companyId}`
    );

    res.json({ ok: true });
  })
);


app.put(
  '/api/finance/:id/approve',
  requireEffectivePermission('finance.view'),
  loadFinanceForApproval,
  requireFinanceApprovalAccess,
  safe(async (req, res) => {
    const row = req.financeRecord;

    if (row.approval_status === 'approved') {
      return res.status(409).json({
        message: 'This transaction is already approved.'
      });
    }

    if (row.approval_status === 'rejected') {
      return res.status(409).json({
        message:
          'Rejected transactions must be corrected and resubmitted before approval.'
      });
    }

    await q(
      `UPDATE finance_transactions
       SET
         approval_status='approved',
         approved_by=?,
         approved_at=NOW(),
         rejected_by=NULL,
         rejected_at=NULL,
         rejection_reason=NULL
       WHERE id=?`,
      [
        req.user?.id || null,
        row.id
      ]
    );

    await audit(
      req,
      'Approved finance transaction',
      'finance',
      row.description ||
        row.category ||
        `Transaction #${row.id}`
    );

    res.json({
      ok: true,
      approval_status: 'approved'
    });
  })
);



app.put(
  '/api/finance/:id/reject',
  requireEffectivePermission('finance.view'),
  loadFinanceForApproval,
  requireFinanceApprovalAccess,
  safe(async (req, res) => {
    const row = req.financeRecord;
    const reason = text(req.body?.reason);

    if (!reason) {
      return res.status(400).json({
        message: 'Rejection reason is required.'
      });
    }

    if (reason.length > 500) {
      return res.status(400).json({
        message:
          'Rejection reason must be 500 characters or less.'
      });
    }

    if (row.approval_status === 'approved') {
      return res.status(409).json({
        message:
          'Approved transactions cannot be rejected.'
      });
    }

    await q(
      `UPDATE finance_transactions
       SET
         approval_status='rejected',
         rejected_by=?,
         rejected_at=NOW(),
         rejection_reason=?,
         approved_by=NULL,
         approved_at=NULL
       WHERE id=?`,
      [
        req.user?.id || null,
        reason,
        row.id
      ]
    );

    await audit(
      req,
      'Rejected finance transaction',
      'finance',
      row.description ||
        row.category ||
        `Transaction #${row.id}`
    );

    res.json({
      ok: true,
      approval_status: 'rejected'
    });
  })
);


app.put(
  '/api/finance/:id/resubmit',
  requireEffectivePermission('finance.edit'),
  safe(async (req, res) => {
    const financeId = Number(req.params.id);

    const [row] = await q(
      `SELECT
         id,
         company_id,
         approval_status,
         description,
         category
       FROM finance_transactions
       WHERE id=?
       LIMIT 1`,
      [financeId]
    );

    if (!row) {
      return res.status(404).json({
        message: 'Finance transaction not found.'
      });
    }

    const access =
      req.access || await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.edit',
        row.company_id
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    if (row.approval_status !== 'rejected') {
      return res.status(409).json({
        message:
          'Only rejected transactions can be resubmitted.'
      });
    }

    await q(
      `UPDATE finance_transactions
       SET
         approval_status='pending',
         approved_by=NULL,
         approved_at=NULL,
         rejected_by=NULL,
         rejected_at=NULL,
         rejection_reason=NULL
       WHERE id=?`,
      [financeId]
    );

    await audit(
      req,
      'Resubmitted finance transaction for approval',
      'finance',
      row.description ||
        row.category ||
        `Transaction #${row.id}`
    );

    res.json({
      ok: true,
      approval_status: 'pending'
    });
  })
);

app.get(
  '/api/finance-approvals/pending',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const access =
      req.access || await buildUserAccess(req.user);

    if (access.globalRole === 'group_admin') {
      return res.json(
        await q(
          `SELECT
             f.id,
             f.company_id,
             c.name company_name,
             DATE_FORMAT(f.date,'%Y-%m-%d') date,
             f.type,
             f.category,
             f.description,
             f.amount,
             f.currency,
             f.approval_status,
             u.name created_by_name
           FROM finance_transactions f
           JOIN companies c
             ON c.id=f.company_id
           LEFT JOIN users u
             ON u.id=f.created_by
           WHERE f.approval_status='pending'
           ORDER BY f.id DESC`
        )
      );
    }

    const companyIds =
      companyIdsFromAccess(access)
        .filter(companyId =>
          canApproveFinance(access, companyId)
        );

    if (!companyIds.length) {
      return res.json([]);
    }

    const placeholders =
      companyIds.map(() => '?').join(',');

    res.json(
      await q(
        `SELECT
           f.id,
           f.company_id,
           c.name company_name,
           DATE_FORMAT(f.date,'%Y-%m-%d') date,
           f.type,
           f.category,
           f.description,
           f.amount,
           f.currency,
           f.approval_status,
           u.name created_by_name
         FROM finance_transactions f
         JOIN companies c
           ON c.id=f.company_id
         LEFT JOIN users u
           ON u.id=f.created_by
         WHERE f.approval_status='pending'
           AND f.company_id IN (${placeholders})
         ORDER BY f.id DESC`,
        companyIds
      )
    );
  })
);

app.get(
  '/api/sales-invoices',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const access =
      req.access ||
      await buildUserAccess(req.user);

    const baseSql = `
      SELECT
        si.id,
        si.company_id,
        si.invoice_number,
        c.name company_name,

        si.customer_name,
        si.customer_email,

        DATE_FORMAT(
          si.invoice_date,
          '%Y-%m-%d'
        ) invoice_date,

        DATE_FORMAT(
          si.due_date,
          '%Y-%m-%d'
        ) due_date,

        si.currency,
        si.subtotal,
        si.tax_amount,
        si.discount_amount,
        si.total_amount,
        si.paid_amount,
        si.balance_amount,
        si.status,

        CASE
          WHEN
            si.status IN (
              'issued',
              'partially_paid'
            )
            AND si.balance_amount > 0
            AND si.due_date IS NOT NULL
            AND si.due_date < CURDATE()
            THEN 'overdue'
          ELSE si.status
        END display_status,

        u.name created_by_name,

        DATE_FORMAT(
          si.created_at,
          '%Y-%m-%d %H:%i'
        ) created_at

      FROM sales_invoices si

      JOIN companies c
        ON c.id=si.company_id

      LEFT JOIN users u
        ON u.id=si.created_by
    `;

    if (
      access.globalRole ===
      'group_admin'
    ) {
      return res.json(
        await q(
          `${baseSql}
           ORDER BY si.id DESC`
        )
      );
    }

    const companyIds =
      companyIdsFromAccess(access)
        .filter(companyId =>
          hasEffectivePermission(
            access,
            'finance.view',
            companyId
          )
        );

    if (!companyIds.length) {
      return res.json([]);
    }

    const placeholders =
      companyIds
        .map(() => '?')
        .join(',');

    res.json(
      await q(
        `${baseSql}
         WHERE si.company_id
           IN (${placeholders})
         ORDER BY si.id DESC`,
        companyIds
      )
    );
  })
);




app.get(
  '/api/sales-invoices/:id',
  requireEffectivePermission('finance.view'),
  safe(async (req, res) => {
    const invoiceId =
      Number(req.params.id);
const [invoiceSettings] = await q(
  `SELECT *
   FROM finance_invoice_settings
   WHERE company_id=?
   LIMIT 1`,
  [invoice.company_id]
);

Return:

res.json({
  invoice,
  items,
  payments,
  invoice_settings: invoiceSettings || null
});
    const [invoice] = await q(
      `SELECT
         si.*,
         c.name company_name,

         creator.name created_by_name,
         issuer.name issued_by_name,

         DATE_FORMAT(
           si.invoice_date,
           '%Y-%m-%d'
         ) invoice_date,

         DATE_FORMAT(
           si.due_date,
           '%Y-%m-%d'
         ) due_date,

         DATE_FORMAT(
           si.issued_at,
           '%Y-%m-%d %H:%i'
         ) issued_at

       FROM sales_invoices si

       JOIN companies c
         ON c.id=si.company_id

       LEFT JOIN users creator
         ON creator.id=si.created_by

       LEFT JOIN users issuer
         ON issuer.id=si.issued_by

       WHERE si.id=?
       LIMIT 1`,
      [invoiceId]
    );

    if (!invoice) {
      return res.status(404).json({
        message:
          'Sales invoice not found.'
      });
    }

    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.view',
        invoice.company_id
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    const items = await q(
      `SELECT
         id,
         item_name,
         description,
         quantity,
         unit_price,
         line_subtotal,
         tax_rate,
         tax_amount,
         line_total,
         sort_order
       FROM sales_invoice_items
       WHERE invoice_id=?
       ORDER BY sort_order,id`,
      [invoiceId]
    );

    const payments = await q(
      `SELECT
         p.id,
         DATE_FORMAT(
           p.payment_date,
           '%Y-%m-%d'
         ) payment_date,
         p.amount,
         p.currency,
         p.payment_method,
         p.reference_number,
         p.notes,
         u.name received_by_name
       FROM customer_payments p
       LEFT JOIN users u
         ON u.id=p.received_by
       WHERE p.invoice_id=?
       ORDER BY p.payment_date DESC,p.id DESC`,
      [invoiceId]
    );

    res.json({
      invoice,
      items,
      payments
    });
  })
);



app.post(
  '/api/sales-invoices',
  requireEffectivePermission(
    'finance.create'
  ),
  requireBodyCompanyAccess(
    'finance.create'
  ),
  safe(async (req, res) => {
    const {
      company_id,
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      customer_tax_number,
      invoice_date,
      due_date,
      currency = 'INR',
      discount_amount = 0,
      notes,
      terms,
      items = []
    } = req.body;

    if (!company_id) {
      return res.status(400).json({
        message: 'Company is required.'
      });
    }

    if (!text(customer_name)) {
      return res.status(400).json({
        message:
          'Customer name is required.'
      });
    }

    if (!invoice_date) {
      return res.status(400).json({
        message:
          'Invoice date is required.'
      });
    }

    const calculated =
      calculateInvoiceTotals(
        items,
        discount_amount
      );

    const conn =
      await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [result] =
        await conn.query(
          `INSERT INTO sales_invoices
           (
             company_id,
             customer_name,
             customer_email,
             customer_phone,
             customer_address,
             customer_tax_number,
             invoice_date,
             due_date,
             currency,
             subtotal,
             tax_rate,
             tax_amount,
             discount_amount,
             total_amount,
             paid_amount,
             balance_amount,
             status,
             notes,
             terms,
             created_by
           )
           VALUES
           (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            company_id,
            text(customer_name),
            text(customer_email),
            text(customer_phone),
            text(customer_address),
            text(customer_tax_number),

            invoice_date,
            nullable(due_date),

            currency || 'INR',

            calculated.subtotal,

            0,

            calculated.tax_amount,
            calculated.discount_amount,
            calculated.total_amount,

            0,
            calculated.total_amount,

            'draft',

            text(notes),
            text(terms),

            req.user?.id || null
          ]
        );

      const invoiceId =
        result.insertId;

      // Load company invoice prefix
      const [settingsRows] =
        await conn.query(
          `SELECT invoice_prefix
           FROM finance_invoice_settings
           WHERE company_id=?
           LIMIT 1`,
          [company_id]
        );

      const prefix =
        settingsRows[0]
          ?.invoice_prefix ||
        'INV';

      const invoiceYear =
        String(invoice_date)
          .slice(0, 4);

      const invoiceNumber =
        `${prefix}-${invoiceYear}-${String(
          invoiceId
        ).padStart(5, '0')}`;

      await conn.query(
        `UPDATE sales_invoices
         SET invoice_number=?
         WHERE id=?`,
        [
          invoiceNumber,
          invoiceId
        ]
      );

      for (
        const item
        of calculated.items
      ) {
        await conn.query(
          `INSERT INTO sales_invoice_items
           (
             invoice_id,
             item_name,
             description,
             quantity,
             unit_price,
             line_subtotal,
             tax_rate,
             tax_amount,
             line_total,
             sort_order
           )
           VALUES
           (?,?,?,?,?,?,?,?,?,?)`,
          [
            invoiceId,
            item.item_name,
            item.description,
            item.quantity,
            item.unit_price,
            item.line_subtotal,
            item.tax_rate,
            item.tax_amount,
            item.line_total,
            item.sort_order
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (
           user_id,
           action,
           entity_type,
           entity_name,
           ip_address
         )
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Created sales invoice',
          'sales_invoice',
          invoiceNumber,
          req.ip
        ]
      );

      await conn.commit();

      res.status(201).json({
        id: invoiceId,
        invoice_number:
          invoiceNumber,
        status: 'draft'
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);



app.put(
  '/api/sales-invoices/:id',
  requireEffectivePermission(
    'finance.edit'
  ),
  safe(async (req, res) => {
    const invoiceId =
      Number(req.params.id);

    const [existing] = await q(
      `SELECT
         id,
         company_id,
         invoice_number,
         status
       FROM sales_invoices
       WHERE id=?
       LIMIT 1`,
      [invoiceId]
    );

    if (!existing) {
      return res.status(404).json({
        message:
          'Sales invoice not found.'
      });
    }

    if (
      existing.status !== 'draft'
    ) {
      return res.status(409).json({
        message:
          'Only draft invoices can be edited.'
      });
    }

    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.edit',
        existing.company_id
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      invoice_date,
      due_date,
      currency='INR',
      discount_amount=0,
      notes,
      terms,
      items=[]
    } = req.body;

    if (!text(customer_name)) {
      return res.status(400).json({
        message:
          'Customer name is required.'
      });
    }

    if (!invoice_date) {
      return res.status(400).json({
        message:
          'Invoice date is required.'
      });
    }

    const calculated =
      calculateInvoiceTotals(
        items,
        discount_amount
      );

    const conn =
      await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE sales_invoices
         SET
           customer_name=?,
           customer_email=?,
           customer_phone=?,
           customer_address=?,
           invoice_date=?,
           due_date=?,
           currency=?,
           subtotal=?,
           tax_rate=?,
           tax_amount=?,
           discount_amount=?,
           total_amount=?,
           balance_amount=?,
           notes=?,
           terms=?
         WHERE id=?`,
        [
          text(customer_name),
          text(customer_email),
          text(customer_phone),
          text(customer_address),
          invoice_date,
          nullable(due_date),
          currency || 'INR',
          calculated.subtotal,
          0,
          calculated.tax_amount,
          calculated.discount_amount,
          calculated.total_amount,
          calculated.total_amount,
          text(notes),
          text(terms),
          invoiceId
        ]
      );

      await conn.query(
        `DELETE FROM
         sales_invoice_items
         WHERE invoice_id=?`,
        [invoiceId]
      );

      for (
        const item
        of calculated.items
      ) {
        await conn.query(
          `INSERT INTO sales_invoice_items
           (
             invoice_id,
             item_name,
             description,
             quantity,
             unit_price,
             line_subtotal,
             tax_rate,
             tax_amount,
             line_total,
             sort_order
           )
           VALUES
           (?,?,?,?,?,?,?,?,?,?)`,
          [
            invoiceId,
            item.item_name,
            item.description,
            item.quantity,
            item.unit_price,
            item.line_subtotal,
            item.tax_rate,
            item.tax_amount,
            item.line_total,
            item.sort_order
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (
           user_id,
           action,
           entity_type,
           entity_name,
           ip_address
         )
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Updated sales invoice',
          'sales_invoice',
          existing.invoice_number,
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




app.put(
  '/api/sales-invoices/:id/issue',
  requireEffectivePermission(
    'finance.edit'
  ),
  safe(async (req, res) => {
    const invoiceId =
      Number(req.params.id);

    const [invoice] = await q(
      `SELECT
         id,
         company_id,
         invoice_number,
         total_amount,
         status
       FROM sales_invoices
       WHERE id=?
       LIMIT 1`,
      [invoiceId]
    );

    if (!invoice) {
      return res.status(404).json({
        message:
          'Sales invoice not found.'
      });
    }

    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.edit',
        invoice.company_id
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    if (
      invoice.status !== 'draft'
    ) {
      return res.status(409).json({
        message:
          'Only draft invoices can be issued.'
      });
    }

    if (
      Number(invoice.total_amount) <= 0
    ) {
      return res.status(400).json({
        message:
          'Invoice total must be greater than zero.'
      });
    }

    await q(
      `UPDATE sales_invoices
       SET
         status='issued',
         issued_by=?,
         issued_at=NOW()
       WHERE id=?`,
      [
        req.user?.id || null,
        invoiceId
      ]
    );

    await audit(
      req,
      'Issued sales invoice',
      'sales_invoice',
      invoice.invoice_number
    );

    res.json({
      ok: true,
      status: 'issued'
    });
  })
);




app.put(
  '/api/sales-invoices/:id/cancel',
  requireEffectivePermission(
    'finance.edit'
  ),
  safe(async (req, res) => {
    const invoiceId =
      Number(req.params.id);

    const [invoice] = await q(
      `SELECT
         id,
         company_id,
         invoice_number,
         status,
         paid_amount
       FROM sales_invoices
       WHERE id=?
       LIMIT 1`,
      [invoiceId]
    );

    if (!invoice) {
      return res.status(404).json({
        message:
          'Sales invoice not found.'
      });
    }

    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.edit',
        invoice.company_id
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    if (
      Number(invoice.paid_amount) > 0
    ) {
      return res.status(409).json({
        message:
          'Invoices with recorded payments cannot be cancelled.'
      });
    }

    if (
      invoice.status === 'paid'
    ) {
      return res.status(409).json({
        message:
          'Paid invoices cannot be cancelled.'
      });
    }

    await q(
      `UPDATE sales_invoices
       SET status='cancelled'
       WHERE id=?`,
      [invoiceId]
    );

    await audit(
      req,
      'Cancelled sales invoice',
      'sales_invoice',
      invoice.invoice_number
    );

    res.json({
      ok: true,
      status: 'cancelled'
    });
  })
);



app.get(
  '/api/finance/receivables',
  requireEffectivePermission(
    'finance.view'
  ),
  safe(async (req, res) => {
    const access =
      req.access ||
      await buildUserAccess(req.user);

    const baseSql = `
      SELECT
        r.invoice_id,
        r.company_id,
        c.name company_name,

        r.invoice_number,
        r.customer_name,

        DATE_FORMAT(
          r.invoice_date,
          '%Y-%m-%d'
        ) invoice_date,

        DATE_FORMAT(
          r.due_date,
          '%Y-%m-%d'
        ) due_date,

        r.currency,
        r.total_amount,
        r.paid_amount,
        r.balance_amount,
        r.receivable_status,
        r.days_overdue

      FROM finance_receivables r

      JOIN companies c
        ON c.id=r.company_id
    `;

    if (
      access.globalRole ===
      'group_admin'
    ) {
      return res.json(
        await q(
          `${baseSql}
           ORDER BY
             r.days_overdue DESC,
             r.due_date`
        )
      );
    }

    const companyIds =
      companyIdsFromAccess(access)
        .filter(companyId =>
          hasEffectivePermission(
            access,
            'finance.view',
            companyId
          )
        );

    if (!companyIds.length) {
      return res.json([]);
    }

    const placeholders =
      companyIds
        .map(() => '?')
        .join(',');

    res.json(
      await q(
        `${baseSql}
         WHERE r.company_id
           IN (${placeholders})
         ORDER BY
           r.days_overdue DESC,
           r.due_date`,
        companyIds
      )
    );
  })
);




app.get(
  '/api/customer-payments',
  requireEffectivePermission(
    'finance.view'
  ),
  safe(async (req, res) => {
    const access =
      req.access ||
      await buildUserAccess(req.user);

    const baseSql = `
      SELECT
        p.id,
        p.company_id,
        c.name company_name,

        p.invoice_id,
        si.invoice_number,
        si.customer_name,

        DATE_FORMAT(
          p.payment_date,
          '%Y-%m-%d'
        ) payment_date,

        p.amount,
        p.currency,
        p.payment_method,
        p.reference_number,
        p.notes,

        u.name received_by_name

      FROM customer_payments p

      JOIN companies c
        ON c.id=p.company_id

      LEFT JOIN sales_invoices si
        ON si.id=p.invoice_id

      LEFT JOIN users u
        ON u.id=p.received_by
    `;

    if (
      access.globalRole ===
      'group_admin'
    ) {
      return res.json(
        await q(
          `${baseSql}
           ORDER BY
             p.payment_date DESC,
             p.id DESC`
        )
      );
    }

    const companyIds =
      companyIdsFromAccess(access)
        .filter(companyId =>
          hasEffectivePermission(
            access,
            'finance.view',
            companyId
          )
        );

    if (!companyIds.length) {
      return res.json([]);
    }

    const placeholders =
      companyIds
        .map(() => '?')
        .join(',');

    res.json(
      await q(
        `${baseSql}
         WHERE p.company_id
           IN (${placeholders})
         ORDER BY
           p.payment_date DESC,
           p.id DESC`,
        companyIds
      )
    );
  })
);




app.post(
  '/api/customer-payments',
  requireEffectivePermission(
    'finance.create'
  ),
  safe(async (req, res) => {
    const {
      company_id,
      invoice_id,
      payment_date,
      amount,
      currency='INR',
      payment_method='bank_transfer',
      reference_number,
      notes
    } = req.body;

    const companyId =
      Number(company_id);

    const invoiceId =
      invoice_id
        ? Number(invoice_id)
        : null;

    if (!companyId) {
      return res.status(400).json({
        message:
          'Company is required.'
      });
    }

    if (!payment_date) {
      return res.status(400).json({
        message:
          'Payment date is required.'
      });
    }

    const amountNumber =
      Number(amount);

    if (
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0
    ) {
      return res.status(400).json({
        message:
          'Payment amount must be greater than zero.'
      });
    }

    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      !hasEffectivePermission(
        access,
        'finance.create',
        companyId
      )
    ) {
      return res.status(403).json({
        message:
          'You do not have access to this company.'
      });
    }

    const allowedMethods =
      new Set([
        'cash',
        'bank_transfer',
        'card',
        'cheque',
        'upi',
        'other'
      ]);

    const cleanMethod =
      allowedMethods.has(
        payment_method
      )
        ? payment_method
        : 'other';

    const conn =
      await pool.getConnection();

    try {
      await conn.beginTransaction();

      let invoice = null;

      if (invoiceId) {
        const [rows] =
          await conn.query(
            `SELECT
               id,
               company_id,
               invoice_number,
               status,
               total_amount,
               paid_amount,
               balance_amount
             FROM sales_invoices
             WHERE id=?
             FOR UPDATE`,
            [invoiceId]
          );

        invoice =
          rows[0];

        if (!invoice) {
          await conn.rollback();

          return res.status(404).json({
            message:
              'Sales invoice not found.'
          });
        }

        if (
          Number(invoice.company_id)
          !== companyId
        ) {
          await conn.rollback();

          return res.status(400).json({
            message:
              'Invoice belongs to a different company.'
          });
        }

        if (
          ![
            'issued',
            'partially_paid'
          ].includes(invoice.status)
        ) {
          await conn.rollback();

          return res.status(409).json({
            message:
              'Payments can only be recorded against issued invoices.'
          });
        }

        if (
          amountNumber >
          Number(invoice.balance_amount)
        ) {
          await conn.rollback();

          return res.status(400).json({
            message:
              'Payment cannot exceed the outstanding invoice balance.'
          });
        }
      }

      const [paymentResult] =
        await conn.query(
          `INSERT INTO customer_payments
           (
             company_id,
             invoice_id,
             payment_date,
             amount,
             currency,
             payment_method,
             reference_number,
             notes,
             received_by
           )
           VALUES
           (?,?,?,?,?,?,?,?,?)`,
          [
            companyId,
            invoiceId,
            payment_date,
            amountNumber,
            currency || 'INR',
            cleanMethod,
            text(reference_number),
            text(notes),
            req.user?.id || null
          ]
        );

      if (invoice) {
        const newPaid =
          Number(
            (
              Number(
                invoice.paid_amount
              ) +
              amountNumber
            ).toFixed(2)
          );

        const newBalance =
          Number(
            Math.max(
              0,
              Number(
                invoice.total_amount
              ) -
              newPaid
            ).toFixed(2)
          );

        const newStatus =
          newBalance <= 0
            ? 'paid'
            : 'partially_paid';

        await conn.query(
          `UPDATE sales_invoices
           SET
             paid_amount=?,
             balance_amount=?,
             status=?
           WHERE id=?`,
          [
            newPaid,
            newBalance,
            newStatus,
            invoiceId
          ]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs
         (
           user_id,
           action,
           entity_type,
           entity_name,
           ip_address
         )
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Recorded customer payment',
          'customer_payment',
          invoice
            ? invoice.invoice_number
            : `Payment #${paymentResult.insertId}`,
          req.ip
        ]
      );

      await conn.commit();

      res.status(201).json({
        id:
          paymentResult.insertId,
        ok: true
      });
    } catch (err) {
      try {
        await conn.rollback();
      } catch {}

      throw err;
    } finally {
      conn.release();
    }
  })
);


app.delete(
  '/api/customer-payments/:id',
  requireEffectivePermission(
    'finance.edit'
  ),
  safe(async (req, res) => {
    const paymentId =
      Number(req.params.id);

    const conn =
      await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] =
        await conn.query(
          `SELECT
             id,
             company_id,
             invoice_id,
             amount,
             payment_date
           FROM customer_payments
           WHERE id=?
           FOR UPDATE`,
          [paymentId]
        );

      const payment =
        rows[0];

      if (!payment) {
        await conn.rollback();

        return res.status(404).json({
          message:
            'Payment not found.'
        });
      }

      const access =
        req.access ||
        await buildUserAccess(
          req.user
        );

      if (
        !hasEffectivePermission(
          access,
          'finance.edit',
          payment.company_id
        )
      ) {
        await conn.rollback();

        return res.status(403).json({
          message:
            'You do not have access to this company.'
        });
      }

      if (payment.invoice_id) {
        const [invoiceRows] =
          await conn.query(
            `SELECT
               id,
               invoice_number,
               total_amount,
               paid_amount,
               status
             FROM sales_invoices
             WHERE id=?
             FOR UPDATE`,
            [
              payment.invoice_id
            ]
          );

        const invoice =
          invoiceRows[0];

        if (invoice) {
          const newPaid =
            Number(
              Math.max(
                0,
                Number(
                  invoice.paid_amount
                ) -
                Number(
                  payment.amount
                )
              ).toFixed(2)
            );

          const newBalance =
            Number(
              Math.max(
                0,
                Number(
                  invoice.total_amount
                ) -
                newPaid
              ).toFixed(2)
            );

          const newStatus =
            newPaid <= 0
              ? 'issued'
              : 'partially_paid';

          await conn.query(
            `UPDATE sales_invoices
             SET
               paid_amount=?,
               balance_amount=?,
               status=?
             WHERE id=?`,
            [
              newPaid,
              newBalance,
              newStatus,
              payment.invoice_id
            ]
          );
        }
      }

      await conn.query(
        `DELETE FROM customer_payments
         WHERE id=?`,
        [paymentId]
      );

      await conn.query(
        `INSERT INTO audit_logs
         (
           user_id,
           action,
           entity_type,
           entity_name,
           ip_address
         )
         VALUES (?,?,?,?,?)`,
        [
          req.user?.id || null,
          'Reversed customer payment',
          'customer_payment',
          `Payment #${paymentId}`,
          req.ip
        ]
      );

      await conn.commit();

      res.json({ ok: true });
    } catch (err) {
      try {
        await conn.rollback();
      } catch {}

      throw err;
    } finally {
      conn.release();
    }
  })
);

app.get(
  '/api/finance/receivables-summary',
  requireEffectivePermission(
    'finance.view'
  ),
  safe(async (req, res) => {
    const access =
      req.access ||
      await buildUserAccess(req.user);

    if (
      access.globalRole ===
      'group_admin'
    ) {
      const [[summary]] =
        await pool.query(
          `SELECT
             COUNT(*) invoice_count,
             COALESCE(
               SUM(balance_amount),
               0
             ) outstanding,
             COALESCE(
               SUM(
                 CASE
                   WHEN
                     due_date IS NOT NULL
                     AND due_date < CURDATE()
                   THEN balance_amount
                   ELSE 0
                 END
               ),
               0
             ) overdue
           FROM finance_receivables`
        );

      return res.json(summary);
    }

    const companyIds =
      companyIdsFromAccess(access)
        .filter(companyId =>
          hasEffectivePermission(
            access,
            'finance.view',
            companyId
          )
        );

    if (!companyIds.length) {
      return res.json({
        invoice_count: 0,
        outstanding: 0,
        overdue: 0
      });
    }

    const placeholders =
      companyIds
        .map(() => '?')
        .join(',');

    const [[summary]] =
      await pool.query(
        `SELECT
           COUNT(*) invoice_count,
           COALESCE(
             SUM(balance_amount),
             0
           ) outstanding,
           COALESCE(
             SUM(
               CASE
                 WHEN
                   due_date IS NOT NULL
                   AND due_date < CURDATE()
                 THEN balance_amount
                 ELSE 0
               END
             ),
             0
           ) overdue
         FROM finance_receivables
         WHERE company_id
           IN (${placeholders})`,
        companyIds
      );

    res.json(summary);
  })
);



// ---------- MONTHLY INTEREST COLLECTIONS ----------

const requireCollectionAccess = safe(async (req, res, next) => {
  if (req.user?.role === 'frontdesk') return next();
  const access = await buildUserAccess(req.user);
  if (hasEffectivePermission(access, 'finance.view')) {
    req.access = access;
    return next();
  }
  return res.status(403).json({ message: 'Collection access is required.' });
});

const collectionCompanyIds = async req => {
  if (req.user?.role === 'frontdesk') {
    const rows = await q(
      `SELECT id FROM companies
       WHERE is_parent=0 AND status='active'
       ORDER BY name`
    );
    return rows.map(row => Number(row.id)).filter(Boolean);
  }
  const access = req.access || await buildUserAccess(req.user);
  return access.globalRole === 'group_admin'
    ? (await q('SELECT id FROM companies WHERE is_parent=0 AND status="active"')).map(row => Number(row.id))
    : companyIdsFromAccess(access).filter(id => hasEffectivePermission(access, 'finance.view', id));
};

const ensureCollectionCompany = async (req, companyId) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.includes(Number(companyId))) {
    const err = new Error('You do not have collection access to this company.');
    err.statusCode = 403;
    throw err;
  }
};

const withIdCardUrl = async row => {
  if (!row?.id_card_storage_key || !process.env.S3_BUCKET) return row;
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: row.id_card_storage_key,
    ResponseContentDisposition: 'inline'
  });
  return { ...row, id_card_url: await getSignedUrl(s3, command, { expiresIn: 900 }) };
};

app.get('/api/collections/companies', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json([]);
  res.json(await q(`SELECT id,name,currency FROM companies WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`, ids));
}));

app.get('/api/collections/summary', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json({ active_customers: 0, principal_outstanding: 0, monthly_interest: 0, due_now: 0, collected_this_month: 0 });
  const placeholders = ids.map(() => '?').join(',');
  const [summary] = await q(
    `SELECT COUNT(*) active_customers,
            COALESCE(SUM(principal_amount),0) principal_outstanding,
            COALESCE(SUM(monthly_interest_amount),0) monthly_interest,
            COALESCE(SUM(next_interest_date<=CURDATE()),0) due_now
     FROM collection_customers WHERE status='active' AND approval_status='approved' AND company_id IN (${placeholders})`, ids
  );
  const [payments] = await q(
    `SELECT COALESCE(SUM(p.amount),0) collected_this_month
     FROM collection_payments p JOIN collection_customers c ON c.id=p.customer_id
     WHERE c.company_id IN (${placeholders}) AND (p.status IS NULL OR p.status='posted') AND DATE_FORMAT(p.payment_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`, ids
  );
  res.json({ ...summary, ...payments });
}));

app.get('/api/collections/dashboard', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json({ metrics: {}, due_customers: [], recent_payments: [] });
  const placeholders = ids.map(() => '?').join(',');
  const [metrics] = await q(
    `SELECT
       COUNT(*) active_customers,
       COALESCE(SUM(next_interest_date=CURDATE()),0) due_today,
       COALESCE(SUM(next_interest_date<CURDATE()),0) overdue_customers,
       COALESCE(SUM(CASE WHEN next_interest_date<=CURDATE() THEN monthly_interest_amount ELSE 0 END),0) expected_now,
       COALESCE(SUM(CASE WHEN next_interest_date=CURDATE() THEN monthly_interest_amount ELSE 0 END),0) expected_today
     FROM collection_customers
     WHERE status='active' AND approval_status='approved' AND company_id IN (${placeholders})`, ids
  );
  const [todayPayments] = await q(
    `SELECT COALESCE(SUM(cp.amount),0) collected_today,COUNT(*) payments_today
     FROM collection_payments cp
     JOIN collection_customers cc ON cc.id=cp.customer_id
     WHERE cc.company_id IN (${placeholders}) AND (cp.status IS NULL OR cp.status='posted') AND cp.payment_date=CURDATE()`, ids
  );
  const dueCustomers = await q(
    `SELECT cc.id,cc.customer_name,cc.phone,cc.next_interest_date,cc.monthly_interest_amount,
            cc.id_card_number,c.currency,DATEDIFF(CURDATE(),cc.next_interest_date) days_overdue
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id
     WHERE cc.status='active' AND cc.approval_status='approved' AND cc.company_id IN (${placeholders}) AND cc.next_interest_date<=CURDATE()
     ORDER BY cc.next_interest_date,cc.customer_name LIMIT 8`, ids
  );
  const recentPayments = await q(
    `SELECT cp.id,cp.amount,cp.payment_date,cp.payment_method,cp.created_at,
            cc.customer_name,c.currency,u.name collected_by_name
     FROM collection_payments cp
     JOIN collection_customers cc ON cc.id=cp.customer_id
     JOIN companies c ON c.id=cc.company_id
     LEFT JOIN users u ON u.id=cp.collected_by
     WHERE cc.company_id IN (${placeholders}) AND (cp.status IS NULL OR cp.status='posted')
     ORDER BY cp.created_at DESC LIMIT 7`, ids
  );
  res.json({ metrics: { ...metrics, ...todayPayments }, due_customers: dueCustomers, recent_payments: recentPayments });
}));

app.get('/api/collections/reminders', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json({ summary: { overdue: 0, due_today: 0, upcoming: 0 }, customers: [] });
  const placeholders = ids.map(() => '?').join(',');
  const customers = await q(
    `SELECT cc.id,cc.customer_name,cc.phone,cc.id_card_number,cc.next_interest_date,
            cc.monthly_interest_amount,cc.principal_amount,c.name company_name,c.currency,
            DATEDIFF(cc.next_interest_date,CURDATE()) days_until_due
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id
     WHERE cc.status='active' AND cc.approval_status='approved' AND cc.company_id IN (${placeholders})
       AND cc.next_interest_date<=DATE_ADD(CURDATE(),INTERVAL 7 DAY)
     ORDER BY cc.next_interest_date,cc.customer_name`, ids
  );
  res.json({ summary: {
    overdue: customers.filter(item => Number(item.days_until_due) < 0).length,
    due_today: customers.filter(item => Number(item.days_until_due) === 0).length,
    upcoming: customers.filter(item => Number(item.days_until_due) > 0).length
  }, customers });
}));

app.get('/api/collections/admin-dashboard', requireCollectionAccess, safe(async (req, res) => {
  if (req.user?.role === 'frontdesk') return res.status(403).json({ message: 'Finance administration access is required.' });
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json({ metrics: {}, companies: [], high_risk_customers: [], recent_voids: [], staff_activity: [] });
  const ph = ids.map(() => '?').join(',');
  const [portfolio] = await q(
    `SELECT COUNT(*) active_customers,COALESCE(SUM(principal_amount),0) principal_outstanding,
            COALESCE(SUM(monthly_interest_amount),0) monthly_interest,
            COALESCE(SUM(next_interest_date<CURDATE()),0) overdue_customers,
            COALESCE(SUM(CASE WHEN next_interest_date<CURDATE() THEN monthly_interest_amount ELSE 0 END),0) overdue_value
     FROM collection_customers WHERE status='active' AND approval_status='approved' AND company_id IN (${ph})`, ids
  );
  const [month] = await q(
    `SELECT COALESCE(SUM(cp.amount),0) collected_this_month,COUNT(*) receipts_this_month
     FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id
     WHERE cc.company_id IN (${ph}) AND (cp.status IS NULL OR cp.status='posted')
       AND DATE_FORMAT(cp.payment_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`, ids
  );
  const companies = await q(
    `SELECT c.id,c.name,c.currency,
            COUNT(cc.id) active_customers,
            COALESCE(SUM(cc.principal_amount),0) principal_outstanding,
            COALESCE(SUM(cc.next_interest_date<CURDATE()),0) overdue_customers,
            COALESCE(SUM(CASE WHEN cc.next_interest_date<CURDATE() THEN cc.monthly_interest_amount ELSE 0 END),0) overdue_value,
            COALESCE((SELECT SUM(cp.amount) FROM collection_payments cp JOIN collection_customers x ON x.id=cp.customer_id WHERE x.company_id=c.id AND (cp.status IS NULL OR cp.status='posted') AND DATE_FORMAT(cp.payment_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')),0) collected_this_month
     FROM companies c LEFT JOIN collection_customers cc ON cc.company_id=c.id AND cc.status='active' AND cc.approval_status='approved'
     WHERE c.id IN (${ph}) GROUP BY c.id,c.name,c.currency ORDER BY overdue_value DESC,c.name`, ids
  );
  const high_risk_customers = await q(
    `SELECT cc.id,cc.customer_name,cc.phone,cc.next_interest_date,cc.principal_amount,cc.monthly_interest_amount,
            DATEDIFF(CURDATE(),cc.next_interest_date) days_overdue,c.name company_name,c.currency
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id
     WHERE cc.status='active' AND cc.approval_status='approved' AND cc.next_interest_date<CURDATE() AND cc.company_id IN (${ph})
     ORDER BY days_overdue DESC,cc.principal_amount DESC LIMIT 12`, ids
  );
  const recent_voids = await q(
    `SELECT cp.id,cp.receipt_number,cp.amount,cp.payment_date,cp.voided_at,cp.void_reason,
            cc.customer_name,c.name company_name,c.currency,u.name voided_by_name
     FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id
     JOIN companies c ON c.id=cc.company_id LEFT JOIN users u ON u.id=cp.voided_by
     WHERE cp.status='voided' AND cc.company_id IN (${ph}) ORDER BY cp.voided_at DESC LIMIT 10`, ids
  );
  const staff_activity = await q(
    `SELECT COALESCE(u.name,'Unknown') staff_name,COUNT(*) receipt_count,COALESCE(SUM(cp.amount),0) collected_amount,MAX(cp.created_at) last_collection
     FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id LEFT JOIN users u ON u.id=cp.collected_by
     WHERE cc.company_id IN (${ph}) AND (cp.status IS NULL OR cp.status='posted')
       AND cp.payment_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)
     GROUP BY cp.collected_by,u.name ORDER BY collected_amount DESC`, ids
  );
  const pending_applications = await q(
    `SELECT cc.id,cc.customer_name,cc.phone,cc.id_card_number,cc.principal_amount,cc.interest_rate,cc.interest_type,cc.monthly_interest_amount,cc.money_given_date,cc.created_at,c.name company_name,c.currency,u.name submitted_by_name
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id LEFT JOIN users u ON u.id=cc.submitted_by
     WHERE cc.approval_status='pending' AND cc.company_id IN (${ph}) ORDER BY cc.created_at`, ids
  );
  res.json({ metrics: { ...portfolio, ...month }, companies, high_risk_customers, recent_voids, staff_activity, pending_applications });
}));

app.get('/api/collections/customers', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json([]);
  const rows = await q(
    `SELECT cc.*,c.name company_name,c.currency,
            DATEDIFF(CURDATE(),cc.next_interest_date) days_overdue,
            (SELECT COALESCE(SUM(cp.amount),0) FROM collection_payments cp WHERE cp.customer_id=cc.id AND (cp.status IS NULL OR cp.status='posted')) total_interest_collected,
            (SELECT MAX(cp.payment_date) FROM collection_payments cp WHERE cp.customer_id=cc.id AND (cp.status IS NULL OR cp.status='posted')) last_payment_date
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id
     WHERE cc.company_id IN (${ids.map(() => '?').join(',')})
     ORDER BY cc.status='active' DESC,cc.next_interest_date,cc.customer_name`, ids
  );
  res.json(await Promise.all(rows.map(withIdCardUrl)));
}));

app.get('/api/collections/customers/:id/payments', requireCollectionAccess, safe(async (req, res) => {
  const [customer] = await q('SELECT company_id FROM collection_customers WHERE id=?', [req.params.id]);
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  await ensureCollectionCompany(req, customer.company_id);
  res.json(await q(
    `SELECT cp.*,u.name collected_by_name FROM collection_payments cp
     LEFT JOIN users u ON u.id=cp.collected_by WHERE cp.customer_id=? ORDER BY cp.payment_date DESC,cp.id DESC`,
    [req.params.id]
  ));
}));

app.get('/api/collections/customers/:id/statement', requireCollectionAccess, safe(async (req, res) => {
  const [customer] = await q(
    `SELECT cc.*,c.name company_name,c.currency
     FROM collection_customers cc JOIN companies c ON c.id=cc.company_id WHERE cc.id=?`,
    [req.params.id]
  );
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  await ensureCollectionCompany(req, customer.company_id);
  const principal_transactions = await q(
    `SELECT pt.*,u.name created_by_name FROM collection_principal_transactions pt
     LEFT JOIN users u ON u.id=pt.created_by
     WHERE pt.customer_id=? ORDER BY pt.transaction_date DESC,pt.id DESC`, [customer.id]
  );
  const interest_payments = await q(
    `SELECT cp.*,u.name collected_by_name FROM collection_payments cp
     LEFT JOIN users u ON u.id=cp.collected_by
     WHERE cp.customer_id=? ORDER BY cp.payment_date DESC,cp.id DESC`, [customer.id]
  );
  const postedInterest = interest_payments.filter(payment => payment.status !== 'voided');
  const additional = principal_transactions.filter(item => item.transaction_type === 'additional_loan').reduce((sum,item) => sum + Number(item.amount),0);
  const repaid = principal_transactions.filter(item => item.transaction_type === 'principal_repayment').reduce((sum,item) => sum + Number(item.amount),0);
  const openingPrincipal = Number(customer.principal_amount) - additional + repaid;
  res.json({ customer, principal_transactions, interest_payments, summary: {
    opening_principal: openingPrincipal,
    additional_principal: additional,
    principal_repaid: repaid,
    principal_outstanding: Number(customer.principal_amount),
    interest_collected: postedInterest.reduce((sum,item) => sum + Number(item.amount),0),
    interest_receipts: postedInterest.length
  }});
}));

app.post('/api/collections/customers', requireCollectionAccess, fileUpload.single('id_card'), safe(async (req, res) => {
  const companyId = Number(req.body.company_id);
  await ensureCollectionCompany(req, companyId);
  const customerName = text(req.body.customer_name);
  const idCardNumber = text(req.body.id_card_number);
  const principal = number(req.body.principal_amount);
  const rate = number(req.body.interest_rate);
  const interestType = req.body.interest_type === 'flat_amount' ? 'flat_amount' : 'percentage';
  const givenDate = text(req.body.money_given_date);
  if (!customerName || !idCardNumber || principal <= 0 || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(givenDate)) {
    return res.status(400).json({ message: 'Customer, ID card number, principal, interest and money-given date are required.' });
  }
  let key = null;
  if (req.file) {
    if (!requireS3(req, res)) return;
    key = `insight/company-${companyId}/collections/id-cards/${Date.now()}-${crypto.randomUUID()}-${safeFileName(req.file.originalname)}`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
  }
  const monthlyInterest = interestType === 'flat_amount' ? rate : Number((principal * rate / 100).toFixed(2));
  try {
    const result = await q(
      `INSERT INTO collection_customers
       (company_id,customer_name,phone,address,id_card_number,id_card_storage_key,id_card_original_name,id_card_mime_type,
        principal_amount,interest_rate,interest_type,monthly_interest_amount,money_given_date,next_interest_date,status,approval_status,submitted_by,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [companyId,customerName,text(req.body.phone),text(req.body.address),idCardNumber,key,req.file?.originalname || null,
       req.file?.mimetype || null,principal,rate,interestType,monthlyInterest,givenDate,givenDate,'active',req.user.role==='frontdesk'?'pending':'approved',req.user.id,text(req.body.notes),req.user.id]
    );
    await audit(req, req.user.role==='frontdesk'?'Submitted loan for approval':'Added approved loan', 'collection_customer', customerName);
    if(req.user.role==='frontdesk')await notifyRole('group_admin','Loan approval required',`${customerName} · principal ${principal}`,'action','/finance/collections',`loan-approval-${result.insertId}`);
    res.status(201).json({ id: result.insertId,approval_status:req.user.role==='frontdesk'?'pending':'approved' });
  } catch (err) {
    if (key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This ID card number already exists for the company.' });
    throw err;
  }
}));

app.post('/api/collections/customers/:id/payments', requireCollectionAccess, safe(async (req, res) => {
  const [customer] = await q('SELECT * FROM collection_customers WHERE id=?', [req.params.id]);
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  await ensureCollectionCompany(req, customer.company_id);
  if (customer.status !== 'active') return res.status(409).json({ message: 'This collection account is closed.' });
  if (customer.approval_status !== 'approved') return res.status(409).json({ message: 'This loan must be approved before collecting interest.' });
  const periodsCount = Math.max(1,Math.min(24,Math.floor(number(req.body.periods_count,1))));
  const penaltyAmount = Math.max(0,number(req.body.penalty_amount,0));
  const amount = number(req.body.amount, Number(customer.monthly_interest_amount)*periodsCount+penaltyAmount);
  const paymentDate = text(req.body.payment_date) || new Date().toISOString().slice(0, 10);
  if (amount <= 0) return res.status(400).json({ message: 'Payment amount must be greater than zero.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const receiptNumber = `COL-${paymentDate.replaceAll('-','')}-${customer.id}-${Date.now().toString().slice(-6)}`;
    const [result] = await conn.query(
      `INSERT INTO collection_payments (receipt_number,customer_id,amount,payment_date,interest_for_date,periods_count,penalty_amount,payment_method,reference_no,notes,collected_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [receiptNumber,customer.id,amount,paymentDate,customer.next_interest_date,periodsCount,penaltyAmount,text(req.body.payment_method) || 'cash',text(req.body.reference_no),text(req.body.notes),req.user.id]
    );
    await conn.query('UPDATE collection_customers SET next_interest_date=DATE_ADD(next_interest_date,INTERVAL ? MONTH) WHERE id=?', [periodsCount,customer.id]);
    await conn.commit();
    await audit(req, 'Collected monthly interest', 'collection_payment', customer.customer_name);
    res.status(201).json({ id: result.insertId,receipt_number:receiptNumber });
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));

app.patch('/api/collections/customers/:id/status', requireCollectionAccess, safe(async (req, res) => {
  const [customer] = await q('SELECT * FROM collection_customers WHERE id=?', [req.params.id]);
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  await ensureCollectionCompany(req, customer.company_id);
  const status = req.body.status === 'closed' ? 'closed' : 'active';
  await q('UPDATE collection_customers SET status=? WHERE id=?', [status, customer.id]);
  await audit(req, `${status === 'closed' ? 'Closed' : 'Reopened'} collection account`, 'collection_customer', customer.customer_name);
  res.json({ ok: true });
}));

app.patch('/api/collections/customers/:id/approval', requireCollectionAccess, safe(async(req,res)=>{
  if(req.user?.role==='frontdesk')return res.status(403).json({message:'Administrator approval is required.'});
  const decision=['approved','rejected'].includes(req.body.approval_status)?req.body.approval_status:null;
  if(!decision)return res.status(400).json({message:'Choose approve or reject.'});
  const [customer]=await q('SELECT * FROM collection_customers WHERE id=?',[req.params.id]);
  if(!customer)return res.status(404).json({message:'Loan application not found.'});
  await ensureCollectionCompany(req,customer.company_id);
  if(customer.approval_status!=='pending')return res.status(409).json({message:'This loan application has already been reviewed.'});
  const reason=text(req.body.rejection_reason);
  if(decision==='rejected'&&!reason)return res.status(400).json({message:'A rejection reason is required.'});
  await q('UPDATE collection_customers SET approval_status=?,reviewed_by=?,reviewed_at=NOW(),rejection_reason=? WHERE id=?',[decision,req.user.id,decision==='rejected'?reason:null,customer.id]);
  await audit(req,`${decision==='approved'?'Approved':'Rejected'} loan application`,'collection_customer',customer.customer_name);
  if(customer.submitted_by)await notifyUser(customer.submitted_by,`Loan ${decision}`,`${customer.customer_name}'s loan for ${customer.principal_amount} was ${decision}.`,decision==='approved'?'success':'error','/frontdesk',`loan-decision-${customer.id}-${decision}`);
  res.json({ok:true});
}));

// ---------- FRONT-DESK OFFICE EXPENSES ----------

const withExpenseReceiptUrl = async row => {
  if (!row?.receipt_storage_key || !process.env.S3_BUCKET) return row;
  const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.receipt_storage_key, ResponseContentDisposition: 'inline' });
  return { ...row, receipt_url: await getSignedUrl(s3, command, { expiresIn: 900 }) };
};

app.get('/api/frontdesk/expenses', requireCollectionAccess, safe(async (req, res) => {
  const ids = await collectionCompanyIds(req);
  if (!ids.length) return res.json({ rows: [], summary: {} });
  const placeholders = ids.map(() => '?').join(',');
  const rows = await q(
    `SELECT e.*,c.name company_name,c.currency,u.name created_by_name
     FROM frontdesk_office_expenses e JOIN companies c ON c.id=e.company_id
     LEFT JOIN users u ON u.id=e.created_by
     WHERE e.company_id IN (${placeholders}) ORDER BY e.expense_date DESC,e.id DESC LIMIT 500`, ids
  );
  const [summary] = await q(
    `SELECT
       COALESCE(SUM(CASE WHEN expense_date=CURDATE() THEN amount ELSE 0 END),0) today_total,
       COALESCE(SUM(CASE WHEN DATE_FORMAT(expense_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') THEN amount ELSE 0 END),0) month_total,
       COALESCE(SUM(CASE WHEN expense_date=CURDATE() AND payment_method='cash' THEN amount ELSE 0 END),0) today_cash,
       SUM(expense_date=CURDATE()) today_count
     FROM frontdesk_office_expenses WHERE company_id IN (${placeholders})`, ids
  );
  res.json({ rows: await Promise.all(rows.map(withExpenseReceiptUrl)), summary });
}));

app.post('/api/frontdesk/expenses', requireCollectionAccess, fileUpload.single('receipt'), safe(async (req, res) => {
  const companyId = Number(req.body.company_id);
  await ensureCollectionCompany(req, companyId);
  const expenseDate = text(req.body.expense_date);
  const category = text(req.body.category);
  const description = text(req.body.description);
  const amount = number(req.body.amount);
  const allowedMethods = new Set(['cash','bank','upi','card','other']);
  const paymentMethod = allowedMethods.has(req.body.payment_method) ? req.body.payment_method : 'cash';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !category || !description || amount <= 0) {
    return res.status(400).json({ message: 'Date, category, description and a valid amount are required.' });
  }
  let key = null;
  if (req.file) {
    if (!requireS3(req, res)) return;
    key = `insight/company-${companyId}/frontdesk/expense-receipts/${Date.now()}-${crypto.randomUUID()}-${safeFileName(req.file.originalname)}`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
  }
  try {
    const result = await q(
      `INSERT INTO frontdesk_office_expenses
       (company_id,expense_date,category,description,vendor,amount,payment_method,receipt_storage_key,receipt_original_name,receipt_mime_type,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [companyId,expenseDate,category,description,text(req.body.vendor),amount,paymentMethod,key,req.file?.originalname || null,req.file?.mimetype || null,text(req.body.notes),req.user.id]
    );
    await audit(req, 'Recorded office expense', 'frontdesk_office_expense', `${category}: ${description}`);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch(() => {});
    throw err;
  }
}));

app.get('/api/frontdesk/preferences', requireCollectionAccess, safe(async (req, res) => {
  if (req.user?.role !== 'frontdesk') return res.status(403).json({ message: 'Front-desk access is required.' });
  const [preference] = await q(
    `SELECT p.default_company_id,c.name default_company_name,p.updated_at
     FROM frontdesk_user_preferences p JOIN companies c ON c.id=p.default_company_id
     WHERE p.user_id=? LIMIT 1`, [req.user.id]
  );
  if (preference) return res.json(preference);
  const [company] = await q(`SELECT id default_company_id,name default_company_name FROM companies WHERE is_parent=0 AND status='active' ORDER BY name LIMIT 1`);
  res.json(company || { default_company_id: null, default_company_name: null });
}));

app.put('/api/frontdesk/preferences/default-company', requireCollectionAccess, safe(async (req, res) => {
  if (req.user?.role !== 'frontdesk') return res.status(403).json({ message: 'Front-desk access is required.' });
  const companyId = Number(req.body.default_company_id);
  const adminPassword = String(req.body.admin_password || '');
  const [company] = await q(`SELECT id,name FROM companies WHERE id=? AND is_parent=0 AND status='active' LIMIT 1`, [companyId]);
  if (!company) return res.status(400).json({ message: 'Select an active operating company.' });
  if (!adminPassword) return res.status(400).json({ message: 'Group Admin password is required.' });
  const admins = await q(`SELECT id,password_hash FROM users WHERE role='group_admin' AND status='active'`);
  let approvingAdmin = null;
  for (const admin of admins) {
    if (await bcrypt.compare(adminPassword, admin.password_hash)) { approvingAdmin = admin; break; }
  }
  if (!approvingAdmin) return res.status(401).json({ message: 'Group Admin password is incorrect.' });
  await q(
    `INSERT INTO frontdesk_user_preferences (user_id,default_company_id,approved_by)
     VALUES (?,?,?) ON DUPLICATE KEY UPDATE default_company_id=VALUES(default_company_id),approved_by=VALUES(approved_by)`,
    [req.user.id, company.id, approvingAdmin.id]
  );
  await audit(req, 'Changed front-desk default company', 'frontdesk_preference', company.name);
  res.json({ default_company_id: company.id, default_company_name: company.name });
}));

// ---------- FRONT-DESK CASHBOOK ----------

const cashbookDay = async (companyId, cashDate) => {
  const [day] = await q(`SELECT * FROM frontdesk_cash_days WHERE company_id=? AND cash_date=? LIMIT 1`, [companyId,cashDate]);
  return day || { company_id:companyId,cash_date:cashDate,opening_balance:0,actual_closing_balance:null,closing_notes:null,status:'open' };
};

app.get('/api/frontdesk/cashbook', requireCollectionAccess, safe(async (req, res) => {
  const companyId = Number(req.query.company_id);
  const cashDate = text(req.query.date);
  if (!companyId || !/^\d{4}-\d{2}-\d{2}$/.test(cashDate)) return res.status(400).json({ message: 'Company and date are required.' });
  await ensureCollectionCompany(req, companyId);
  const day = await cashbookDay(companyId,cashDate);
  const [automatic] = await q(
    `SELECT
       COALESCE((SELECT SUM(cp.amount) FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id WHERE cc.company_id=? AND cp.payment_date=? AND cp.payment_method='cash' AND (cp.status IS NULL OR cp.status='posted')),0) interest_cash_received,
       COALESCE((SELECT SUM(e.amount) FROM frontdesk_office_expenses e WHERE e.company_id=? AND e.expense_date=? AND e.payment_method='cash' AND (e.status IS NULL OR e.status='posted')),0) office_cash_paid,
       COALESCE((SELECT SUM(ce.amount) FROM frontdesk_cash_entries ce WHERE ce.company_id=? AND ce.entry_date=? AND ce.direction='received' AND (ce.status IS NULL OR ce.status='posted')),0) manual_cash_received,
       COALESCE((SELECT SUM(ce.amount) FROM frontdesk_cash_entries ce WHERE ce.company_id=? AND ce.entry_date=? AND ce.direction='paid' AND (ce.status IS NULL OR ce.status='posted')),0) manual_cash_paid`,
    [companyId,cashDate,companyId,cashDate,companyId,cashDate,companyId,cashDate]
  );
  const manualEntries = await q(
    `SELECT ce.id,ce.entry_date,ce.direction,ce.category,ce.description,ce.amount,ce.reference_no,ce.notes,ce.created_at,u.name created_by_name,'manual' source
     FROM frontdesk_cash_entries ce LEFT JOIN users u ON u.id=ce.created_by
     WHERE ce.company_id=? AND ce.entry_date=? AND (ce.status IS NULL OR ce.status='posted')`, [companyId,cashDate]
  );
  const interestEntries = await q(
    `SELECT cp.id,cp.payment_date entry_date,'received' direction,'Interest collection' category,
            CONCAT('Interest from ',cc.customer_name) description,cp.amount,cp.reference_no,cp.notes,cp.created_at,u.name created_by_name,'collection' source
     FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id LEFT JOIN users u ON u.id=cp.collected_by
     WHERE cc.company_id=? AND cp.payment_date=? AND cp.payment_method='cash' AND (cp.status IS NULL OR cp.status='posted')`, [companyId,cashDate]
  );
  const expenseEntries = await q(
    `SELECT e.id,e.expense_date entry_date,'paid' direction,e.category,e.description,e.amount,NULL reference_no,e.notes,e.created_at,u.name created_by_name,'office_expense' source
     FROM frontdesk_office_expenses e LEFT JOIN users u ON u.id=e.created_by
     WHERE e.company_id=? AND e.expense_date=? AND e.payment_method='cash' AND (e.status IS NULL OR e.status='posted')`, [companyId,cashDate]
  );
  const expectedClosing = Number(day.opening_balance||0)+Number(automatic.interest_cash_received||0)+Number(automatic.manual_cash_received||0)-Number(automatic.office_cash_paid||0)-Number(automatic.manual_cash_paid||0);
  const actual = day.actual_closing_balance === null ? null : Number(day.actual_closing_balance);
  res.json({ day,summary:{...automatic,opening_balance:Number(day.opening_balance||0),expected_closing:expectedClosing,actual_closing:actual,difference:actual===null?null:actual-expectedClosing},entries:[...manualEntries,...interestEntries,...expenseEntries].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))) });
}));

app.put('/api/frontdesk/cashbook/opening', requireCollectionAccess, safe(async (req, res) => {
  const companyId=Number(req.body.company_id); const cashDate=text(req.body.date); const opening=number(req.body.opening_balance,-1);
  if(!companyId||!/^\d{4}-\d{2}-\d{2}$/.test(cashDate)||opening<0)return res.status(400).json({message:'Company, date and a valid opening balance are required.'});
  await ensureCollectionCompany(req,companyId); const day=await cashbookDay(companyId,cashDate);
  if(day.status==='closed')return res.status(409).json({message:'This cash day is already closed.'});
  await q(`INSERT INTO frontdesk_cash_days (company_id,cash_date,opening_balance,created_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE opening_balance=VALUES(opening_balance)`,[companyId,cashDate,opening,req.user.id]);
  await audit(req,'Updated cashbook opening balance','frontdesk_cash_day',`${companyId} ${cashDate}`); res.json({ok:true});
}));

app.post('/api/frontdesk/cashbook/entries', requireCollectionAccess, safe(async (req, res) => {
  const companyId=Number(req.body.company_id); const entryDate=text(req.body.entry_date); const direction=req.body.direction==='paid'?'paid':'received'; const category=text(req.body.category); const description=text(req.body.description); const amount=number(req.body.amount);
  if(!companyId||!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||!category||!description||amount<=0)return res.status(400).json({message:'Company, date, category, description and amount are required.'});
  await ensureCollectionCompany(req,companyId); const day=await cashbookDay(companyId,entryDate); if(day.status==='closed')return res.status(409).json({message:'This cash day is closed. New entries are not allowed.'});
  const result=await q(`INSERT INTO frontdesk_cash_entries (company_id,entry_date,direction,category,description,amount,reference_no,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)`,[companyId,entryDate,direction,category,description,amount,text(req.body.reference_no),text(req.body.notes),req.user.id]);
  await audit(req,`Recorded cash ${direction}`,'frontdesk_cash_entry',description); res.status(201).json({id:result.insertId});
}));

app.post('/api/frontdesk/cashbook/close', requireCollectionAccess, safe(async (req, res) => {
  const companyId=Number(req.body.company_id); const cashDate=text(req.body.date); const actual=number(req.body.actual_closing_balance,-1);
  if(!companyId||!/^\d{4}-\d{2}-\d{2}$/.test(cashDate)||actual<0)return res.status(400).json({message:'Company, date and actual cash count are required.'});
  await ensureCollectionCompany(req,companyId); const existing=await cashbookDay(companyId,cashDate); if(existing.status==='closed')return res.status(409).json({message:'This cash day is already closed.'});
  await q(`INSERT INTO frontdesk_cash_days (company_id,cash_date,opening_balance,actual_closing_balance,closing_notes,status,closed_by,closed_at,created_by) VALUES (?,?,?,?,?,'closed',?,NOW(),?) ON DUPLICATE KEY UPDATE actual_closing_balance=VALUES(actual_closing_balance),closing_notes=VALUES(closing_notes),status='closed',closed_by=VALUES(closed_by),closed_at=NOW()`,[companyId,cashDate,Number(existing.opening_balance||0),actual,text(req.body.closing_notes),req.user.id,req.user.id]);
  await audit(req,'Closed cashbook day','frontdesk_cash_day',`${companyId} ${cashDate}`); res.json({ok:true});
}));

const verifyAdminPassword = async password => {
  const admins=await q(`SELECT id,password_hash FROM users WHERE role='group_admin' AND status='active'`);
  for(const admin of admins) if(await bcrypt.compare(String(password||''),admin.password_hash)) return admin;
  return null;
};

app.get('/api/collections/payments/:id/receipt',requireCollectionAccess,safe(async(req,res)=>{
  const [row]=await q(`SELECT cp.*,cc.customer_name,cc.id_card_number,cc.company_id,cc.monthly_interest_amount,c.name company_name,c.currency,u.name collected_by_name FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id JOIN companies c ON c.id=cc.company_id LEFT JOIN users u ON u.id=cp.collected_by WHERE cp.id=?`,[req.params.id]);
  if(!row)return res.status(404).json({message:'Receipt not found.'});await ensureCollectionCompany(req,row.company_id);res.json(row);
}));

app.post('/api/collections/customers/:id/principal',requireCollectionAccess,safe(async(req,res)=>{
  const [customer]=await q('SELECT * FROM collection_customers WHERE id=?',[req.params.id]);if(!customer)return res.status(404).json({message:'Customer not found.'});await ensureCollectionCompany(req,customer.company_id);
  const type=req.body.transaction_type==='additional_loan'?'additional_loan':'principal_repayment';const amount=number(req.body.amount);const transactionDate=text(req.body.transaction_date);if(amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate))return res.status(400).json({message:'Valid amount and date are required.'});if(type==='principal_repayment'&&amount>Number(customer.principal_amount))return res.status(400).json({message:'Repayment cannot exceed current principal.'});
  const conn=await pool.getConnection();try{await conn.beginTransaction();await conn.query(`INSERT INTO collection_principal_transactions (customer_id,transaction_date,transaction_type,amount,payment_method,reference_no,notes,created_by) VALUES (?,?,?,?,?,?,?,?)`,[customer.id,transactionDate,type,amount,text(req.body.payment_method)||'cash',text(req.body.reference_no),text(req.body.notes),req.user.id]);const nextPrincipal=type==='additional_loan'?Number(customer.principal_amount)+amount:Number(customer.principal_amount)-amount;const nextInterest=customer.interest_type==='percentage'?Number((nextPrincipal*Number(customer.interest_rate)/100).toFixed(2)):Number(customer.monthly_interest_amount);await conn.query('UPDATE collection_customers SET principal_amount=?,monthly_interest_amount=? WHERE id=?',[nextPrincipal,nextInterest,customer.id]);await conn.commit();res.status(201).json({principal_amount:nextPrincipal,monthly_interest_amount:nextInterest});}catch(err){await conn.rollback();throw err;}finally{conn.release();}
}));

app.put('/api/collections/customers/:id',requireCollectionAccess,fileUpload.single('id_card'),safe(async(req,res)=>{const [customer]=await q('SELECT * FROM collection_customers WHERE id=?',[req.params.id]);if(!customer)return res.status(404).json({message:'Customer not found.'});await ensureCollectionCompany(req,customer.company_id);const name=text(req.body.customer_name),idNumber=text(req.body.id_card_number);if(!name||!idNumber)return res.status(400).json({message:'Customer name and ID card number are required.'});let key=customer.id_card_storage_key;if(req.file){if(!requireS3(req,res))return;key=`insight/company-${customer.company_id}/collections/id-cards/${Date.now()}-${crypto.randomUUID()}-${safeFileName(req.file.originalname)}`;await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:req.file.buffer,ContentType:req.file.mimetype}));}try{await q(`UPDATE collection_customers SET customer_name=?,phone=?,address=?,id_card_number=?,id_card_storage_key=?,id_card_original_name=?,id_card_mime_type=?,notes=? WHERE id=?`,[name,text(req.body.phone),text(req.body.address),idNumber,key,req.file?.originalname||customer.id_card_original_name,req.file?.mimetype||customer.id_card_mime_type,text(req.body.notes),customer.id]);if(req.file&&customer.id_card_storage_key)await s3.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:customer.id_card_storage_key})).catch(()=>{});res.json({ok:true});}catch(err){if(req.file)await s3.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key})).catch(()=>{});if(err.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This ID card number already exists.'});throw err;}}));

app.post('/api/collections/payments/:id/void',requireCollectionAccess,safe(async(req,res)=>{
  const [payment]=await q(`SELECT cp.*,cc.company_id FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id WHERE cp.id=?`,[req.params.id]);if(!payment)return res.status(404).json({message:'Payment not found.'});await ensureCollectionCompany(req,payment.company_id);if(payment.status==='voided')return res.status(409).json({message:'Payment is already voided.'});const admin=await verifyAdminPassword(req.body.admin_password);if(!admin)return res.status(401).json({message:'Group Admin password is incorrect.'});await q(`UPDATE collection_payments SET status='voided',voided_by=?,voided_at=NOW(),void_reason=? WHERE id=?`,[admin.id,text(req.body.reason),payment.id]);await q(`UPDATE collection_customers SET next_interest_date=DATE_SUB(next_interest_date,INTERVAL ? MONTH) WHERE id=?`,[payment.periods_count||1,payment.customer_id]);res.json({ok:true});
}));

app.post('/api/frontdesk/cashbook/reopen',requireCollectionAccess,safe(async(req,res)=>{const companyId=Number(req.body.company_id);const cashDate=text(req.body.date);await ensureCollectionCompany(req,companyId);const admin=await verifyAdminPassword(req.body.admin_password);if(!admin)return res.status(401).json({message:'Group Admin password is incorrect.'});await q(`UPDATE frontdesk_cash_days SET status='open',actual_closing_balance=NULL,closing_notes=NULL,closed_by=NULL,closed_at=NULL WHERE company_id=? AND cash_date=?`,[companyId,cashDate]);res.json({ok:true});}));

app.post('/api/frontdesk/expenses/:id/void',requireCollectionAccess,safe(async(req,res)=>{const [expense]=await q('SELECT * FROM frontdesk_office_expenses WHERE id=?',[req.params.id]);if(!expense)return res.status(404).json({message:'Expense not found.'});await ensureCollectionCompany(req,expense.company_id);const admin=await verifyAdminPassword(req.body.admin_password);if(!admin)return res.status(401).json({message:'Group Admin password is incorrect.'});await q(`UPDATE frontdesk_office_expenses SET status='voided',voided_by=?,voided_at=NOW(),void_reason=? WHERE id=?`,[admin.id,text(req.body.reason),expense.id]);res.json({ok:true});}));

app.post('/api/frontdesk/cashbook/entries/:id/void',requireCollectionAccess,safe(async(req,res)=>{const [entry]=await q('SELECT * FROM frontdesk_cash_entries WHERE id=?',[req.params.id]);if(!entry)return res.status(404).json({message:'Cash entry not found.'});await ensureCollectionCompany(req,entry.company_id);const admin=await verifyAdminPassword(req.body.admin_password);if(!admin)return res.status(401).json({message:'Group Admin password is incorrect.'});await q(`UPDATE frontdesk_cash_entries SET status='voided',voided_by=?,voided_at=NOW(),void_reason=? WHERE id=?`,[admin.id,text(req.body.reason),entry.id]);res.json({ok:true});}));

app.get('/api/frontdesk/reports',requireCollectionAccess,safe(async(req,res)=>{const ids=await collectionCompanyIds(req);const companyId=Number(req.query.company_id);const from=text(req.query.from);const to=text(req.query.to);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return res.status(400).json({message:'Valid report dates are required.'});const selected=companyId?[companyId]:ids;if(companyId)await ensureCollectionCompany(req,companyId);if(!selected.length)return res.json({summary:{},collections:[],expenses:[]});const ph=selected.map(()=>'?').join(',');const collections=await q(`SELECT cp.receipt_number,cp.payment_date,cc.customer_name,c.name company_name,cp.payment_method,cp.amount,cp.penalty_amount,cp.status FROM collection_payments cp JOIN collection_customers cc ON cc.id=cp.customer_id JOIN companies c ON c.id=cc.company_id WHERE cc.company_id IN (${ph}) AND cp.payment_date BETWEEN ? AND ? ORDER BY cp.payment_date DESC`,[...selected,from,to]);const expenses=await q(`SELECT e.expense_date,c.name company_name,e.category,e.description,e.vendor,e.payment_method,e.amount,e.status FROM frontdesk_office_expenses e JOIN companies c ON c.id=e.company_id WHERE e.company_id IN (${ph}) AND e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date DESC`,[...selected,from,to]);const collectionTotal=collections.filter(x=>x.status!=='voided').reduce((s,x)=>s+Number(x.amount),0);const expenseTotal=expenses.filter(x=>x.status!=='voided').reduce((s,x)=>s+Number(x.amount),0);res.json({summary:{collection_total:collectionTotal,expense_total:expenseTotal,net_cash_flow:collectionTotal-expenseTotal,collection_count:collections.length,expense_count:expenses.length},collections,expenses});}));

app.put('/api/frontdesk/change-password',requireCollectionAccess,safe(async(req,res)=>{if(req.user.role!=='frontdesk')return res.status(403).json({message:'Front-desk access is required.'});const [user]=await q('SELECT password_hash FROM users WHERE id=?',[req.user.id]);if(!await bcrypt.compare(String(req.body.current_password||''),user.password_hash))return res.status(401).json({message:'Current password is incorrect.'});const next=String(req.body.new_password||'');if(next.length<8||!/[A-Z]/.test(next)||!/[a-z]/.test(next)||!/[0-9]/.test(next))return res.status(400).json({message:'New password must have 8 characters, uppercase, lowercase and a number.'});await q('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(next,12),req.user.id]);res.json({ok:true});}));

app.get('/api/frontdesk/login-history',requireCollectionAccess,safe(async(req,res)=>{if(req.user.role!=='frontdesk')return res.status(403).json({message:'Front-desk access is required.'});res.json(await q(`SELECT id,login_at,ip_address,user_agent FROM frontdesk_login_history WHERE user_id=? ORDER BY login_at DESC LIMIT 20`,[req.user.id]));}));

// ---------- INVESTOR INTEREST PAYMENTS ----------

app.get('/api/investors/overview', requireCollectionAccess, safe(async (req,res) => {
  const ids=await collectionCompanyIds(req);
  if(!ids.length)return res.json({companies:[],investors:[],summary:{}});
  const ph=ids.map(()=>'?').join(',');
  const companies=await q(`SELECT id,name,currency FROM companies WHERE id IN (${ph}) ORDER BY name`,ids);
  const investors=await q(`SELECT fi.*,c.name company_name,c.currency,DATEDIFF(CURDATE(),fi.next_interest_date) days_overdue,
    COALESCE((SELECT SUM(p.amount) FROM finance_investor_interest_payments p WHERE p.investor_id=fi.id),0) total_interest_paid,
    (SELECT MAX(p.payment_date) FROM finance_investor_interest_payments p WHERE p.investor_id=fi.id) last_payment_date
    FROM finance_investors fi JOIN companies c ON c.id=fi.company_id
    WHERE fi.company_id IN (${ph}) ORDER BY fi.status='active' DESC,fi.next_interest_date,fi.investor_name`,ids);
  const [portfolio]=await q(`SELECT COUNT(*) active_investors,COALESCE(SUM(investment_amount),0) investment_received,
    COALESCE(SUM(monthly_interest_amount),0) monthly_interest_payable,
    COALESCE(SUM(next_interest_date<=CURDATE()),0) due_now
    FROM finance_investors WHERE status='active' AND company_id IN (${ph})`,ids);
  const [paid]=await q(`SELECT COALESCE(SUM(p.amount),0) paid_this_month FROM finance_investor_interest_payments p
    JOIN finance_investors fi ON fi.id=p.investor_id WHERE fi.company_id IN (${ph})
    AND DATE_FORMAT(p.payment_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`,ids);
  res.json({companies,investors,summary:{...portfolio,...paid}});
}));

app.get('/api/investors/:id/payments', requireCollectionAccess, safe(async(req,res)=>{
  const [investor]=await q('SELECT company_id FROM finance_investors WHERE id=?',[req.params.id]);
  if(!investor)return res.status(404).json({message:'Investor not found.'});
  await ensureCollectionCompany(req,investor.company_id);
  res.json(await q(`SELECT p.*,u.name paid_by_name FROM finance_investor_interest_payments p LEFT JOIN users u ON u.id=p.paid_by WHERE p.investor_id=? ORDER BY p.payment_date DESC,p.id DESC`,[req.params.id]));
}));

app.post('/api/investors', requireCollectionAccess, safe(async(req,res)=>{
  const companyId=Number(req.body.company_id),name=text(req.body.investor_name),amount=number(req.body.investment_amount),rate=number(req.body.interest_rate);
  const interestType=req.body.interest_type==='flat_amount'?'flat_amount':'percentage',date=text(req.body.investment_date),firstDue=text(req.body.next_interest_date)||date;
  await ensureCollectionCompany(req,companyId);
  if(!name||amount<=0||rate<=0||!/^(\d{4})-(\d{2})-(\d{2})$/.test(date)||!/^(\d{4})-(\d{2})-(\d{2})$/.test(firstDue))return res.status(400).json({message:'Investor, investment amount, monthly interest and valid dates are required.'});
  const monthly=interestType==='flat_amount'?rate:Number((amount*rate/100).toFixed(2));
  const result=await q(`INSERT INTO finance_investors(company_id,investor_name,phone,email,id_number,investment_amount,interest_rate,interest_type,monthly_interest_amount,investment_date,next_interest_date,payment_method,reference_no,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[companyId,name,text(req.body.phone),text(req.body.email),text(req.body.id_number),amount,rate,interestType,monthly,date,firstDue,text(req.body.payment_method)||'Bank transfer',text(req.body.reference_no),text(req.body.notes),req.user.id]);
  await audit(req,'Recorded investment received','finance_investor',name);
  res.status(201).json({id:result.insertId});
}));

app.post('/api/investors/:id/payments', requireCollectionAccess, safe(async(req,res)=>{
  const [investor]=await q('SELECT * FROM finance_investors WHERE id=?',[req.params.id]);
  if(!investor)return res.status(404).json({message:'Investor not found.'});
  await ensureCollectionCompany(req,investor.company_id);
  if(investor.status!=='active')return res.status(409).json({message:'This investor account is closed.'});
  const periods=Math.max(1,Math.min(24,Math.floor(number(req.body.periods_count,1)))),amount=number(req.body.amount,Number(investor.monthly_interest_amount)*periods),date=text(req.body.payment_date)||new Date().toISOString().slice(0,10);
  if(amount<=0||!/^(\d{4})-(\d{2})-(\d{2})$/.test(date))return res.status(400).json({message:'A valid payment date and amount are required.'});
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const receipt=`INV-${date.replaceAll('-','')}-${investor.id}-${Date.now().toString().slice(-6)}`;const [result]=await conn.query(`INSERT INTO finance_investor_interest_payments(investor_id,receipt_number,amount,payment_date,interest_for_date,periods_count,payment_method,reference_no,notes,paid_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,[investor.id,receipt,amount,date,investor.next_interest_date,periods,text(req.body.payment_method)||investor.payment_method||'Bank transfer',text(req.body.reference_no),text(req.body.notes),req.user.id]);await conn.query('UPDATE finance_investors SET next_interest_date=DATE_ADD(next_interest_date,INTERVAL ? MONTH) WHERE id=?',[periods,investor.id]);await conn.commit();await audit(req,'Paid monthly investor interest','investor_interest_payment',investor.investor_name);res.status(201).json({id:result.insertId,receipt_number:receipt});}catch(err){await conn.rollback();throw err}finally{conn.release()}
}));

app.patch('/api/investors/:id/status', requireCollectionAccess, safe(async(req,res)=>{
  const [investor]=await q('SELECT * FROM finance_investors WHERE id=?',[req.params.id]);if(!investor)return res.status(404).json({message:'Investor not found.'});await ensureCollectionCompany(req,investor.company_id);const status=req.body.status==='closed'?'closed':'active';await q('UPDATE finance_investors SET status=? WHERE id=?',[status,investor.id]);await audit(req,`${status==='closed'?'Closed':'Reopened'} investor account`,'finance_investor',investor.investor_name);res.json({ok:true});
}));

// Keep this after the collection routes so multipart and validation failures
// from this module are returned as JSON as well.
app.use((err, req, res, next) => {
  console.error(err);
  const status = Number(err.statusCode) || (err instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({
    message: status === 500 ? 'Server error' : (err.message || 'Request failed'),
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

await q(`CREATE TABLE IF NOT EXISTS partner_profiles (id INT AUTO_INCREMENT PRIMARY KEY,person_id INT NOT NULL UNIQUE,user_id INT NOT NULL UNIQUE,status VARCHAR(30) NOT NULL DEFAULT 'active',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
await q(`CREATE TABLE IF NOT EXISTS partner_company_access (id INT AUTO_INCREMENT PRIMARY KEY,partner_id INT NOT NULL,company_id INT NOT NULL,relationship_type VARCHAR(60) NOT NULL DEFAULT 'Partner',ownership_percent DECIMAL(7,4) NOT NULL DEFAULT 0,notes TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_partner_company(partner_id,company_id),FOREIGN KEY(partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`);
await q(`CREATE TABLE IF NOT EXISTS partner_investments (id INT AUTO_INCREMENT PRIMARY KEY,partner_id INT NOT NULL,company_id INT NOT NULL,investment_date DATE NOT NULL,investment_type VARCHAR(60) NOT NULL DEFAULT 'Capital contribution',amount DECIMAL(15,2) NOT NULL,currency CHAR(3) NOT NULL DEFAULT 'INR',reference_no VARCHAR(180),notes TEXT,created_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL)`);
await q(`CREATE TABLE IF NOT EXISTS partner_tasks (id INT AUTO_INCREMENT PRIMARY KEY,partner_id INT NOT NULL,company_id INT NULL,title VARCHAR(220) NOT NULL,description TEXT,due_date DATE,priority VARCHAR(20) NOT NULL DEFAULT 'Medium',status VARCHAR(30) NOT NULL DEFAULT 'pending',created_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE SET NULL,FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL)`);
await q(`CREATE TABLE IF NOT EXISTS partner_withdrawal_requests (id INT AUTO_INCREMENT PRIMARY KEY,partner_id INT NOT NULL,company_id INT NOT NULL,amount DECIMAL(15,2) NOT NULL,currency CHAR(3) NOT NULL DEFAULT 'INR',payment_method VARCHAR(60) NOT NULL DEFAULT 'Bank transfer',reason TEXT NOT NULL,status VARCHAR(30) NOT NULL DEFAULT 'pending',admin_notes TEXT,reviewed_by INT NULL,reviewed_at DATETIME NULL,paid_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY ix_partner_withdrawal_status(status),KEY ix_partner_withdrawal_partner(partner_id,company_id),FOREIGN KEY(partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL)`);
await q(`CREATE TABLE IF NOT EXISTS partner_meetings (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT NOT NULL,title VARCHAR(220) NOT NULL,meeting_type VARCHAR(80) NOT NULL DEFAULT 'Partner meeting',scheduled_at DATETIME NOT NULL,location VARCHAR(255),agenda LONGTEXT,minutes LONGTEXT,resolution_text LONGTEXT,action_type VARCHAR(30) NOT NULL DEFAULT 'acknowledgement',response_due_date DATE,status VARCHAR(30) NOT NULL DEFAULT 'draft',created_by INT NULL,updated_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY ix_partner_meeting_company(company_id),KEY ix_partner_meeting_status(status),FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL)`);
await q(`CREATE TABLE IF NOT EXISTS partner_meeting_responses (id INT AUTO_INCREMENT PRIMARY KEY,meeting_id INT NOT NULL,partner_id INT NOT NULL,response_status VARCHAR(30) NOT NULL DEFAULT 'pending',comment TEXT,responded_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_partner_meeting_response(meeting_id,partner_id),KEY ix_partner_response_partner(partner_id,response_status),FOREIGN KEY(meeting_id) REFERENCES partner_meetings(id) ON DELETE CASCADE,FOREIGN KEY(partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE)`);
await q(`CREATE TABLE IF NOT EXISTS notifications (id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,title VARCHAR(180) NOT NULL,message VARCHAR(700) NOT NULL,type VARCHAR(30) NOT NULL DEFAULT 'info',target_path VARCHAR(255),dedupe_key VARCHAR(255),is_read TINYINT(1) NOT NULL DEFAULT 0,read_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_notification_dedupe(user_id,dedupe_key),KEY ix_notification_inbox(user_id,is_read,created_at),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
await q(`CREATE TABLE IF NOT EXISTS finance_investors (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT NOT NULL,investor_name VARCHAR(180) NOT NULL,phone VARCHAR(40),email VARCHAR(180),id_number VARCHAR(100),investment_amount DECIMAL(15,2) NOT NULL,interest_rate DECIMAL(8,4) NOT NULL,interest_type ENUM('flat_amount','percentage') NOT NULL DEFAULT 'percentage',monthly_interest_amount DECIMAL(15,2) NOT NULL,investment_date DATE NOT NULL,next_interest_date DATE NOT NULL,payment_method VARCHAR(60) DEFAULT 'Bank transfer',reference_no VARCHAR(100),status ENUM('active','closed') NOT NULL DEFAULT 'active',notes TEXT,created_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY ix_finance_investor_due(company_id,status,next_interest_date),FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL)`);
await q(`CREATE TABLE IF NOT EXISTS finance_investor_interest_payments (id INT AUTO_INCREMENT PRIMARY KEY,investor_id INT NOT NULL,receipt_number VARCHAR(100) NOT NULL UNIQUE,amount DECIMAL(15,2) NOT NULL,payment_date DATE NOT NULL,interest_for_date DATE NOT NULL,periods_count INT NOT NULL DEFAULT 1,payment_method VARCHAR(60) NOT NULL DEFAULT 'Bank transfer',reference_no VARCHAR(100),notes TEXT,paid_by INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY ix_investor_interest_payment(investor_id,payment_date),FOREIGN KEY(investor_id) REFERENCES finance_investors(id) ON DELETE CASCADE,FOREIGN KEY(paid_by) REFERENCES users(id) ON DELETE SET NULL)`);

await q(`CREATE TABLE IF NOT EXISTS program_registry (
  id INT AUTO_INCREMENT PRIMARY KEY,program_name VARCHAR(180) NOT NULL,environment VARCHAR(40) NOT NULL DEFAULT 'production',
  status VARCHAR(30) NOT NULL DEFAULT 'active',public_url VARCHAR(500),git_url VARCHAR(500),git_branch VARCHAR(120),
  server_host VARCHAR(255),ssh_user VARCHAR(120),ssh_port INT NOT NULL DEFAULT 22,deployment_path VARCHAR(500),
  process_manager VARCHAR(180),encrypted_pem LONGTEXT,encrypted_env LONGTEXT,notes TEXT,created_by INT NULL,updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_program_environment(program_name,environment),KEY ix_program_status(status),
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
)`);

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Insight API running on http://localhost:${port}`));
