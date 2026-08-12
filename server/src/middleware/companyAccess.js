import { pool } from '../db.js';
import { buildUserAccess } from './permissions.js';

export async function getAllowedCompanyIds(user) {
  if (!user?.id) return [];

  const access = await buildUserAccess(user);

  if (access.globalRole === 'group_admin') {
    const [rows] = await pool.query(
      `SELECT id FROM companies WHERE status='active'`
    );
    return rows.map(r => Number(r.id));
  }

  return Object.keys(access.companyAccess || {})
    .map(Number)
    .filter(Boolean);
}

export function requireCompanyAccess(options = {}) {
  const {
    from = 'body',
    key = 'company_id',
    allowGroupAdmin = true
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const access = await buildUserAccess(req.user);

      if (allowGroupAdmin && access.globalRole === 'group_admin') {
        req.access = access;
        return next();
      }

      const source =
        from === 'query' ? req.query :
        from === 'params' ? req.params :
        req.body;

      const companyId = Number(source?.[key]);

      if (!companyId) {
        return res.status(400).json({
          message: 'Company is required for this operation.'
        });
      }

      if (!access.companyAccess?.[companyId]) {
        return res.status(403).json({
          message: 'You do not have access to this company.'
        });
      }

      req.access = access;
      return next();
    } catch (err) {
      next(err);
    }
  };
}
