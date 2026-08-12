import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Eye, Download, ShieldCheck, X, Pencil, Trash2, Copy } from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const config = {
  finance: {
    title: 'Finance',
    subtitle: 'Income, expenses, capital and intercompany transactions.',
    endpoint: '/finance',
    cols: ['date', 'company_name', 'type', 'category', 'description', 'amount'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'type', label: 'Type', type: 'select', required: true, options: ['income', 'expense', 'capital', 'loan', 'intercompany'] },
      { key: 'category', label: 'Category', required: true, placeholder: 'Services, Rent, Software...' },
      { key: 'description', label: 'Description', placeholder: 'Transaction description' },
      { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0, step: '0.01' },
      { key: 'currency', label: 'Currency', type: 'select', options: ['INR'], default: 'INR' }
    ]
  },
  people: {
    title: 'Key People',
    subtitle: 'Shareholders, directors, partners and leadership.',
    endpoint: '/people',
    cols: ['name', 'position', 'company_name', 'phone', 'email'],
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'position', label: 'Position / Role', required: true, placeholder: 'Director, Partner, Shareholder...' },
      { key: 'primary_company_id', label: 'Primary company', type: 'company', required: true },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true }
    ]
  },
  employees: {
    title: 'Employees',
    subtitle: 'Employees across all group companies.',
    endpoint: '/employees',
    cols: ['employee_code', 'name', 'company_name', 'designation', 'joining_date', 'salary'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'employee_code', label: 'Employee code', placeholder: 'MCS-001' },
      { key: 'name', label: 'Employee name', required: true },
      { key: 'designation', label: 'Designation' },
      { key: 'joining_date', label: 'Joining date', type: 'date' },
      { key: 'salary', label: 'Monthly salary (₹)', type: 'number', min: 0, step: '0.01', default: 0 },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' }
    ]
  },
  payroll: {
    title: 'Payroll',
    subtitle: 'Monthly salary processing and payment status.',
    endpoint: '/payroll',
    cols: ['month', 'employee_name', 'company_name', 'gross_salary', 'deduction', 'net_salary', 'status'],
    fields: [
      { key: 'employee_id', label: 'Employee', type: 'employee', required: true },
      { key: 'month', label: 'Salary month', type: 'month', required: true },
      { key: 'gross_salary', label: 'Gross salary (₹)', type: 'number', min: 0, step: '0.01', required: true },
      { key: 'deduction', label: 'Deduction (₹)', type: 'number', min: 0, step: '0.01', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Paid'], default: 'Pending' },
      { key: 'paid_date', label: 'Paid date', type: 'date' }
    ]
  },
  reminders: {
    title: 'Reminders',
    subtitle: 'Rent, renewals, statutory dates and recurring obligations.',
    endpoint: '/reminders',
    cols: ['due_date', 'title', 'company_name', 'category', 'priority', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', allowBlank: true },
      { key: 'title', label: 'Reminder title', required: true },
      { key: 'category', label: 'Category', placeholder: 'Office Rent, Domain, HR...' },
      { key: 'due_date', label: 'Due date', type: 'date', required: true },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'], default: 'Medium' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending', 'completed', 'cancelled'], default: 'pending' },
      { key: 'recurrence', label: 'Recurrence', placeholder: 'Monthly, Yearly, None' },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true }
    ]
  },
  assets: {
    title: 'Company Assets',
    subtitle: 'Track equipment, devices, vehicles and licenses.',
    endpoint: '/assets',
    cols: ['asset_code', 'name', 'company_name', 'category', 'assigned_to', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'asset_code', label: 'Asset code', placeholder: 'MCS-IT-001' },
      { key: 'name', label: 'Asset name', required: true },
      { key: 'category', label: 'Category', placeholder: 'Laptop, Vehicle, Software...' },
      { key: 'assigned_to', label: 'Assigned to' },
      { key: 'purchase_date', label: 'Purchase date', type: 'date' },
      { key: 'purchase_cost', label: 'Purchase cost (₹)', type: 'number', min: 0, step: '0.01' },
      { key: 'warranty_expiry', label: 'Warranty expiry', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Available', 'Assigned', 'Repair', 'Retired', 'Sold'], default: 'Available' }
    ]
  },
  offices: {
    title: 'Offices',
    subtitle: 'Office leases, rents, landlords and operating locations.',
    endpoint: '/offices',
    cols: ['name', 'company_name', 'city', 'monthly_rent', 'rent_due_day', 'lease_end'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'name', label: 'Office name', required: true },
      { key: 'city', label: 'City' },
      { key: 'address', label: 'Address', type: 'textarea', full: true },
      { key: 'landlord', label: 'Landlord / Owner' },
      { key: 'monthly_rent', label: 'Monthly rent (₹)', type: 'number', min: 0, step: '0.01', default: 0 },
      { key: 'rent_due_day', label: 'Rent due day', type: 'number', min: 1, max: 31 },
      { key: 'lease_start', label: 'Lease start', type: 'date' },
      { key: 'lease_end', label: 'Lease end', type: 'date' },
      { key: 'security_deposit', label: 'Security deposit (₹)', type: 'number', min: 0, step: '0.01', default: 0 }
    ]
  },
  domains: {
    title: 'Domains',
    subtitle: 'Domain ownership, registrar and renewal monitoring.',
    endpoint: '/domains',
    cols: ['domain', 'company_name', 'registrar', 'expiry_date', 'auto_renew', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'domain', label: 'Domain', required: true, placeholder: 'example.com' },
      { key: 'registrar', label: 'Registrar', placeholder: 'GoDaddy, Namecheap...' },
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'auto_renew', label: 'Auto renewal enabled', type: 'checkbox', default: false },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Expired', 'Transferred'], default: 'Active' }
    ]
  },
  emails: {
    title: 'Email Accounts',
    subtitle: 'Company email directory and workspace licenses.',
    endpoint: '/emails',
    cols: ['email', 'company_name', 'provider', 'assigned_to', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'email', label: 'Email address', type: 'email', required: true },
      { key: 'provider', label: 'Provider', placeholder: 'Google Workspace, Microsoft 365...' },
      { key: 'assigned_to', label: 'Assigned to / Department' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Suspended', 'Closed'], default: 'Active' }
    ]
  },
  social: {
    title: 'Social Media',
    subtitle: 'Official brand social accounts and ownership.',
    endpoint: '/social',
    cols: ['platform', 'username', 'company_name', 'manager', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'platform', label: 'Platform', required: true, placeholder: 'Instagram, LinkedIn...' },
      { key: 'username', label: 'Username / Handle' },
      { key: 'url', label: 'Profile URL', type: 'url' },
      { key: 'manager', label: 'Account manager' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], default: 'Active' }
    ]
  },
  credentials: {
    title: 'Credentials Vault',
    subtitle: 'Protected internal account references and recovery ownership.',
    endpoint: '/credentials',
    cols: ['service_name', 'company_name', 'username', 'url', 'twofa_owner', 'updated_at'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'service_name', label: 'Service / Account', required: true, placeholder: 'AWS, GitHub, cPanel...' },
      { key: 'username', label: 'Username / Login' },
      { key: 'secret', label: 'Password / Secret', type: 'password' },
      { key: 'url', label: 'Login URL', type: 'url' },
      { key: 'twofa_owner', label: '2FA owner' },
      { key: 'recovery_info', label: 'Recovery information', type: 'textarea', full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true }
    ]
  },
  files: {
    title: 'Files',
    subtitle: 'Central company documents and expiry-aware records.',
    endpoint: '/files',
    cols: ['name', 'company_name', 'category', 'expiry_date', 'confidential', 'updated_at'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'name', label: 'Document name', required: true, placeholder: 'Trade License.pdf' },
      { key: 'category', label: 'Category', placeholder: 'Corporate, Finance, Legal...' },
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'confidential', label: 'Confidential document', type: 'checkbox', default: false }
    ],
    note: 'This step saves document metadata. Actual file upload/storage can be connected to S3 next.'
  },
  products: {
    title: 'Products & Projects',
    subtitle: 'Group products, platforms and internal projects.',
    endpoint: '/products',
    cols: ['name', 'company_name', 'category', 'status', 'website'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'name', label: 'Product / Project name', required: true },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Development', 'Paused', 'Archived'], default: 'Active' },
      { key: 'website', label: 'Website', type: 'url' }
    ]
  },
  bank: {
    title: 'Bank Accounts',
    subtitle: 'Group banking directory with masked account information.',
    endpoint: '/bank-accounts',
    cols: ['company_name', 'bank_name', 'account_name', 'masked_account', 'currency', 'status'],
    fields: [
      { key: 'company_id', label: 'Company', type: 'company', required: true },
      { key: 'bank_name', label: 'Bank name', required: true },
      { key: 'account_name', label: 'Account name' },
      { key: 'account_number', label: 'Account number', required: true },
      { key: 'iban', label: 'IBAN' },
      { key: 'swift', label: 'SWIFT / BIC' },
      { key: 'branch', label: 'Branch' },
      { key: 'currency', label: 'Currency', type: 'select', options: ['INR'], default: 'INR' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Closed'], default: 'Active' }
    ]
  },
  users: {
    title: 'Users & Access',
    subtitle: 'Company access and role-based permissions.',
    endpoint: '/users',
    cols: ['name', 'email', 'role', 'company_access', 'status'],
    fields: [
      { key: 'name', label: 'User name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', required: true },
      { key: 'role', label: 'System role', type: 'select', options: ['group_admin', 'company_admin', 'finance', 'hr', 'it_admin', 'viewer'], default: 'viewer' },
      { key: 'company_ids', label: 'Company access', type: 'companies', full: true },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' }
    ]
  },
  audit: {
    title: 'Audit Log',
    subtitle: 'Security and administrative activity history.',
    endpoint: '/audit',
    cols: ['created_at', 'user_name', 'action', 'entity_type', 'entity_name', 'ip_address']
  }
};

const pretty = s => s.replaceAll('_', ' ').replace(/\b\w/g, m => m.toUpperCase());
const moneyKeys = new Set(['amount', 'salary', 'gross_salary', 'deduction', 'net_salary', 'monthly_rent', 'purchase_cost', 'security_deposit']);

const actionPermissions = {
  finance: {
    create: 'finance.create',
    edit: 'finance.edit',
    delete: 'finance.delete'
  },
  people: {
    create: 'people.manage',
    edit: 'people.manage',
    delete: 'people.manage'
  },
  employees: {
    create: 'employees.manage',
    edit: 'employees.manage',
    delete: 'employees.manage'
  },
  payroll: {
    create: 'payroll.manage',
    edit: 'payroll.manage',
    delete: 'payroll.manage'
  },
  reminders: {
    create: 'reminders.manage',
    edit: 'reminders.manage',
    delete: 'reminders.manage'
  },
  assets: {
    create: 'assets.manage',
    edit: 'assets.manage',
    delete: 'assets.manage'
  },
  offices: {
    create: 'offices.manage',
    edit: 'offices.manage',
    delete: 'offices.manage'
  },
  domains: {
    create: 'domains.manage',
    edit: 'domains.manage',
    delete: 'domains.manage'
  },
  emails: {
    create: 'emails.manage',
    edit: 'emails.manage',
    delete: 'emails.manage'
  },
  social: {
    create: 'social.manage',
    edit: 'social.manage',
    delete: 'social.manage'
  },
  credentials: {
    create: 'credentials.manage',
    edit: 'credentials.manage',
    delete: 'credentials.manage',
    reveal: 'credentials.view_secret'
  },
  files: {
    create: 'files.manage',
    edit: 'files.manage',
    delete: 'files.manage'
  },
  products: {
    create: 'products.manage',
    edit: 'products.manage',
    delete: 'products.manage'
  },
  bank: {
    create: 'bank.manage',
    edit: 'bank.manage',
    delete: 'bank.manage'
  },
  users: {
    create: 'users.manage',
    edit: 'users.manage',
    delete: 'users.manage'
  },
  audit: {}
};


function defaultsFor(fields = []) {
  return fields.reduce((acc, f) => {
    acc[f.key] = f.type === 'checkbox' ? Boolean(f.default) :
      f.type === 'companies' ? [] :
      (f.default ?? '');
    return acc;
  }, {});
}

export default function DataModule({ type }) {
  const c = config[type];
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => defaultsFor(c.fields));
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const user = getUser();
  const permissions = getPermissions();
  const permissionSet = new Set(permissions);
  const isGroupAdmin = user?.role === 'group_admin';
  const action = actionPermissions[type] || {};

  const can = permission =>
    Boolean(permission) &&
    (isGroupAdmin || permissionSet.has(permission));

  const canCreate = can(action.create);
  const canEdit = can(action.edit);
  const canDelete = can(action.delete);
  const canReveal = can(action.reveal);

  const loadRows = async () => {
    try {
      const r = await api.get(c.endpoint);
      setRows(r.data);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    setOpen(false);
    setEditingId(null);
    setForm(defaultsFor(c.fields));
    loadRows();
  }, [c.endpoint]);

  const filtered = useMemo(
    () => rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );

  const openAdd = async () => {
    if (!c.fields || !canCreate) return;
    setEditingId(null);
    setError('');
    setForm(defaultsFor(c.fields));

    try {
      await loadOptions();
      setOpen(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load form options.');
    }
  };

  const loadOptions = async () => {
    const needsCompany = c.fields?.some(f => f.type === 'company' || f.type === 'companies');
    const needsEmployee = c.fields?.some(f => f.type === 'employee');
    const requests = [];
    if (needsCompany) requests.push(api.get('/company-options'));
    if (needsEmployee) requests.push(api.get('/employee-options'));

    const results = await Promise.all(requests);
    let i = 0;
    if (needsCompany) setCompanies(results[i++].data);
    if (needsEmployee) setEmployees(results[i++].data);
  };

  const editRecord = async id => {
    if (!c.fields || !canEdit) return;
    setError('');
    try {
      await loadOptions();
      const r = await api.get(`${c.endpoint}/${id}`);
      const values = defaultsFor(c.fields);
      for (const field of c.fields) {
        if (field.key === 'password' || field.key === 'secret') {
          values[field.key] = '';
        } else if (field.type === 'checkbox') {
          values[field.key] = Boolean(Number(r.data[field.key]));
        } else if (field.type === 'companies') {
          values[field.key] = Array.isArray(r.data[field.key]) ? r.data[field.key].map(Number) : [];
        } else {
          values[field.key] = r.data[field.key] ?? values[field.key];
        }
      }
      setForm(values);
      setEditingId(id);
      setOpen(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load this record.');
    }
  };

  const deleteRecord = async (id, row) => {
    if (!canDelete) return;
    const label = row.name || row.title || row.email || row.domain || row.service_name || row.bank_name || `record #${id}`;
    if (!window.confirm(`Delete "${label}"? This action cannot be undone.`)) return;

    try {
      await api.delete(`${c.endpoint}/${id}`);
      await loadRows();
    } catch (err) {
      window.alert(err.response?.data?.message || err.response?.data?.detail || 'Unable to delete record.');
    }
  };

  const revealCredential = async row => {
    if (!canReveal) return;

    try {
      const response = await api.get(`/credentials/${row.id}/reveal`);
      setRevealedSecret({
        service: row.service_name || 'Credential',
        username: row.username || '',
        secret: response.data?.secret || ''
      });
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        err.response?.data?.detail ||
        'Unable to reveal this credential.'
      );
    }
  };

  const copySecret = async () => {
    if (!revealedSecret?.secret) return;

    try {
      await navigator.clipboard.writeText(revealedSecret.secret);
    } catch {
      window.alert('Unable to copy the secret.');
    }
  };

  const close = () => {
    if (saving) return;
    setOpen(false);
    setEditingId(null);
    setError('');
  };

  const change = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleCompany = id => {
    setForm(prev => {
      const current = Array.isArray(prev.company_ids) ? prev.company_ids : [];
      const exists = current.includes(id);
      return { ...prev, company_ids: exists ? current.filter(x => x !== id) : [...current, id] };
    });
  };

  const save = async e => {
    e.preventDefault();
    setError('');

    if (editingId && !canEdit) {
      return setError('You do not have permission to edit this record.');
    }

    if (!editingId && !canCreate) {
      return setError('You do not have permission to create this record.');
    }

    for (const field of c.fields || []) {
      if (field.required && !(editingId && (field.key === 'password' || field.key === 'secret'))) {
        const value = form[field.key];
        if (value === '' || value === null || value === undefined)
          return setError(`${field.label} is required.`);
      }
    }

    try {
      setSaving(true);
      if (editingId) await api.put(`${c.endpoint}/${editingId}`, form);
      else await api.post(c.endpoint, form);
      await loadRows();
      setOpen(false);
      setEditingId(null);
      setForm(defaultsFor(c.fields));
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.detail || 'Unable to save record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">INSIGHT MCSITOBES</p>
          <h1>{c.title}</h1>
          <p>{c.subtitle}</p>
        </div>
        {type === 'audit'
          ? <span className="secure"><ShieldCheck size={16} />Immutable activity trail</span>
          : canCreate
            ? <button className="primary-btn" onClick={openAdd}><Plus size={17} />Add record</button>
            : <span className="secure"><ShieldCheck size={16} />Read-only access</span>}
      </header>

      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder={`Search ${c.title.toLowerCase()}`}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <button className="secondary-btn"><Download size={16} />Export</button>
      </div>

      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {c.cols.map(x => <th key={x}>{pretty(x)}</th>)}
                {(canEdit || canDelete || canReveal) && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id || i}>
                  {c.cols.map(k => (
                    <td key={k}>
                      {moneyKeys.has(k)
                        ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(r[k] || 0)
                        : render(r[k], k)}
                    </td>
                  ))}
                  {(canEdit || canDelete || canReveal) && (
                    <td className="actions">
                      <div style={styles.rowActions}>
                        {type === 'credentials' && canReveal && (
                          <button
                            type="button"
                            title="Reveal secret"
                            style={styles.actionIcon}
                            onClick={() => revealCredential(r)}
                          >
                            <Eye size={16} />
                          </button>
                        )}

                        {canEdit && (
                          <button
                            type="button"
                            title="Edit"
                            style={styles.actionIcon}
                            onClick={() => editRecord(r.id)}
                          >
                            <Pencil size={16} />
                          </button>
                        )}

                        {canDelete && (
                          <button
                            type="button"
                            title="Delete"
                            style={styles.actionIconDanger}
                            onClick={() => deleteRecord(r.id, r)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <div className="empty">No records found.</div>}
      </section>

      {open && c.fields && (
        <div style={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && close()}>
          <div style={styles.panel}>
            <div style={styles.header}>
              <div>
                <p className="eyebrow">INSIGHT MCSITOBES</p>
                <h2 style={{ margin: '4px 0 0' }}>{editingId ? 'Edit' : 'Add'} {c.title.replace(/s$/, '')}</h2>
              </div>
              <button type="button" onClick={close} style={styles.iconButton}><X size={20} /></button>
            </div>

            <form onSubmit={save}>
              <div style={styles.grid}>
                {c.fields.map(field => (
                  <Field
                    key={field.key}
                    field={field}
                    value={form[field.key]}
                    companies={companies}
                    employees={employees}
                    onChange={change}
                    onToggleCompany={toggleCompany}
                  />
                ))}
              </div>

              {c.note && <div style={styles.note}>{c.note}</div>}
              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.actions}>
                <button type="button" className="secondary-btn" onClick={close}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update record' : 'Save record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {revealedSecret && (
        <div
          style={styles.secretBackdrop}
          onMouseDown={e => {
            if (e.target === e.currentTarget) setRevealedSecret(null);
          }}
        >
          <div style={styles.secretCard}>
            <div style={styles.secretHeader}>
              <div>
                <p className="eyebrow">SECURE CREDENTIAL</p>
                <h2 style={{ margin: '4px 0 0' }}>{revealedSecret.service}</h2>
              </div>
              <button
                type="button"
                style={styles.iconButton}
                onClick={() => setRevealedSecret(null)}
              >
                <X size={20} />
              </button>
            </div>

            {revealedSecret.username && (
              <div style={styles.secretField}>
                <span>Username</span>
                <strong>{revealedSecret.username}</strong>
              </div>
            )}

            <div style={styles.secretField}>
              <span>Password / Secret</span>
              <div style={styles.secretValueRow}>
                <code style={styles.secretValue}>
                  {revealedSecret.secret || 'No secret saved'}
                </code>
                {revealedSecret.secret && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={copySecret}
                  >
                    <Copy size={15} />
                    Copy
                  </button>
                )}
              </div>
            </div>

            <div style={styles.secretWarning}>
              This reveal is recorded in the audit log.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ field, value, companies, employees, onChange, onToggleCompany }) {
  const wrapStyle = field.full ? { ...styles.label, gridColumn: '1 / -1' } : styles.label;

  if (field.type === 'checkbox') {
    return (
      <label style={{ ...wrapStyle, display: 'flex', alignItems: 'center', gap: 10, minHeight: 42 }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(field.key, e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === 'companies') {
    return (
      <div style={wrapStyle}>
        <span>{field.label}</span>
        <div style={styles.checkList}>
          {companies.map(company => (
            <label key={company.id} style={styles.checkItem}>
              <input
                type="checkbox"
                checked={(value || []).includes(company.id)}
                onChange={() => onToggleCompany(company.id)}
              />
              {company.name}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'company') {
    return (
      <label style={wrapStyle}>{field.label}{field.required ? ' *' : ''}
        <select style={styles.input} value={value ?? ''} onChange={e => onChange(field.key, e.target.value)}>
          <option value="">{field.allowBlank ? 'Group / No specific company' : 'Select company'}</option>
          {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'employee') {
    return (
      <label style={wrapStyle}>{field.label}{field.required ? ' *' : ''}
        <select style={styles.input} value={value ?? ''} onChange={e => onChange(field.key, e.target.value)}>
          <option value="">Select employee</option>
          {employees.map(employee => (
            <option key={employee.id} value={employee.id}>
              {employee.name}{employee.company_name ? ` — ${employee.company_name}` : ''}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label style={wrapStyle}>{field.label}{field.required ? ' *' : ''}
        <select style={styles.input} value={value ?? ''} onChange={e => onChange(field.key, e.target.value)}>
          {!field.required && !field.default && <option value="">Select</option>}
          {(field.options || []).map(option => <option key={option} value={option}>{pretty(String(option))}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label style={wrapStyle}>{field.label}{field.required ? ' *' : ''}
        <textarea
          style={{ ...styles.input, minHeight: 92, resize: 'vertical' }}
          value={value ?? ''}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder || ''}
        />
      </label>
    );
  }

  return (
    <label style={wrapStyle}>{field.label}{field.required ? ' *' : ''}
      <input
        style={styles.input}
        type={field.type || 'text'}
        value={value ?? ''}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={e => onChange(field.key, e.target.value)}
        placeholder={field.placeholder || ''}
      />
    </label>
  );
}

function render(v, k) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'confidential' || k === 'auto_renew') return Number(v) ? 'Yes' : 'No';
  if (String(k).includes('status')) return <span className="status">{v}</span>;
  return String(v);
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 1000,
    display: 'flex', justifyContent: 'flex-end'
  },
  panel: {
    width: 'min(720px,100%)', height: '100%', background: '#fff', padding: '28px',
    overflowY: 'auto', boxShadow: '-16px 0 50px rgba(15,23,42,.12)'
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '26px'
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '16px'
  },
  label: {
    display: 'grid', gap: '7px', fontSize: '13px', fontWeight: 600, color: '#344054'
  },
  input: {
    width: '100%', boxSizing: 'border-box', minHeight: '42px', border: '1px solid #d0d5dd',
    borderRadius: '9px', padding: '9px 11px', background: '#fff', color: '#101828', outline: 'none'
  },
  iconButton: {
    width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: '1px solid #e4e7ec',
    borderRadius: '9px', background: '#fff', cursor: 'pointer'
  },
  checkList: {
    border: '1px solid #e4e7ec', borderRadius: '10px', padding: '10px 12px',
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '8px'
  },
  checkItem: {
    display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500, minHeight: '30px'
  },
  note: {
    marginTop: '16px', padding: '11px 13px', borderRadius: '9px',
    background: '#f8fafc', border: '1px solid #e4e7ec', color: '#475467', fontSize: '13px'
  },
  error: {
    marginTop: '16px', padding: '11px 13px', borderRadius: '9px',
    background: '#fef3f2', color: '#b42318', fontSize: '13px'
  },
  actions: {
    display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', paddingBottom: '12px'
  },
  rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' },
  actionIcon: {
    width: '34px', height: '34px', display: 'grid', placeItems: 'center',
    border: '1px solid #e4e7ec', borderRadius: '8px', background: '#fff', cursor: 'pointer', color: '#344054'
  },
  actionIconDanger: {
    width: '34px', height: '34px', display: 'grid', placeItems: 'center',
    border: '1px solid #fecdca', borderRadius: '8px', background: '#fff', cursor: 'pointer', color: '#b42318'
  },
  secretBackdrop: {
    position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.48)',
    display: 'grid', placeItems: 'center', padding: '20px'
  },
  secretCard: {
    width: 'min(520px,100%)', background: '#fff', borderRadius: '14px',
    boxShadow: '0 24px 70px rgba(15,23,42,.22)', padding: '24px'
  },
  secretHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: '16px', marginBottom: '22px'
  },
  secretField: {
    display: 'grid', gap: '8px', padding: '14px 0', borderTop: '1px solid #eaecf0'
  },
  secretValueRow: {
    display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
  },
  secretValue: {
    flex: 1, minWidth: 0, overflowWrap: 'anywhere', padding: '11px 12px',
    border: '1px solid #e4e7ec', borderRadius: '9px', background: '#f8fafc',
    color: '#101828', fontSize: '14px'
  },
  secretWarning: {
    marginTop: '8px', padding: '10px 12px', borderRadius: '9px',
    background: '#fffaeb', color: '#7a2e0e', fontSize: '12px'
  }
};