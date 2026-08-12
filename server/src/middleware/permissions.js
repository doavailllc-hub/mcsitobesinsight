import { pool } from '../db.js';

const legacyRoleMap = {
  finance: 'accountant',
  hr: 'hr_manager'
};

const normalizeRole = role => legacyRoleMap[role] || role;

async function getGlobalRolePermissions(userRole) {
  const roleKey = normalizeRole(userRole);

  if (roleKey === 'group_admin') {
    const [rows] = await pool.query('SELECT permission_key FROM permissions');
    return rows.map(r => r.permission_key);
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT p.permission_key
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.role_key = ? AND r.status = 'active'`,
    [roleKey]
  );

  return rows.map(r => r.permission_key);
}

async function getCompanyRolePermissions(userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT
        uca.company_id,
        r.role_key,
        p.permission_key
     FROM user_company_access uca
     LEFT JOIN roles r ON r.id = uca.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE uca.user_id = ?`,
    [userId]
  );

  const byCompany = {};

  for (const row of rows) {
    const companyId = Number(row.company_id);
    if (!companyId) continue;

    if (!byCompany[companyId]) {
      byCompany[companyId] = {
        role: row.role_key || null,
        permissions: []
      };
    }

    if (row.permission_key && !byCompany[companyId].permissions.includes(row.permission_key)) {
      byCompany[companyId].permissions.push(row.permission_key);
    }
  }

  return byCompany;
}

export async function buildUserAccess(user) {
  const globalRole = normalizeRole(user?.role || 'viewer');
  const globalPermissions = await getGlobalRolePermissions(globalRole);
  const companyAccess = await getCompanyRolePermissions(user.id);

  return {
    globalRole,
    globalPermissions,
    companyAccess
  };
}

export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const access = await buildUserAccess(req.user);

      if (access.globalRole === 'group_admin') {
        req.access = access;
        return next();
      }

      if (access.globalPermissions.includes(permissionKey)) {
        req.access = access;
        return next();
      }

      // Company-specific permission fallback.
      const companyId =
        Number(req.body?.company_id) ||
        Number(req.query?.company_id) ||
        Number(req.params?.company_id) ||
        null;

      if (companyId && access.companyAccess[companyId]?.permissions?.includes(permissionKey)) {
        req.access = access;
        return next();
      }

      return res.status(403).json({
        message: 'You do not have permission to perform this action.',
        permission: permissionKey
      });
    } catch (err) {
      next(err);
    }
  };
}

export function requireAnyPermission(...permissionKeys) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const access = await buildUserAccess(req.user);

      if (access.globalRole === 'group_admin') {
        req.access = access;
        return next();
      }

      const allowedGlobally = permissionKeys.some(key =>
        access.globalPermissions.includes(key)
      );

      if (allowedGlobally) {
        req.access = access;
        return next();
      }

      const companyId =
        Number(req.body?.company_id) ||
        Number(req.query?.company_id) ||
        Number(req.params?.company_id) ||
        null;

      if (companyId) {
        const companyPermissions =
          access.companyAccess[companyId]?.permissions || [];

        const allowedForCompany = permissionKeys.some(key =>
          companyPermissions.includes(key)
        );

        if (allowedForCompany) {
          req.access = access;
          return next();
        }
      }

      return res.status(403).json({
        message: 'You do not have permission to perform this action.'
      });
    } catch (err) {
      next(err);
    }
  };
}
