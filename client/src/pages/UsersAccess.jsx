import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  KeyRound,
  UserCheck,
  UserX,
  X,
  ShieldCheck,
  Save,
  LockKeyhole
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const emptyForm = {
  name: '',
  email: '',
  password: '',
  status: 'active',
  access: []
};

export default function UsersAccess() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [roles, setRoles] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const currentUser = getUser();
  const permissionSet = new Set(getPermissions());
  const isGroupAdmin = currentUser?.role === 'group_admin';
  const canView = isGroupAdmin || permissionSet.has('users.view') || permissionSet.has('users.manage');
  const canManage = isGroupAdmin || permissionSet.has('users.manage');

  const load = async () => {
    const [u, c, r] = await Promise.all([
      api.get('/access/users'),
      api.get('/company-options'),
      api.get('/access/roles')
    ]);

    setRows(u.data || []);
    setCompanies(c.data || []);
    setRoles(r.data || []);
  };

  useEffect(() => {
    if (!canView) return;

    load().catch(e =>
      setError(e.response?.data?.message || 'Unable to load users and access.')
    );
  }, [canView]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();

    if (!text) return rows;

    return rows.filter(row =>
      `${row.name || ''} ${row.email || ''} ${row.global_role || ''} ${
        row.company_access || ''
      }`
        .toLowerCase()
        .includes(text)
    );
  }, [rows, query]);

  const roleForCompany = id =>
    form.access.find(a => Number(a.company_id) === Number(id))?.role_key || '';

  const setCompanyRole = (company_id, role_key) => {
    setForm(prev => ({
      ...prev,
      access: role_key
        ? [
            ...prev.access.filter(
              a => Number(a.company_id) !== Number(company_id)
            ),
            { company_id: Number(company_id), role_key }
          ]
        : prev.access.filter(
            a => Number(a.company_id) !== Number(company_id)
          )
    }));
  };

  const isSelf = row =>
    Number(row?.id) === Number(currentUser?.id || currentUser?.user_id);

  const isProtectedAdmin = row =>
    row?.global_role === 'group_admin' && !isGroupAdmin;

  const openCreate = () => {
    if (!canManage) return;
    setEditingId(null);
    setForm({ ...emptyForm, access: [] });
    setError('');
    setOpen(true);
  };

  const openEdit = async row => {
    if (!canManage || isProtectedAdmin(row)) return;

    setError('');

    try {
      const { data } = await api.get(`/access/users/${row.id}`);

      setEditingId(row.id);
      setForm({
        name: data.name || '',
        email: data.email || '',
        password: '',
        status: data.status || 'active',
        access: Array.isArray(data.access) ? data.access : []
      });
      setOpen(true);
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to load user.');
    }
  };

  const close = () => {
    if (saving) return;
    setOpen(false);
    setEditingId(null);
    setForm({ ...emptyForm, access: [] });
    setError('');
  };

  const save = async e => {
    e.preventDefault();
    if (!canManage) return;

    setError('');

    if (!form.name.trim()) return setError('Name is required.');
    if (!form.email.trim()) return setError('Email is required.');

    if (!editingId && form.password.length < 8) {
      return setError('Temporary password must be at least 8 characters.');
    }

    if (editingId && form.password && form.password.length < 8) {
      return setError('New password must be at least 8 characters.');
    }

    try {
      setSaving(true);

      const payload = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim()
      };

      if (editingId && !payload.password) {
        delete payload.password;
      }

      if (editingId) {
        await api.put(`/access/users/${editingId}`, payload);
      } else {
        await api.post('/access/users', payload);
      }

      await load();
      setOpen(false);
      setEditingId(null);
      setForm({ ...emptyForm, access: [] });
      setError('');
    } catch (e) {
      setError(
        e.response?.data?.message ||
          e.response?.data?.detail ||
          'Unable to save user.'
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async row => {
    if (!canManage || isSelf(row) || row.global_role === 'group_admin') return;

    const status = row.status === 'active' ? 'inactive' : 'active';

    if (
      !window.confirm(
        `${status === 'inactive' ? 'Deactivate' : 'Activate'} ${row.name}?`
      )
    ) {
      return;
    }

    try {
      await api.put(`/access/users/${row.id}/status`, { status });
      await load();
    } catch (e) {
      window.alert(
        e.response?.data?.message || 'Unable to change user status.'
      );
    }
  };

  const openPasswordReset = row => {
    if (!canManage || isProtectedAdmin(row)) return;
    setPasswordUser(row);
    setNewPassword('');
    setPasswordError('');
    setPasswordOpen(true);
  };

  const closePasswordReset = () => {
    if (passwordSaving) return;
    setPasswordOpen(false);
    setPasswordUser(null);
    setNewPassword('');
    setPasswordError('');
  };

  const resetPassword = async e => {
    e.preventDefault();

    if (!canManage || !passwordUser) return;

    if (newPassword.length < 8) {
      return setPasswordError(
        'Temporary password must be at least 8 characters.'
      );
    }

    try {
      setPasswordSaving(true);
      setPasswordError('');

      await api.put(`/access/users/${passwordUser.id}/password`, {
        password: newPassword
      });

      closePasswordReset();
      window.alert('Password updated successfully.');
    } catch (e) {
      setPasswordError(
        e.response?.data?.message || 'Unable to reset password.'
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="page">
        <div style={s.denied}>
          <ShieldCheck size={22} />
          <div>
            <strong>Access restricted</strong>
            <p>
              You do not have permission to view Users & Access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header" style={s.pageHeader}>
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Users & Access</h1>
          <p>
            Create users and control their role separately for each company.
          </p>
        </div>

        {canManage ? (
          <button className="primary-btn" onClick={openCreate}>
            <Plus size={17} />
            Add user
          </button>
        ) : (
          <span className="secure">
            <ShieldCheck size={16} />
            Read-only access
          </span>
        )}
      </header>

      <div style={s.statsGrid}>
        <Stat label="Total users" value={rows.length} />
        <Stat
          label="Active"
          value={rows.filter(row => row.status === 'active').length}
        />
        <Stat
          label="Company users"
          value={rows.filter(row => row.global_role !== 'group_admin').length}
        />
      </div>

      <div className="toolbar" style={s.toolbar}>
        <div className="search" style={s.searchBox}>
          <Search size={17} />
          <input
            placeholder="Search name, email or company access"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div style={s.resultCount}>
          {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
        </div>
      </div>

      {error && !open && <div style={s.error}>{error}</div>}

      <section className="table-card" style={s.tableCard}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Access</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => {
                const protectedAdmin = isProtectedAdmin(row);
                const self = isSelf(row);

                return (
                  <tr key={row.id}>
                    <td>
                      <div style={s.userCell}>
                        <div className="avatar">
                          {row.name?.[0]?.toUpperCase() || 'U'}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <strong>{row.name}</strong>
                          <div style={s.muted}>
                            {row.global_role === 'group_admin'
                              ? 'Group Admin'
                              : 'Company access user'}
                            {self ? ' · You' : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>{row.email}</td>

                    <td>
                      {row.global_role === 'group_admin' ? (
                        <span style={s.groupBadge}>
                          <ShieldCheck size={13} />
                          All companies
                        </span>
                      ) : (
                        <div style={s.accessText}>
                          {row.company_access || 'No company access'}
                        </div>
                      )}
                    </td>

                    <td>
                      <span
                        className="status"
                        style={
                          row.status === 'inactive'
                            ? s.inactiveStatus
                            : undefined
                        }
                      >
                        {row.status}
                      </span>
                    </td>

                    <td>
                      {canManage ? (
                        <div style={s.actions}>
                          <button
                            style={{
                              ...s.iconBtn,
                              ...(protectedAdmin ? s.disabledBtn : {})
                            }}
                            title={
                              protectedAdmin
                                ? 'Protected Group Admin'
                                : 'Edit user access'
                            }
                            disabled={protectedAdmin}
                            onClick={() => openEdit(row)}
                          >
                            <Pencil size={16} />
                          </button>

                          <button
                            style={{
                              ...s.iconBtn,
                              ...(protectedAdmin ? s.disabledBtn : {})
                            }}
                            title={
                              protectedAdmin
                                ? 'Protected Group Admin'
                                : 'Reset password'
                            }
                            disabled={protectedAdmin}
                            onClick={() => openPasswordReset(row)}
                          >
                            <KeyRound size={16} />
                          </button>

                          {row.global_role !== 'group_admin' && (
                            <button
                              style={{
                                ...(row.status === 'active'
                                  ? s.iconDanger
                                  : s.iconBtn),
                                ...(self ? s.disabledBtn : {})
                              }}
                              title={
                                self
                                  ? 'You cannot change your own status'
                                  : row.status === 'active'
                                  ? 'Deactivate'
                                  : 'Activate'
                              }
                              disabled={self}
                              onClick={() => toggleStatus(row)}
                            >
                              {row.status === 'active' ? (
                                <UserX size={16} />
                              ) : (
                                <UserCheck size={16} />
                              )}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={s.readOnlyText}>View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!filtered.length && (
          <div className="empty">No users found.</div>
        )}
      </section>

      {open && canManage && (
        <div
          style={s.backdrop}
          onMouseDown={e => e.target === e.currentTarget && close()}
        >
          <form style={s.panel} onSubmit={save}>
            <div style={s.modalHead}>
              <div>
                <p className="eyebrow">USERS & ACCESS</p>
                <h2 style={{ margin: '4px 0 0' }}>
                  {editingId ? 'Edit user access' : 'Add user'}
                </h2>
                <p style={s.modalSubtitle}>
                  {editingId
                    ? 'Update profile, status and company permissions.'
                    : 'Create a user and assign company-level access.'}
                </p>
              </div>

              <button
                type="button"
                style={s.closeBtn}
                onClick={close}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div style={s.modalBody}>
              {error && <div style={s.modalError}>{error}</div>}

              <section style={s.formSection}>
                <div style={s.sectionHead}>
                  <div>
                    <strong>User information</strong>
                    <div style={s.muted}>
                      Login and account status
                    </div>
                  </div>
                </div>

                <div style={s.grid}>
                  <label style={s.label}>
                    Full name *
                    <input
                      style={s.input}
                      value={form.name}
                      onChange={e =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </label>

                  <label style={s.label}>
                    Email *
                    <input
                      style={s.input}
                      type="email"
                      value={form.email}
                      onChange={e =>
                        setForm({ ...form, email: e.target.value })
                      }
                    />
                  </label>

                  {!editingId && (
                    <label style={s.label}>
                      Temporary password *
                      <input
                        style={s.input}
                        type="password"
                        value={form.password}
                        onChange={e =>
                          setForm({
                            ...form,
                            password: e.target.value
                          })
                        }
                        placeholder="Minimum 8 characters"
                      />
                    </label>
                  )}

                  <label style={s.label}>
                    Status
                    <select
                      style={s.input}
                      value={form.status}
                      onChange={e =>
                        setForm({ ...form, status: e.target.value })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                </div>
              </section>

              <section style={s.formSection}>
                <div style={s.sectionHead}>
                  <div>
                    <strong>Company access</strong>
                    <div style={s.muted}>
                      Choose one role for each company this user can access.
                    </div>
                  </div>

                  <span style={s.accessCount}>
                    {form.access.length} selected
                  </span>
                </div>

                <div style={s.companyList}>
                  {companies.map(company => (
                    <div key={company.id} style={s.companyRow}>
                      <div style={s.companyIdentity}>
                        <div style={s.companyIcon}>
                          {(company.name || 'C')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <strong>{company.name}</strong>
                          <div style={s.muted}>
                            Company-level permission
                          </div>
                        </div>
                      </div>

                      <select
                        style={s.roleSelect}
                        value={roleForCompany(company.id)}
                        onChange={e =>
                          setCompanyRole(company.id, e.target.value)
                        }
                      >
                        <option value="">No access</option>
                        {roles
                          .filter(r => r.role_key !== 'group_admin')
                          .map(r => (
                            <option key={r.id} value={r.role_key}>
                              {r.role_name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}

                  {!companies.length && (
                    <div style={s.emptyCompanies}>
                      No companies available.
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div style={s.modalActions}>
              <button
                type="button"
                className="secondary-btn"
                onClick={close}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={saving}
              >
                <Save size={16} />
                {saving
                  ? 'Saving...'
                  : editingId
                  ? 'Update user'
                  : 'Create user'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordOpen && canManage && passwordUser && (
        <div
          style={s.passwordBackdrop}
          onMouseDown={e =>
            e.target === e.currentTarget && closePasswordReset()
          }
        >
          <form style={s.passwordModal} onSubmit={resetPassword}>
            <div style={s.passwordIcon}>
              <LockKeyhole size={21} />
            </div>

            <div style={s.passwordTitleRow}>
              <div>
                <h2 style={s.passwordTitle}>Reset password</h2>
                <p style={s.passwordSubtitle}>
                  Set a new temporary password for{' '}
                  <strong>{passwordUser.name}</strong>.
                </p>
              </div>

              <button
                type="button"
                style={s.closeBtn}
                onClick={closePasswordReset}
              >
                <X size={18} />
              </button>
            </div>

            <label style={s.label}>
              New temporary password
              <input
                autoFocus
                style={s.input}
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
              />
            </label>

            {passwordError && (
              <div style={s.modalError}>{passwordError}</div>
            )}

            <div style={s.passwordActions}>
              <button
                type="button"
                className="secondary-btn"
                onClick={closePasswordReset}
                disabled={passwordSaving}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={passwordSaving}
              >
                <KeyRound size={16} />
                {passwordSaving ? 'Updating...' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={s.statCard}>
      <span style={s.statLabel}>{label}</span>
      <strong style={s.statValue}>{value}</strong>
    </div>
  );
}

const s = {
  pageHeader: {
    alignItems: 'center'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16
  },
  statCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    padding: '14px 16px'
  },
  statLabel: {
    display: 'block',
    color: '#667085',
    fontSize: 12,
    marginBottom: 4
  },
  statValue: {
    display: 'block',
    color: '#101828',
    fontSize: 20
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  searchBox: {
    maxWidth: 480,
    width: '100%'
  },
  resultCount: {
    color: '#667085',
    fontSize: 12,
    whiteSpace: 'nowrap'
  },
  tableCard: {
    overflow: 'hidden'
  },
  userCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  muted: {
    fontSize: 12,
    color: '#667085',
    marginTop: 3,
    fontWeight: 400
  },
  accessText: {
    maxWidth: 440,
    lineHeight: 1.5,
    fontSize: 13,
    color: '#475467'
  },
  groupBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    color: '#344054'
  },
  inactiveStatus: {
    background: '#f2f4f7',
    color: '#667085'
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 6
  },
  iconBtn: {
    width: 34,
    height: 34,
    border: '1px solid #e4e7ec',
    borderRadius: 8,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    color: '#344054'
  },
  iconDanger: {
    width: 34,
    height: 34,
    border: '1px solid #fecdca',
    borderRadius: 8,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    color: '#b42318'
  },
  disabledBtn: {
    opacity: 0.4,
    cursor: 'not-allowed'
  },
  readOnlyText: {
    display: 'block',
    textAlign: 'right',
    color: '#98a2b3',
    fontSize: 12
  },
  denied: {
    display: 'flex',
    gap: 12,
    padding: 20,
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    color: '#344054'
  },
  error: {
    marginBottom: 14,
    padding: '11px 13px',
    borderRadius: 9,
    background: '#fef3f2',
    color: '#b42318',
    fontSize: 13
  },

  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,.42)',
    zIndex: 1600,
    display: 'flex',
    justifyContent: 'flex-end'
  },
  panel: {
    width: 'min(600px, 100%)',
    height: '100%',
    background: '#fff',
    boxShadow: '-16px 0 50px rgba(15,23,42,.14)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  modalHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    padding: '20px 22px',
    borderBottom: '1px solid #eaecf0',
    flex: '0 0 auto'
  },
  modalSubtitle: {
    margin: '6px 0 0',
    color: '#667085',
    fontSize: 13
  },
  closeBtn: {
    width: 36,
    height: 36,
    flex: '0 0 36px',
    border: '1px solid #e4e7ec',
    borderRadius: 9,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    color: '#475467'
  },
  modalBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '18px 20px',
    background: '#f8fafc'
  },
  formSection: {
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    padding: 16,
    marginBottom: 14
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },
  label: {
    display: 'grid',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: '#344054'
  },
  input: {
    width: '100%',
    minWidth: 0,
    height: 40,
    boxSizing: 'border-box',
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    padding: '0 10px',
    background: '#fff',
    color: '#101828',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none'
  },
  companyList: {
    display: 'grid',
    gap: 8
  },
  companyRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 190px',
    gap: 12,
    alignItems: 'center',
    padding: 10,
    border: '1px solid #eaecf0',
    borderRadius: 10,
    background: '#fcfcfd'
  },
  companyIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0
  },
  companyIcon: {
    width: 36,
    height: 36,
    flex: '0 0 36px',
    borderRadius: 9,
    background: '#eef2ff',
    color: '#4338ca',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 800
  },
  roleSelect: {
    width: '100%',
    minWidth: 0,
    height: 38,
    boxSizing: 'border-box',
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    padding: '0 9px',
    background: '#fff',
    color: '#344054',
    fontSize: 12,
    fontFamily: 'inherit'
  },
  accessCount: {
    borderRadius: 999,
    background: '#f2f4f7',
    color: '#475467',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },
  emptyCompanies: {
    padding: 14,
    textAlign: 'center',
    color: '#98a2b3',
    fontSize: 13
  },
  modalError: {
    marginBottom: 14,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef3f2',
    color: '#b42318',
    fontSize: 13
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '13px 20px',
    borderTop: '1px solid #eaecf0',
    background: '#fff',
    flex: '0 0 auto'
  },

  passwordBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1700,
    background: 'rgba(15,23,42,.42)',
    display: 'grid',
    placeItems: 'center',
    padding: 18
  },
  passwordModal: {
    width: 'min(430px, 100%)',
    boxSizing: 'border-box',
    borderRadius: 14,
    background: '#fff',
    padding: 20,
    boxShadow: '0 24px 70px rgba(15,23,42,.18)'
  },
  passwordIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    background: '#f2f4f7',
    color: '#344054',
    display: 'grid',
    placeItems: 'center',
    marginBottom: 14
  },
  passwordTitleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18
  },
  passwordTitle: {
    margin: 0,
    fontSize: 18,
    color: '#101828'
  },
  passwordSubtitle: {
    margin: '6px 0 0',
    color: '#667085',
    fontSize: 13,
    lineHeight: 1.5
  },
  passwordActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18
  }
};