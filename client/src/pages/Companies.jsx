import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ArrowUpRight, X, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

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
    setError('');
    setForm(emptyForm);
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

    try {
      setSaving(true);
      await api.post('/companies', {
        ...form,
        legal_name: form.legal_name.trim() || form.name.trim(),
        sanleo_share: sanleoShare,
        shareholders
      });
      await loadCompanies();
      closeModal();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to add company.');
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
        <button className="primary-btn" onClick={() => setOpen(true)}>
          <Plus size={17} /> Add company
        </button>
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
          <Link className="company-card" to={`/companies/${c.id}`} key={c.id}>
            <div className="company-card-top">
              <div className="company-logo">{c.name.slice(0, 2).toUpperCase()}</div>
              <ArrowUpRight size={18} />
            </div>
            <h3>{c.name}</h3>
            <p>{c.industry}</p>
            <div className="mini-grid">
              <div><span>Type</span><b>{c.company_type}</b></div>
              <div><span>Sanleo share</span><b>{c.sanleo_share}%</b></div>
            </div>
            <div className="progress"><i style={{ width: `${c.sanleo_share}%` }} /></div>
          </Link>
        ))}
      </section>

      {open && (
        <div style={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && closeModal()}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div>
                <p className="eyebrow">ORGANIZATION</p>
                <h2 style={{ margin: '4px 0 0' }}>Add company</h2>
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
                  {saving ? 'Saving...' : 'Create company'}
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
  }
};