import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Globe2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const blankShareholder = {
  shareholder_name: '',
  shareholder_type: 'Individual',
  share_percent: ''
};

export default function CompanyDetail() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(null);

  const user = getUser();
  const permissionSet = new Set(getPermissions());
  const isGroupAdmin = user?.role === 'group_admin';
  const canManage = isGroupAdmin || permissionSet.has('companies.manage');

  const loadCompany = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const response = await api.get(`/companies/${id}`);
      setData(response.data);
    } catch (err) {
      setData(null);
      setLoadError(
        err.response?.data?.message ||
        (err.response?.status === 403
          ? 'You do not have access to this company.'
          : 'Unable to load company.')
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompany();
  }, [id]);

  const ownershipTotal = useMemo(
    () =>
      (data?.shareholders || []).reduce(
        (sum, item) => sum + Number(item.share_percent || 0),
        0
      ),
    [data]
  );

  const openEdit = () => {
    if (!canManage || !data?.company) return;

    setForm({
      name: data.company.name || '',
      legal_name: data.company.legal_name || '',
      company_type:
        data.company.company_type || 'Subsidiary / Partner Company',
      industry: data.company.industry || '',
      sanleo_share: data.company.sanleo_share ?? '',
      country: data.company.country || 'India',
      currency: data.company.currency || 'INR',
      status: data.company.status || 'active',
      shareholders: data.shareholders?.length
        ? data.shareholders.map(item => ({
            shareholder_name: item.shareholder_name || '',
            shareholder_type:
              item.shareholder_type === 'Company' ? 'Company' : 'Individual',
            share_percent: item.share_percent ?? ''
          }))
        : [{ ...blankShareholder }]
    });

    setFormError('');
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditOpen(false);
    setForm(null);
    setFormError('');
  };

  const setField = (key, value) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const setShareholder = (index, key, value) => {
    setForm(current => ({
      ...current,
      shareholders: current.shareholders.map((item, i) =>
        i === index ? { ...item, [key]: value } : item
      )
    }));
  };

  const addShareholder = () => {
    setForm(current => ({
      ...current,
      shareholders: [...current.shareholders, { ...blankShareholder }]
    }));
  };

  const removeShareholder = index => {
    setForm(current => ({
      ...current,
      shareholders: current.shareholders.filter((_, i) => i !== index)
    }));
  };

  const saveCompany = async event => {
    event.preventDefault();
    if (!canManage || !form) return;

    const shareholders = form.shareholders
      .filter(item => item.shareholder_name.trim())
      .map(item => ({
        shareholder_name: item.shareholder_name.trim(),
        shareholder_type:
          item.shareholder_type === 'Company' ? 'Company' : 'Individual',
        share_percent: Number(item.share_percent)
      }));

    if (!form.name.trim() || !form.industry.trim()) {
      return setFormError('Company name and industry are required.');
    }

    const sanleoShare = Number(form.sanleo_share);
    if (
      !Number.isFinite(sanleoShare) ||
      sanleoShare < 0 ||
      sanleoShare > 100
    ) {
      return setFormError('Sanleo share must be between 0 and 100.');
    }

    if (shareholders.length) {
      const total = shareholders.reduce(
        (sum, item) => sum + Number(item.share_percent || 0),
        0
      );

      if (
        shareholders.some(
          item =>
            !Number.isFinite(item.share_percent) ||
            item.share_percent < 0 ||
            item.share_percent > 100
        ) ||
        Math.abs(total - 100) > 0.001
      ) {
        return setFormError(
          `Shareholder percentages must be valid and total 100%. Current total: ${total.toFixed(
            2
          )}%`
        );
      }
    }

    try {
      setSaving(true);
      setFormError('');

      await api.put(`/companies/${id}`, {
        ...form,
        name: form.name.trim(),
        legal_name: form.legal_name.trim() || form.name.trim(),
        industry: form.industry.trim(),
        sanleo_share: sanleoShare,
        shareholders
      });

      await loadCompany();
      closeEdit();
    } catch (err) {
      setFormError(
        err.response?.data?.message || 'Unable to update company.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div style={styles.stateCard}>Loading company...</div>
      </div>
    );
  }

  if (loadError || !data?.company) {
    return (
      <div className="page">
        <Link to="/companies" style={styles.backLink}>
          <ArrowLeft size={16} />
          Companies
        </Link>

        <div style={styles.errorCard}>
          <ShieldCheck size={22} />
          <div>
            <strong>Company unavailable</strong>
            <p style={styles.errorText}>
              {loadError || 'Company not found.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const company = data.company;
  const shareholders = data.shareholders || [];
  const products = data.products || [];

  return (
    <div className="page">
      <Link to="/companies" style={styles.backLink}>
        <ArrowLeft size={16} />
        Companies
      </Link>

      <header className="page-header" style={styles.pageHeader}>
        <div style={styles.headerIdentity}>
          <div style={styles.companyLogo}>
            {company.name.slice(0, 2).toUpperCase()}
          </div>

          <div>
            <p className="eyebrow">COMPANY WORKSPACE</p>
            <h1 style={{ marginBottom: 5 }}>{company.name}</h1>
            <p style={styles.subtitle}>
              {company.industry || '—'} · {company.company_type || '—'}
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <span
            className="status"
            style={
              String(company.status).toLowerCase() === 'inactive'
                ? styles.inactiveStatus
                : undefined
            }
          >
            {company.status || 'active'}
          </span>

          {canManage ? (
            <button className="primary-btn" onClick={openEdit}>
              <Pencil size={16} />
              Edit company
            </button>
          ) : (
            <span className="secure">
              <ShieldCheck size={16} />
              Read-only access
            </span>
          )}
        </div>
      </header>

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Sanleo share"
          value={`${Number(company.sanleo_share || 0).toFixed(2)}%`}
          icon={<Building2 size={18} />}
        />
        <SummaryCard
          label="Shareholders"
          value={shareholders.length}
          icon={<Users size={18} />}
        />
        <SummaryCard
          label="Products"
          value={products.length}
          icon={<Globe2 size={18} />}
        />
      </div>

      <div style={styles.contentGrid}>
        <section style={{ ...styles.panelCard, ...styles.profilePanel }}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Company profile</h2>
              <p style={styles.sectionHint}>Legal and operating information</p>
            </div>
          </div>

          <div style={styles.detailGrid}>
            {[
              ['Legal name', company.legal_name || company.name],
              ['Parent', 'Sanleo Capital'],
              ['Country', company.country || '—'],
              ['Currency', company.currency || '—'],
              ['Registration No.', company.registration_no || '—'],
              ['Website', company.website || '—']
            ].map(([label, value]) => (
              <div key={label} style={styles.detailItem}>
                <span style={styles.detailLabel}>{label}</span>
                <b style={styles.detailValue}>{value}</b>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.panelCard}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Ownership</h2>
              <p style={styles.sectionHint}>
                {ownershipTotal.toFixed(2)}% allocated
              </p>
            </div>
          </div>

          {shareholders.length ? (
            shareholders.map(item => (
              <div style={styles.shareRow} key={item.id || item.shareholder_name}>
                <div>
                  <strong>{item.shareholder_name}</strong>
                  <span>{item.shareholder_type}</span>
                </div>
                <b>{Number(item.share_percent || 0).toFixed(2)}%</b>
              </div>
            ))
          ) : (
            <div className="empty">No shareholders registered</div>
          )}
        </section>

        <section style={{ ...styles.panelCard, ...styles.productsPanel }}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Products</h2>
              <p style={styles.sectionHint}>
                Products registered under this company
              </p>
            </div>
          </div>

          {products.length ? (
            <div style={styles.productList}>
              {products.map(product => (
                <div style={styles.productRow} key={product.id}>
                  <div style={styles.productIcon}>
                    {(product.name || 'P')[0].toUpperCase()}
                  </div>

                  <div style={styles.productMain}>
                    <strong>{product.name}</strong>
                    <span>{product.description || 'No description'}</span>
                  </div>

                  <span className="status">
                    {product.status || 'active'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No products registered</div>
          )}
        </section>
      </div>

      {editOpen && canManage && form && (
        <div style={styles.overlay} onMouseDown={closeEdit}>
          <form
            style={styles.modal}
            onMouseDown={event => event.stopPropagation()}
            onSubmit={saveCompany}
          >
            <div style={styles.modalHeader}>
              <div>
                <p className="eyebrow">COMPANY MANAGEMENT</p>
                <h2 style={{ margin: '4px 0 0' }}>Edit company</h2>
              </div>

              <button
                type="button"
                style={styles.closeButton}
                onClick={closeEdit}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <div style={styles.modalBody}>
              {formError && <div style={styles.formError}>{formError}</div>}

              <section style={styles.formSection}>
                <div style={styles.formSectionHeader}>
                  <div>
                    <h3 style={styles.formSectionTitle}>Company information</h3>
                    <p style={styles.sectionHint}>Basic legal and operating details</p>
                  </div>
                </div>

                <div style={styles.formGrid}>
                <Field label="Company name">
                  <input
                    style={styles.inputControl}
                    value={form.name}
                    onChange={e => setField('name', e.target.value)}
                    required
                  />
                </Field>

                <Field label="Legal name">
                  <input
                    style={styles.inputControl}
                    value={form.legal_name}
                    onChange={e => setField('legal_name', e.target.value)}
                  />
                </Field>

                <Field label="Industry">
                  <input
                    style={styles.inputControl}
                    value={form.industry}
                    onChange={e => setField('industry', e.target.value)}
                    required
                  />
                </Field>

                <Field label="Company type">
                  <select
                    style={styles.inputControl}
                    value={form.company_type}
                    onChange={e => setField('company_type', e.target.value)}
                  >
                    <option>Subsidiary / Partner Company</option>
                    <option>Joint Venture</option>
                    <option>Joint Venture / App</option>
                    <option>App</option>
                    <option>Other</option>
                  </select>
                </Field>

                <Field label="Sanleo share %">
                  <input
                    style={styles.inputControl}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.sanleo_share}
                    onChange={e => setField('sanleo_share', e.target.value)}
                    required
                  />
                </Field>

                <Field label="Status">
                  <select
                    style={styles.inputControl}
                    value={form.status}
                    onChange={e => setField('status', e.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>

                <Field label="Country">
                  <input
                    style={styles.inputControl}
                    value={form.country}
                    onChange={e => setField('country', e.target.value)}
                  />
                </Field>

                <Field label="Currency">
                  <input
                    style={styles.inputControl}
                    value={form.currency}
                    onChange={e => setField('currency', e.target.value)}
                  />
                </Field>
                </div>
              </section>

              <section style={styles.formSection}>
                <div style={styles.ownershipHeader}>
                <div>
                  <h3 style={{ margin: 0 }}>Shareholders</h3>
                  <p style={styles.sectionHint}>
                    Percentages must total 100%.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-btn"
                  onClick={addShareholder}
                >
                  <Plus size={15} />
                  Add shareholder
                </button>
              </div>

                <div style={styles.shareholderList}>
                {form.shareholders.map((item, index) => (
                  <div style={styles.shareholderEditRow} key={index}>
                    <input
                      style={styles.inputControl}
                      placeholder="Shareholder name"
                      value={item.shareholder_name}
                      onChange={e =>
                        setShareholder(
                          index,
                          'shareholder_name',
                          e.target.value
                        )
                      }
                    />

                    <select
                      style={styles.inputControl}
                      value={item.shareholder_type}
                      onChange={e =>
                        setShareholder(
                          index,
                          'shareholder_type',
                          e.target.value
                        )
                      }
                    >
                      <option value="Individual">Individual</option>
                      <option value="Company">Company</option>
                    </select>

                    <input
                      style={styles.inputControl}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="%"
                      value={item.share_percent}
                      onChange={e =>
                        setShareholder(
                          index,
                          'share_percent',
                          e.target.value
                        )
                      }
                    />

                    <button
                      type="button"
                      style={styles.deleteButton}
                      title="Remove shareholder"
                      onClick={() => removeShareholder(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                </div>
              </section>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                className="secondary-btn"
                onClick={closeEdit}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-btn"
                disabled={saving}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryIcon}>{icon}</div>
      <div>
        <span style={styles.summaryLabel}>{label}</span>
        <strong style={styles.summaryValue}>{value}</strong>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.55fr) minmax(280px, .85fr)',
    gap: 16,
    alignItems: 'stretch'
  },
  panelCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#fff',
    padding: 18,
    boxShadow: '0 1px 2px rgba(16,24,40,.03)'
  },
  profilePanel: {
    minHeight: 250,
    height: '100%'
  },
  productsPanel: {
    gridColumn: '1 / -1'
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18
  },
  panelTitle: {
    margin: 0,
    fontSize: 17,
    color: '#101828'
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },
  detailItem: {
    border: '1px solid #eaecf0',
    borderRadius: 10,
    padding: '12px 13px',
    background: '#fcfcfd',
    minWidth: 0
  },
  detailLabel: {
    display: 'block',
    color: '#98a2b3',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.04em',
    marginBottom: 6
  },
  detailValue: {
    display: 'block',
    color: '#101828',
    fontSize: 13,
    overflowWrap: 'anywhere'
  },
  shareRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: '12px 0',
    borderBottom: '1px solid #f2f4f7'
  },
  productList: {
    display: 'grid',
    gap: 10
  },
  productRow: {
    display: 'grid',
    gridTemplateColumns: '42px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    border: '1px solid #eaecf0',
    borderRadius: 10,
    background: '#fcfcfd'
  },
  productIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    background: '#f2f4f7',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 800,
    color: '#344054'
  },
  productMain: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    marginBottom: 18,
    color: '#475467',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 600
  },
  pageHeader: {
    alignItems: 'center'
  },
  headerIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  companyLogo: {
    width: 52,
    height: 52,
    flex: '0 0 52px',
    borderRadius: 13,
    background: '#eef2ff',
    color: '#4338ca',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 800,
    fontSize: 16
  },
  subtitle: {
    margin: 0,
    color: '#667085'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  inactiveStatus: {
    background: '#f2f4f7',
    color: '#667085'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 18
  },
  summaryCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    padding: 15,
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: '#f2f4f7',
    color: '#344054',
    display: 'grid',
    placeItems: 'center'
  },
  summaryLabel: {
    display: 'block',
    color: '#667085',
    fontSize: 12,
    marginBottom: 3
  },
  summaryValue: {
    display: 'block',
    color: '#101828',
    fontSize: 18
  },
  sectionHint: {
    margin: '4px 0 0',
    color: '#98a2b3',
    fontSize: 12
  },
  stateCard: {
    padding: 22,
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    color: '#667085'
  },
  errorCard: {
    display: 'flex',
    gap: 12,
    padding: 20,
    border: '1px solid #fecdca',
    borderRadius: 12,
    background: '#fffbfa',
    color: '#b42318'
  },
  errorText: {
    margin: '5px 0 0',
    color: '#667085'
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1500,
    background: 'rgba(16,24,40,.42)',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  modal: {
    width: 'min(590px, 100%)',
    height: '100%',
    background: '#fff',
    boxShadow: '-18px 0 60px rgba(16,24,40,.16)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  modalHeader: {
    padding: '20px 22px',
    borderBottom: '1px solid #eaecf0',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    background: '#fff',
    flex: '0 0 auto'
  },
  closeButton: {
    width: 36,
    height: 36,
    border: '1px solid #e4e7ec',
    borderRadius: 9,
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    color: '#475467'
  },
  modalBody: {
    padding: '18px 20px',
    overflowY: 'auto',
    background: '#f8fafc',
    flex: 1
  },
  formSection: {
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    padding: 16,
    marginBottom: 14
  },
  formSectionHeader: {
    marginBottom: 14
  },
  formSectionTitle: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.3,
    color: '#101828'
  },
  formError: {
    marginBottom: 14,
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fef3f2',
    color: '#b42318',
    fontSize: 13
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },
  field: {
    display: 'grid',
    gap: 6,
    color: '#344054',
    fontSize: 12,
    fontWeight: 600
  },
  inputControl: {
    width: '100%',
    minWidth: 0,
    height: 40,
    boxSizing: 'border-box',
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    background: '#fff',
    color: '#101828',
    padding: '0 10px',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit'
  },
  ownershipHeader: {
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  shareholderList: {
    display: 'grid',
    gap: 8
  },
  shareholderEditRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.6fr) minmax(115px, .9fr) 88px 36px',
    gap: 8,
    alignItems: 'center'
  },
  deleteButton: {
    width: 36,
    height: 36,
    border: '1px solid #fecdca',
    borderRadius: 8,
    background: '#fff',
    color: '#b42318',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer'
  },
  modalFooter: {
    padding: '13px 20px',
    borderTop: '1px solid #eaecf0',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    background: '#fff',
    flex: '0 0 auto'
  }
};