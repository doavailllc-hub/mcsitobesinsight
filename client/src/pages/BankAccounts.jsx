import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Check, CircleDollarSign, Copy, CreditCard, Download, Eye,
  EyeOff, Landmark, Pencil, Plus, Search, ShieldCheck, Trash2, WalletCards, X
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const emptyForm = { company_id: '', bank_name: '', account_name: '', account_number: '', iban: '', swift: '', branch: '', currency: 'INR', status: 'Active' };
const currencyNames = { INR: 'Indian Rupee', SAR: 'Saudi Riyal', AED: 'UAE Dirham', USD: 'US Dollar' };

export default function BankAccounts() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const user = getUser();
  const permissions = new Set(getPermissions());
  const canManage = user?.role === 'group_admin' || permissions.has('bank.manage');

  const load = async () => {
    setLoading(true);
    const [accountsResult, companiesResult] = await Promise.all([api.get('/bank-accounts').catch(() => ({ data: [] })), api.get('/company-options').catch(() => ({ data: [] }))]);
    setRows(accountsResult.data || []); setCompanies(companiesResult.data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(row => {
    const haystack = [row.bank_name, row.account_name, row.company_name, row.masked_account, row.currency].join(' ').toLowerCase();
    return (company === 'all' || String(row.company_id) === company) && (status === 'all' || row.status === status) && (!query || haystack.includes(query.toLowerCase()));
  }), [rows, query, company, status]);
  const active = rows.filter(row => row.status === 'Active').length;
  const currencies = new Set(rows.map(row => row.currency).filter(Boolean)).size;
  const represented = new Set(rows.map(row => row.company_id)).size;

  const openAccount = async row => {
    setRevealed(false); setDetailLoading(true); setSelected({ ...row, partial: true });
    try { setSelected({ ...(await api.get(`/bank-accounts/${row.id}`)).data, company_name: row.company_name }); }
    catch (err) { window.alert(err.response?.data?.message || 'Unable to load bank account.'); setSelected(null); }
    finally { setDetailLoading(false); }
  };
  const openCreate = () => { setEditingId(null); setForm(emptyForm); setError(''); setFormOpen(true); };
  const openEdit = async row => {
    setError('');
    try { const detail = row.account_number ? row : (await api.get(`/bank-accounts/${row.id}`)).data; setForm({ ...emptyForm, ...detail, company_id: detail.company_id || '' }); setEditingId(row.id); setSelected(null); setRevealed(false); setFormOpen(true); }
    catch (err) { window.alert(err.response?.data?.message || 'Unable to load bank account.'); }
  };
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { if (editingId) await api.put(`/bank-accounts/${editingId}`, form); else await api.post('/bank-accounts', form); setFormOpen(false); setEditingId(null); await load(); }
    catch (err) { setError(err.response?.data?.message || err.response?.data?.detail || 'Unable to save bank account.'); }
    finally { setSaving(false); }
  };
  const remove = async row => {
    if (!window.confirm(`Delete the ${row.bank_name} account for ${row.account_name || 'this company'}? This action cannot be undone.`)) return;
    try { await api.delete(`/bank-accounts/${row.id}`); setSelected(null); await load(); } catch (err) { window.alert(err.response?.data?.message || 'Unable to delete bank account.'); }
  };
  const copyValue = async (key, value) => { try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(''), 1500); } catch { window.alert('Unable to copy this value.'); } };
  const exportCsv = () => {
    const escape = value => `"${String(value || '').replaceAll('"', '""')}"`;
    const data = [['Company', 'Bank', 'Account name', 'Masked account', 'Currency', 'Status'], ...filtered.map(r => [r.company_name, r.bank_name, r.account_name, r.masked_account, r.currency, r.status])];
    const url = URL.createObjectURL(new Blob([`\uFEFF${data.map(row => row.map(escape).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'bank-account-directory.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="page bank-page">
    <header className="bank-hero"><div className="bank-hero-icon"><Landmark size={24} /></div><div><p className="eyebrow">TREASURY & BANKING</p><h1>Bank Accounts</h1><p>A secure directory of group banking relationships and account information.</p></div>{canManage ? <button onClick={openCreate}><Plus size={17} /> Add account</button> : <span><ShieldCheck size={15} /> Read-only access</span>}<div className="bank-hero-pattern" /></header>
    <section className="bank-stats"><BankStat icon={WalletCards} label="Total accounts" value={rows.length} note="Across the group" tone="navy" /><BankStat icon={Check} label="Active accounts" value={active} note="Available for operations" tone="green" /><BankStat icon={Building2} label="Companies covered" value={represented} note="With banking records" tone="blue" /><BankStat icon={CircleDollarSign} label="Currencies" value={currencies} note="Account denominations" tone="gold" /></section>

    <div className="bank-security-note"><ShieldCheck size={16} /><div><strong>Protected banking directory</strong><span>Account numbers remain masked until you deliberately reveal an individual record.</span></div></div>
    <div className="bank-toolbar"><div className="bank-search"><Search size={16} /><input placeholder="Search bank, account or company" value={query} onChange={e => setQuery(e.target.value)} /></div><select value={company} onChange={e => setCompany(e.target.value)}><option value="all">All companies</option>{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{['Active', 'Inactive', 'Closed'].map(item => <option key={item}>{item}</option>)}</select><button className="bank-export" onClick={exportCsv}><Download size={15} /> Export</button></div>

    {loading ? <div className="bank-loading">{[1,2,3,4].map(i => <div key={i} />)}</div> : <section className="bank-grid">{filtered.map((row, index) => <article className={`bank-card bank-tone-${index % 4}`} key={row.id} onClick={() => openAccount(row)}>
      <div className="bank-card-top"><div className="bank-symbol"><Landmark size={19} /></div><span className={`bank-status bank-${row.status.toLowerCase()}`}><i />{row.status}</span></div><span className="bank-label">{row.bank_name}</span><h2>{row.account_name || row.company_name}</h2><div className="bank-number"><span>{row.masked_account || '•••• ••••'}</span><ShieldCheck size={15} /></div><div className="bank-card-meta"><span><small>COMPANY</small><strong>{row.company_name}</strong></span><span><small>CURRENCY</small><strong>{row.currency}</strong></span></div><div className="bank-card-footer"><span>View secure details</span><Eye size={15} /></div>
    </article>)}{!filtered.length && <div className="bank-empty"><Landmark size={25} /><strong>No bank accounts found</strong><span>Try changing your search or filters.</span></div>}</section>}

    {selected && <div className="bank-drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && setSelected(null)}><aside className="bank-drawer"><div className="bank-drawer-head"><span>Secure account details</span><button onClick={() => setSelected(null)}><X size={18} /></button></div>{detailLoading ? <div className="bank-detail-loading" /> : <><div className="bank-profile"><div className="bank-profile-icon"><Landmark size={24} /></div><span className={`bank-status bank-${String(selected.status).toLowerCase()}`}><i />{selected.status}</span><h2>{selected.bank_name}</h2><p>{selected.account_name || 'Business account'}</p><span><Building2 size={13} /> {selected.company_name || companies.find(c => Number(c.id) === Number(selected.company_id))?.name}</span></div><div className="bank-sensitive-banner"><ShieldCheck size={16} /><span><strong>Sensitive information</strong>Reveal only when required for authorized banking work.</span><button onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={14} /> : <Eye size={14} />}{revealed ? 'Hide' : 'Reveal'}</button></div><section className="bank-detail-section"><h3>Account information</h3><SecureRow label="Account number" value={selected.account_number} revealed={revealed} copied={copied === 'account'} onCopy={() => copyValue('account', selected.account_number)} /><SecureRow label="IBAN" value={selected.iban} revealed={revealed} copied={copied === 'iban'} onCopy={() => copyValue('iban', selected.iban)} /><DetailRow label="SWIFT / BIC" value={selected.swift} /><DetailRow label="Branch" value={selected.branch} /><DetailRow label="Currency" value={`${selected.currency} · ${currencyNames[selected.currency] || 'Currency'}`} /></section>{canManage && <div className="bank-profile-actions"><button className="secondary-btn bank-delete" onClick={() => remove(selected)}><Trash2 size={15} /> Delete</button><button className="primary-btn" onClick={() => openEdit(selected)}><Pencil size={15} /> Edit account</button></div>}</>}</aside></div>}

    {formOpen && <div className="bank-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !saving && setFormOpen(false)}><form className="bank-modal" onSubmit={save}><div className="bank-modal-head"><div><p className="eyebrow">BANKING RECORD</p><h2>{editingId ? 'Edit bank account' : 'Add bank account'}</h2><span>Sensitive values are only shown inside authorized account workflows.</span></div><button type="button" onClick={() => setFormOpen(false)}><X size={18} /></button></div>{error && <div className="bank-form-error">{error}</div>}<div className="bank-form-grid">
      <BankField label="Company" required><select required value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })}><option value="">Select company</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></BankField><BankField label="Bank name" required><input required value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="Bank name" /></BankField><BankField label="Account name"><input value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} placeholder="Registered account holder" /></BankField><BankField label="Account number" required><input required autoComplete="off" value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} placeholder="Account number" /></BankField><BankField label="IBAN"><input autoComplete="off" value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value.toUpperCase() })} placeholder="International bank account number" /></BankField><BankField label="SWIFT / BIC"><input value={form.swift} onChange={e => setForm({ ...form, swift: e.target.value.toUpperCase() })} placeholder="Bank identifier code" /></BankField><BankField label="Branch"><input value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} placeholder="Branch name or location" /></BankField><BankField label="Currency"><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{Object.keys(currencyNames).map(item => <option key={item}>{item}</option>)}</select></BankField><BankField label="Account status" full><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{['Active', 'Inactive', 'Closed'].map(item => <option key={item}>{item}</option>)}</select></BankField>
    </div><div className="bank-form-security"><ShieldCheck size={16} /><span>Banking details are access-controlled. Only users with Bank Accounts management permission can change this record.</span></div><div className="bank-modal-footer"><button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update account' : 'Add account'}</button></div></form></div>}
  </div>;
}

function BankStat({ icon: Icon, label, value, note, tone }) { return <div className="bank-stat"><div className={`bank-stat-icon ${tone}`}><Icon size={18} /></div><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>; }
function BankField({ label, required, full, children }) { return <label className={`bank-field ${full ? 'full' : ''}`}><span>{label}{required ? ' *' : ''}</span>{children}</label>; }
function SecureRow({ label, value, revealed, copied, onCopy }) { const hidden = value ? `•••• •••• ${String(value).slice(-4)}` : 'Not provided'; return <div className="bank-detail-row"><span>{label}</span><div><strong>{revealed && value ? value : hidden}</strong>{value && revealed && <button onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}</div></div>; }
function DetailRow({ label, value }) { return <div className="bank-detail-row"><span>{label}</span><strong>{value || 'Not provided'}</strong></div>; }
