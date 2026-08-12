import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ArrowUpRight, X, Trash2, Pencil, ShieldCheck } from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const emptyForm = {
  name: '',
  legal_name: '',
  company_type: 'Subsidiary / Partner Company',
  industry: '',
  sanleo_share: '',
  country: 'India',
  currency: 'INR',
  status: 'active',
  shareholders: [{ shareholder_name: 'Sanleo Capital', shareholder_type: 'Company', share_percent: '' }]
};

export default function Companies() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All companies');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);

  const user = getUser();
  const permissionSet = new Set(getPermissions());
  const isGroupAdmin = user?.role === 'group_admin';
  const canManage = isGroupAdmin || permissionSet.has('companies.manage');

  const loadCompanies = async () => {
    try {
      const r = await api.get('/companies');
      setRows(r.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load companies.');
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const updateField = (key, value) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'sanleo_share') {
        next.shareholders = prev.shareholders.map((s, i) =>
          i === 0 ? { ...s, share_percent: value } : s
        );
      }
      return next;
    });
  };

  const updateShareholder = (index, key, value) => {
    setForm(prev => ({
      ...prev,
      shareholders: prev.shareholders.map((s, i) =>
        i === index ? { ...s, [key]: value } : s
      )
    }));
  };

  const addShareholder = () => {
    setForm(prev => ({
      ...prev,
      shareholders: [
        ...prev.shareholders,
        { shareholder_name: '', shareholder_type: 'Individual', share_percent: '' }
      ]
    }));
  };

  const removeShareholder = index => {
    if (index === 0) return;
    setForm(prev => ({
      ...prev,
      shareholders: prev.shareholders.filter((_, i) => i !== index)
    }));
  };

  const closeModal = () => {
    if (saving) return;
    setOpen(false);
    setEditingId(null);
    setError('');
    setForm(emptyForm);
  };

  const openCreate = () => {
    if (!canManage) return;
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setOpen(true);
  };

  const openEdit = async companyId => {
    if (!canManage) return;

    setError('');

    try {
      const response = await api.get(`/companies/${companyId}`);
      const company = response.data?.company || {};
      const shareholders = Array.isArray(response.data?.shareholders)
        ? response.data.shareholders
        : [];

      setEditingId(companyId);
      setForm({
        name: company.name || '',
        legal_name: company.legal_name || '',
        company_type: company.company_type || 'Subsidiary / Partner Company',
        industry: company.industry || '',
        sanleo_share: company.sanleo_share ?? '',
        country: company.country || 'India',
        currency: company.currency || 'INR',
        status: company.status || 'active',
        shareholders: shareholders.length
          ? shareholders.map(s => ({
              shareholder_name: s.shareholder_name || '',
              shareholder_type: s.shareholder_type || 'Individual',
              share_percent: s.share_percent ?? ''
            }))
          : [{
              shareholder_name: 'Sanleo Capital',
              shareholder_type: 'Company',
              share_percent: company.sanleo_share ?? ''
            }]
      });

      setOpen(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Unable to load this company.'
      );
    }
  };

  const deleteCompany = async company => {
    if (!canManage) return;

    if (
      !window.confirm(
        `Delete "${company.name}"? If it has related records, Insight will block deletion and you can deactivate it instead.`
      )
    ) {
      return;
    }

    try {
      await api.delete(`/companies/${company.id}`);
      await loadCompanies();
    } catch (err) {
      window.alert(
        err.response?.data?.message ||
        err.response?.data?.detail ||
        'Unable to delete company.'
      );
    }
  };

  const saveCompany = async e => {
    e.preventDefault();
    setError('');

    const sanleoShare = Number(form.sanleo_share);
    const shareholders = form.shareholders
      .filter(s => s.shareholder_name.trim())
      .map(s => ({ ...s, share_percent: Number(s.share_percent) }));

    const totalShare = shareholders.reduce((sum, s) => sum + Number(s.share_percent || 0), 0);

    if (!form.name.trim()) return setError('Company name is required.');
    if (!form.industry.trim()) return setError('Industry is required.');
    if (Number.isNaN(sanleoShare) || sanleoShare < 0 || sanleoShare > 100)
      return setError('Sanleo share must be between 0 and 100.');
    if (shareholders.length && Math.abs(totalShare - 100) > 0.001)
      return setError(`Shareholder total must be 100%. Current total is ${totalShare}%.`);

    if (!canManage) {
      return setError('You do not have permission to manage companies.');
    }

    try {
      setSaving(true);

      const payload = {
        ...form,
        legal_name: form.legal_name.trim() || form.name.trim(),
        sanleo_share: sanleoShare,
        shareholders
      };

      if (editingId) {
        await api.put(`/companies/${editingId}`, payload);
      } else {
        await api.post('/companies', payload);
      }
      await loadCompanies();
      closeModal();
    } catch (err) {
      setError(err.response?.data?.message || (editingId ? 'Unable to update company.' : 'Unable to add company.'));
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.industry || '').toLowerCase().includes(search.toLowerCase());
    const matchesType =
      type === 'All companies' ||
      (type === 'Subsidiary' && (c.company_type || '').toLowerCase().includes('subsidiary')) ||
      (type === 'Joint venture' && (c.company_type || '').toLowerCase().includes('joint'));
    return matchesSearch && matchesType;
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ORGANIZATION</p>
          <h1>Companies</h1>
          <p>Subsidiaries, joint ventures and partner companies.</p>
        </div>
        {canManage ? (
          <button className="primary-btn" onClick={openCreate}>
            <Plus size={17} /> Add company
          </button>
        ) : (
          <span className="secure">
            <ShieldCheck size={16} /> Read-only access
          </span>
        )}
      </header>

      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="Search companies"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option>All companies</option>
          <option>Subsidiary</option>
          <option>Joint venture</option>
        </select>
      </div>

      <section className="cards-grid">
        {filtered.map(c => (
          <article key={c.id} style={styles.companyCard}>
            <div style={styles.cardContent}>
              <div style={styles.cardTop}>
                <div style={styles.companyIdentity}>
                  <div className="company-logo">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>

                  <div style={styles.companyTitle}>
                    <h3 style={styles.companyName}>{c.name}</h3>
                    <p style={styles.companyIndustry}>{c.industry || '—'}</p>
                  </div>
                </div>

                <span
                  style={{
                    ...styles.statusBadge,
                    ...(String(c.status).toLowerCase() === 'inactive'
                      ? styles.statusInactive
                      : styles.statusActive)
                  }}
                >
                  {c.status || 'active'}
                </span>
              </div>

              <div style={styles.infoGrid}>
                <div style={styles.infoItem}>
                  <span style={styles.infoLabel}>Type</span>
                  <strong style={styles.infoValue}>{c.company_type || '—'}</strong>
                </div>

                <div style={styles.infoItem}>
                  <span style={styles.infoLabel}>Sanleo share</span>
                  <strong style={styles.infoValue}>
                    {Number(c.sanleo_share || 0).toFixed(2)}%
                  </strong>
                </div>
              </div>

              <div style={styles.progressTrack}>
                <span
                  style={{
                    ...styles.progressFill,
                    width: `${Math.min(100, Math.max(0, Number(c.sanleo_share || 0)))}%`
                  }}
                />
              </div>
            </div>

            <div style={styles.cardFooter}>
              <Link style={styles.detailsLink} to={`/companies/${c.id}`}>
                View details
                <ArrowUpRight size={15} />
              </Link>

              {canManage && (
                <div style={styles.cardActions}>
                  <button
                    type="button"
                    style={styles.actionIcon}
                    title="Edit company"
                    onClick={() => openEdit(c.id)}
                  >
                    <Pencil size={16} />
                  </button>

                  <button
                    type="button"
                    style={styles.actionIconDanger}
                    title="Delete company"
                    onClick={() => deleteCompany(c)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>

      {open && canManage && (
        <div style={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && closeModal()}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div>
                <p className="eyebrow">ORGANIZATION</p>
                <h2 style={{ margin: '4px 0 0' }}>{editingId ? 'Edit company' : 'Add company'}</h2>
              </div>
              <button type="button" onClick={closeModal} style={styles.iconButton}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={saveCompany}>
              <div style={styles.grid}>
                <label style={styles.label}>
                  Company name *
                  <input style={styles.input} value={form.name}
                    onChange={e => updateField('name', e.target.value)} placeholder="Company name" />
                </label>

                <label style={styles.label}>
                  Legal name
                  <input style={styles.input} value={form.legal_name}
                    onChange={e => updateField('legal_name', e.target.value)} placeholder="Legal company name" />
                </label>

                <label style={styles.label}>
                  Company type
                  <select style={styles.input} value={form.company_type}
                    onChange={e => updateField('company_type', e.target.value)}>
                    <option>Subsidiary / Partner Company</option>
                    <option>Joint Venture</option>
                    <option>Joint Venture / App</option>
                    <option>Subsidiary</option>
                    <option>Partner Company</option>
                  </select>
                </label>

                <label style={styles.label}>
                  Industry *
                  <input style={styles.input} value={form.industry}
                    onChange={e => updateField('industry', e.target.value)} placeholder="Technology, Travel, Clothing..." />
                </label>

                <label style={styles.label}>
                  Sanleo Capital share (%) *
                  <input style={styles.input} type="number" min="0" max="100" step="0.01"
                    value={form.sanleo_share}
                    onChange={e => updateField('sanleo_share', e.target.value)} placeholder="60" />
                </label>

                <label style={styles.label}>
                  Country
                  <input style={styles.input} value={form.country}
                    onChange={e => updateField('country', e.target.value)} />
                </label>

                <label style={styles.label}>
                  Currency
                  <select style={styles.input} value={form.currency}
                    onChange={e => updateField('currency', e.target.value)}>
                    <option value="INR">INR (₹)</option>
                  </select>
                </label>

                <label style={styles.label}>
                  Status
                  <select style={styles.input} value={form.status}
                    onChange={e => updateField('status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <div style={styles.shareBox}>
                <div style={styles.shareTitle}>
                  <div>
                    <strong>Shareholders</strong>
                    <div style={styles.hint}>Ownership must total 100%.</div>
                  </div>
                  <button type="button" onClick={addShareholder} style={styles.secondaryButton}>
                    <Plus size={15} /> Add shareholder
                  </button>
                </div>

                {form.shareholders.map((s, index) => (
                  <div key={index} style={styles.shareRow}>
                    <input style={styles.input} value={s.shareholder_name}
                      disabled={index === 0}
                      onChange={e => updateShareholder(index, 'shareholder_name', e.target.value)}
                      placeholder="Shareholder name" />
                    <select style={styles.input} value={s.shareholder_type}
                      disabled={index === 0}
                      onChange={e => updateShareholder(index, 'shareholder_type', e.target.value)}>
                      <option>Company</option>
                      <option>Individual</option>
                    </select>
                    <input style={styles.input} type="number" min="0" max="100" step="0.01"
                      value={s.share_percent}
                      onChange={e => updateShareholder(index, 'share_percent', e.target.value)}
                      placeholder="%" />
                    {index > 0 ? (
                      <button type="button" onClick={() => removeShareholder(index)} style={styles.iconButton}>
                        <Trash2 size={17} />
                      </button>
                    ) : <span />}
                  </div>
                ))}
              </div>

              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.actions}>
                <button type="button" onClick={closeModal} style={styles.cancelButton}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update company' : 'Create company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 1000,
    display: 'flex', justifyContent: 'flex-end'
  },
  modal: {
    width: 'min(720px, 100%)', height: '100%', background: '#fff', padding: '28px',
    overflowY: 'auto', boxShadow: '-16px 0 50px rgba(15,23,42,.12)'
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '26px'
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '16px'
  },
  label: { display: 'grid', gap: '7px', fontSize: '13px', fontWeight: 600, color: '#344054' },
  input: {
    width: '100%', boxSizing: 'border-box', minHeight: '42px', border: '1px solid #d0d5dd',
    borderRadius: '9px', padding: '9px 11px', background: '#fff', color: '#101828', outline: 'none'
  },
  shareBox: {
    marginTop: '24px', border: '1px solid #e4e7ec', borderRadius: '12px', padding: '16px'
  },
  shareTitle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px'
  },
  hint: { color: '#667085', fontSize: '12px', marginTop: '3px' },
  shareRow: {
    display: 'grid', gridTemplateColumns: '2fr 1fr 100px 38px', gap: '8px', marginTop: '8px', alignItems: 'center'
  },
  secondaryButton: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid #d0d5dd',
    borderRadius: '8px', padding: '8px 10px', background: '#fff', cursor: 'pointer'
  },
  iconButton: {
    width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: '1px solid #e4e7ec',
    borderRadius: '9px', background: '#fff', cursor: 'pointer'
  },
  error: {
    marginTop: '16px', padding: '11px 13px', borderRadius: '9px', background: '#fef3f2',
    color: '#b42318', fontSize: '13px'
  },
  actions: {
    display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', paddingBottom: '12px'
  },
  cancelButton: {
    border: '1px solid #d0d5dd', background: '#fff', borderRadius: '9px', padding: '10px 16px', cursor: 'pointer'
  },
  companyCard: {
    minWidth: 0,
    minHeight: 260,
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#fff',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 1px 2px rgba(16,24,40,.03)'
  },
  cardContent: {
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    flex: 1
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    minWidth: 0
  },
  companyIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    flex: 1
  },
  companyTitle: {
    minWidth: 0,
    flex: 1
  },
  companyName: {
    margin: 0,
    color: '#101828',
    fontSize: 17,
    lineHeight: 1.3,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  companyIndustry: {
    margin: '4px 0 0',
    color: '#667085',
    fontSize: 13,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  statusBadge: {
    flex: '0 0 auto',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 700,
    textTransform: 'capitalize'
  },
  statusActive: {
    background: '#ecfdf3',
    color: '#027a48'
  },
  statusInactive: {
    background: '#f2f4f7',
    color: '#667085'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(110px, .65fr)',
    gap: 18,
    marginTop: 30,
    alignItems: 'start'
  },
  infoItem: {
    minWidth: 0,
    display: 'grid',
    gap: 5
  },
  infoLabel: {
    color: '#98a2b3',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '.04em',
    textTransform: 'uppercase'
  },
  infoValue: {
    color: '#101828',
    fontSize: 12,
    lineHeight: 1.45,
    overflowWrap: 'anywhere'
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    background: '#eaecf0',
    overflow: 'hidden',
    marginTop: 'auto'
  },
  progressFill: {
    display: 'block',
    height: '100%',
    borderRadius: 999,
    background: '#101828'
  },
  cardFooter: {
    minHeight: 58,
    borderTop: '1px solid #eaecf0',
    padding: '10px 12px 10px 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  detailsLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    color: '#344054',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 600
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto'
  },
  actionIcon: {
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
  actionIconDanger: {
    width: 34,
    height: 34,
    border: '1px solid #fecdca',
    borderRadius: 8,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    color: '#b42318'
  }
};