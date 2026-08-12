import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Coins,
  Edit3,
  Globe2,
  Mail,
  MapPin,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  X
} from 'lucide-react';

import { api, getPermissions, getUser } from '../lib/api';

const defaults = {
  platform_name: 'Insight MCSITOBES',
  parent_company: 'Sanleo Capital',
  base_currency: 'INR',
  financial_year: 'April - March',
  company_address: '',
  support_email: '',
  logo_url: '',
  timezone: 'Asia/Kolkata'
};

export default function Settings() {
  const user = getUser();
  const permissions = new Set(getPermissions());

  const isGroupAdmin = user?.role === 'group_admin';
  const canManage = isGroupAdmin || permissions.has('users.manage');

  const [settings, setSettings] = useState(defaults);
  const [form, setForm] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');

      const { data } = await api.get('/settings');
      const next = {
        ...defaults,
        ...(data?.settings || {})
      };

      setSettings(next);
      setForm(next);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Unable to load settings.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManage) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [canManage]);

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(form),
    [settings, form]
  );

  const setField = (key, value) => {
    setForm(current => ({
      ...current,
      [key]: value
    }));
    setSuccess('');
  };

  const startEdit = () => {
    if (!canManage) return;
    setForm(settings);
    setError('');
    setSuccess('');
    setEditing(true);
  };

  const cancelEdit = () => {
    if (saving) return;
    setForm(settings);
    setError('');
    setSuccess('');
    setEditing(false);
  };

  const saveSettings = async e => {
    e.preventDefault();

    if (!canManage) return;

    setError('');
    setSuccess('');

    if (!form.platform_name.trim()) {
      return setError('Platform name is required.');
    }

    if (!form.parent_company.trim()) {
      return setError('Parent company is required.');
    }

    if (!form.base_currency.trim()) {
      return setError('Base currency is required.');
    }

    if (!form.financial_year.trim()) {
      return setError('Financial year is required.');
    }

    if (
      form.support_email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.support_email)
    ) {
      return setError('Enter a valid support email.');
    }

    try {
      setSaving(true);

      const payload = {
        platform_name: form.platform_name.trim(),
        parent_company: form.parent_company.trim(),
        base_currency: form.base_currency.trim(),
        financial_year: form.financial_year.trim(),
        company_address: form.company_address.trim(),
        support_email: form.support_email.trim(),
        logo_url: form.logo_url.trim(),
        timezone: form.timezone.trim()
      };

      const { data } = await api.put('/settings', {
        settings: payload
      });

      const next = {
        ...defaults,
        ...(data?.settings || payload)
      };

      setSettings(next);
      setForm(next);
      setEditing(false);
      setSuccess('Settings updated successfully.');
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          'Unable to save settings.'
      );
    } finally {
      setSaving(false);
    }
  };

  const visibleSettings = [
    {
      label: 'Platform name',
      value: settings.platform_name,
      icon: SettingsIcon
    },
    {
      label: 'Parent company',
      value: settings.parent_company,
      icon: Building2
    },
    {
      label: 'Base currency',
      value: settings.base_currency,
      icon: Coins
    },
    {
      label: 'Financial year',
      value: settings.financial_year,
      icon: CalendarDays
    },
    {
      label: 'Timezone',
      value: settings.timezone,
      icon: Globe2
    },
    {
      label: 'Support email',
      value: settings.support_email || 'Not configured',
      icon: Mail
    }
  ];

  if (loading) {
    return (
      <div className="page">
        <div style={styles.stateCard}>Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header" style={styles.pageHeader}>
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Settings</h1>
          <p>
            Group defaults, platform configuration and administrative controls.
          </p>
        </div>

        <div style={styles.headerActions}>
          <span className="secure">
            <ShieldCheck size={16} />
            {canManage ? 'Administrator access' : 'Read-only access'}
          </span>

          {canManage && !editing && (
            <button className="primary-btn" onClick={startEdit}>
              <Edit3 size={16} />
              Edit settings
            </button>
          )}
        </div>
      </header>

      {error && !editing && <div style={styles.error}>{error}</div>}

      {success && !editing && (
        <div style={styles.success}>
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {!editing ? (
        <>
          <div style={styles.layout}>
            <section style={styles.mainCard}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Group defaults</h2>
                  <p style={styles.sectionDescription}>
                    Core configuration currently used across Insight.
                  </p>
                </div>
              </div>

              <div style={styles.settingsGrid}>
                {visibleSettings.map(({ label, value, icon: Icon }) => (
                  <div key={label} style={styles.settingCard}>
                    <div style={styles.settingIcon}>
                      <Icon size={18} />
                    </div>

                    <div style={styles.settingText}>
                      <span style={styles.settingLabel}>{label}</span>
                      <strong style={styles.settingValue}>
                        {value || '—'}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside style={styles.sideCard}>
              <div style={styles.sideIcon}>
                <ShieldCheck size={20} />
              </div>

              <h3 style={styles.sideTitle}>Configuration status</h3>

              <p style={styles.sideText}>
                These values are now stored in the database and protected by
                administrator permissions.
              </p>

              <div style={styles.statusList}>
                <StatusRow
                  label="Platform identity"
                  value={settings.platform_name ? 'Configured' : 'Missing'}
                />
                <StatusRow
                  label="Parent company"
                  value={settings.parent_company ? 'Configured' : 'Missing'}
                />
                <StatusRow
                  label="Currency"
                  value={settings.base_currency ? 'Configured' : 'Missing'}
                />
                <StatusRow
                  label="Financial year"
                  value={settings.financial_year ? 'Configured' : 'Missing'}
                />
                <StatusRow
                  label="Support email"
                  value={settings.support_email ? 'Configured' : 'Optional'}
                />
              </div>
            </aside>
          </div>

          <section style={styles.infoCard}>
            <div style={styles.infoIcon}>
              <MapPin size={19} />
            </div>

            <div>
              <strong style={styles.infoTitle}>Company address</strong>
              <p style={styles.infoText}>
                {settings.company_address || 'No address configured yet.'}
              </p>
            </div>
          </section>
        </>
      ) : (
        <form onSubmit={saveSettings}>
          <section style={styles.editCard}>
            <div style={styles.editHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Edit settings</h2>
                <p style={styles.sectionDescription}>
                  Update group-wide application defaults.
                </p>
              </div>

              <button
                type="button"
                style={styles.closeButton}
                onClick={cancelEdit}
                disabled={saving}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.formGrid}>
              <Field label="Platform name *">
                <input
                  style={styles.input}
                  value={form.platform_name}
                  onChange={e =>
                    setField('platform_name', e.target.value)
                  }
                />
              </Field>

              <Field label="Parent company *">
                <input
                  style={styles.input}
                  value={form.parent_company}
                  onChange={e =>
                    setField('parent_company', e.target.value)
                  }
                />
              </Field>

              <Field label="Base currency *">
                <select
                  style={styles.input}
                  value={form.base_currency}
                  onChange={e =>
                    setField('base_currency', e.target.value)
                  }
                >
                  <option value="INR">INR — Indian Rupee</option>
                  <option value="SAR">SAR — Saudi Riyal</option>
                  <option value="AED">AED — UAE Dirham</option>
                  <option value="USD">USD — US Dollar</option>
                </select>
              </Field>

              <Field label="Financial year *">
                <select
                  style={styles.input}
                  value={form.financial_year}
                  onChange={e =>
                    setField('financial_year', e.target.value)
                  }
                >
                  <option value="April - March">April - March</option>
                  <option value="January - December">
                    January - December
                  </option>
                </select>
              </Field>

              <Field label="Timezone">
                <select
                  style={styles.input}
                  value={form.timezone}
                  onChange={e =>
                    setField('timezone', e.target.value)
                  }
                >
                  <option value="Asia/Kolkata">Asia/Kolkata</option>
                  <option value="Asia/Riyadh">Asia/Riyadh</option>
                  <option value="Asia/Dubai">Asia/Dubai</option>
                  <option value="UTC">UTC</option>
                </select>
              </Field>

              <Field label="Support email">
                <input
                  style={styles.input}
                  type="email"
                  value={form.support_email}
                  onChange={e =>
                    setField('support_email', e.target.value)
                  }
                  placeholder="info@mcsitobes.com"
                />
              </Field>

              <Field label="Logo URL">
                <input
                  style={styles.input}
                  value={form.logo_url}
                  onChange={e =>
                    setField('logo_url', e.target.value)
                  }
                  placeholder="https://..."
                />
              </Field>

              <Field label="Company address" full>
                <textarea
                  style={styles.textarea}
                  value={form.company_address}
                  onChange={e =>
                    setField('company_address', e.target.value)
                  }
                  rows={4}
                  placeholder="Company address"
                />
              </Field>
            </div>

            <div style={styles.editActions}>
              <button
                type="button"
                className="secondary-btn"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                className="primary-btn"
                disabled={saving || !dirty}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}

function StatusRow({ label, value }) {
  return (
    <div style={styles.statusRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label
      style={{
        ...styles.field,
        ...(full ? styles.fullField : {})
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  pageHeader: {
    alignItems: 'center'
  },

  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },

  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.65fr) minmax(280px, .75fr)',
    gap: 16,
    alignItems: 'start'
  },

  mainCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#fff',
    padding: 20,
    boxShadow: '0 1px 2px rgba(16,24,40,.03)'
  },

  sectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 18
  },

  sectionTitle: {
    margin: 0,
    fontSize: 17,
    color: '#101828'
  },

  sectionDescription: {
    margin: '5px 0 0',
    color: '#667085',
    fontSize: 13
  },

  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },

  settingCard: {
    border: '1px solid #eaecf0',
    borderRadius: 11,
    background: '#fcfcfd',
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0
  },

  settingIcon: {
    width: 38,
    height: 38,
    flex: '0 0 38px',
    borderRadius: 10,
    background: '#f2f4f7',
    color: '#344054',
    display: 'grid',
    placeItems: 'center'
  },

  settingText: {
    minWidth: 0
  },

  settingLabel: {
    display: 'block',
    color: '#667085',
    fontSize: 11,
    marginBottom: 4
  },

  settingValue: {
    display: 'block',
    color: '#101828',
    fontSize: 13,
    lineHeight: 1.4,
    overflowWrap: 'anywhere'
  },

  sideCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#fff',
    padding: 18,
    boxShadow: '0 1px 2px rgba(16,24,40,.03)'
  },

  sideIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    background: '#ecfdf3',
    color: '#027a48',
    display: 'grid',
    placeItems: 'center',
    marginBottom: 14
  },

  sideTitle: {
    margin: 0,
    color: '#101828',
    fontSize: 16
  },

  sideText: {
    margin: '7px 0 16px',
    color: '#667085',
    fontSize: 12,
    lineHeight: 1.6
  },

  statusList: {
    display: 'grid'
  },

  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 0',
    borderTop: '1px solid #f2f4f7',
    color: '#667085',
    fontSize: 12
  },

  infoCard: {
    marginTop: 16,
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#f8fafc',
    padding: 16,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12
  },

  infoIcon: {
    width: 38,
    height: 38,
    flex: '0 0 38px',
    borderRadius: 10,
    background: '#fff',
    border: '1px solid #e4e7ec',
    color: '#344054',
    display: 'grid',
    placeItems: 'center'
  },

  infoTitle: {
    display: 'block',
    color: '#101828',
    fontSize: 13
  },

  infoText: {
    margin: '5px 0 0',
    color: '#667085',
    fontSize: 12,
    lineHeight: 1.6
  },

  editCard: {
    border: '1px solid #e4e7ec',
    borderRadius: 14,
    background: '#fff',
    padding: 20,
    boxShadow: '0 1px 2px rgba(16,24,40,.03)'
  },

  editHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18
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

  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 14
  },

  field: {
    display: 'grid',
    gap: 6,
    color: '#344054',
    fontSize: 12,
    fontWeight: 600
  },

  fullField: {
    gridColumn: '1 / -1'
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

  textarea: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    padding: 10,
    background: '#fff',
    color: '#101828',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical'
  },

  editActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid #eaecf0'
  },

  error: {
    marginBottom: 14,
    padding: '11px 13px',
    borderRadius: 9,
    background: '#fef3f2',
    color: '#b42318',
    fontSize: 13
  },

  success: {
    marginBottom: 14,
    padding: '11px 13px',
    borderRadius: 9,
    background: '#ecfdf3',
    color: '#027a48',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },

  stateCard: {
    padding: 22,
    border: '1px solid #e4e7ec',
    borderRadius: 12,
    background: '#fff',
    color: '#667085'
  }
};