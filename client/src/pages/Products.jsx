import { useEffect, useMemo, useState } from 'react';
import {
  Archive, Boxes, Building2, Download, ExternalLink, Globe2, Layers3,
  Pencil, Plus, Rocket, Search, ShieldCheck, Trash2, X
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const emptyForm = { company_id: '', name: '', category: '', description: '', status: 'Active', website: '' };
const tones = ['indigo', 'cyan', 'emerald', 'amber', 'rose'];
const initials = name => String(name || 'P').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const safeWebsite = value => { if (!value) return ''; try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };

export default function Products() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getUser();
  const permissions = new Set(getPermissions());
  const canManage = user?.role === 'group_admin' || permissions.has('products.manage');

  const load = async () => {
    setLoading(true);
    const [productsResult, companiesResult] = await Promise.all([api.get('/products').catch(() => ({ data: [] })), api.get('/company-options').catch(() => ({ data: [] }))]);
    setRows(productsResult.data || []); setCompanies(companiesResult.data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(product => {
    const haystack = [product.name, product.company_name, product.category, product.status, product.website].join(' ').toLowerCase();
    return (company === 'all' || String(product.company_id) === company) && (status === 'all' || product.status === status) && (!query || haystack.includes(query.toLowerCase()));
  }), [rows, query, company, status]);
  const active = rows.filter(row => row.status === 'Active').length;
  const development = rows.filter(row => row.status === 'Development').length;
  const categories = new Set(rows.map(row => row.category).filter(Boolean)).size;

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setError(''); setFormOpen(true); };
  const openDetail = async product => { try { setSelected({ ...(await api.get(`/products/${product.id}`)).data, company_name: product.company_name }); } catch { setSelected(product); } };
  const openEdit = async product => {
    setError('');
    try { const detail = (await api.get(`/products/${product.id}`)).data; setForm({ ...emptyForm, ...detail, company_id: detail.company_id || '' }); setEditingId(product.id); setSelected(null); setFormOpen(true); }
    catch (err) { window.alert(err.response?.data?.message || 'Unable to load this product.'); }
  };
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { if (editingId) await api.put(`/products/${editingId}`, form); else await api.post('/products', form); setFormOpen(false); setEditingId(null); await load(); }
    catch (err) { setError(err.response?.data?.message || err.response?.data?.detail || 'Unable to save this product.'); }
    finally { setSaving(false); }
  };
  const remove = async product => {
    if (!window.confirm(`Delete ${product.name}? This action cannot be undone.`)) return;
    try { await api.delete(`/products/${product.id}`); setSelected(null); await load(); } catch (err) { window.alert(err.response?.data?.message || 'Unable to delete this product.'); }
  };
  const exportCsv = () => {
    const escape = value => `"${String(value || '').replaceAll('"', '""')}"`;
    const data = [['Product', 'Company', 'Category', 'Status', 'Website'], ...filtered.map(p => [p.name, p.company_name, p.category, p.status, p.website])];
    const url = URL.createObjectURL(new Blob([`\uFEFF${data.map(row => row.map(escape).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'product-portfolio.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="page products-page">
    <header className="products-hero">
      <div><p className="eyebrow">PRODUCT PORTFOLIO</p><h1>Products & Projects</h1><p>Manage digital products, services and strategic projects across the group.</p></div>
      {canManage ? <button onClick={openCreate}><Plus size={17} /> Add product</button> : <span><ShieldCheck size={15} /> Read-only access</span>}
      <div className="products-hero-art"><Boxes size={72} /><i /><i /></div>
    </header>

    <section className="products-stats">
      <ProductStat icon={Layers3} label="Total portfolio" value={rows.length} note="Products and projects" tone="indigo" />
      <ProductStat icon={Rocket} label="Active" value={active} note="Currently operating" tone="green" />
      <ProductStat icon={Boxes} label="In development" value={development} note="Being built" tone="blue" />
      <ProductStat icon={Archive} label="Categories" value={categories} note="Portfolio segments" tone="amber" />
    </section>

    <div className="products-toolbar">
      <div className="products-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products, category or company" /></div>
      <select value={company} onChange={e => setCompany(e.target.value)}><option value="all">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{['Active', 'Development', 'Paused', 'Archived'].map(item => <option key={item}>{item}</option>)}</select>
      <button className="products-export" onClick={exportCsv}><Download size={15} /> Export</button>
    </div>

    {loading ? <div className="products-loading">{[1,2,3,4,5,6].map(i => <div key={i} />)}</div> : <section className="products-grid">
      {filtered.map((product, index) => <article className="product-portfolio-card" key={product.id} onClick={() => openDetail(product)}>
        <div className="product-card-head"><div className={`product-logo ${tones[index % tones.length]}`}>{initials(product.name)}</div><span className={`product-status status-${product.status.toLowerCase()}`}><i />{product.status}</span></div>
        <span className="product-category">{product.category || 'Uncategorized'}</span><h2>{product.name}</h2>
        <div className="product-owner"><Building2 size={13} /><span><small>Owned by</small><strong>{product.company_name}</strong></span></div>
        <div className="product-card-footer">{product.website ? <a href={safeWebsite(product.website)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}><Globe2 size={14} /> Visit website <ExternalLink size={12} /></a> : <span><Globe2 size={14} /> No website added</span>}{canManage && <button title="Edit product" onClick={e => { e.stopPropagation(); openEdit(product); }}><Pencil size={14} /></button>}</div>
      </article>)}
      {!filtered.length && <div className="products-empty"><Boxes size={26} /><strong>No products found</strong><span>Try changing your search or portfolio filters.</span></div>}
    </section>}

    {selected && <div className="product-drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && setSelected(null)}><aside className="product-drawer">
      <div className="product-drawer-head"><span>Product overview</span><button onClick={() => setSelected(null)}><X size={18} /></button></div>
      <div className="product-profile-hero"><div className="product-logo indigo large">{initials(selected.name)}</div><span className={`product-status status-${String(selected.status).toLowerCase()}`}><i />{selected.status}</span><h2>{selected.name}</h2><p>{selected.category || 'Uncategorized'}</p></div>
      <div className="product-profile-section"><h3>Product information</h3><div className="product-info-row"><Building2 size={16} /><span><small>Owning company</small><strong>{selected.company_name || companies.find(c => Number(c.id) === Number(selected.company_id))?.name || '—'}</strong></span></div><div className="product-info-row"><Globe2 size={16} /><span><small>Website</small>{selected.website ? <a href={safeWebsite(selected.website)} target="_blank" rel="noreferrer">{selected.website} <ExternalLink size={11} /></a> : <strong>Not provided</strong>}</span></div></div>
      <div className="product-profile-section"><h3>Description</h3><p className="product-description">{selected.description || 'No product description has been added.'}</p></div>
      {canManage && <div className="product-profile-actions"><button className="secondary-btn product-delete" onClick={() => remove(selected)}><Trash2 size={15} /> Delete</button><button className="primary-btn" onClick={() => openEdit(selected)}><Pencil size={15} /> Edit product</button></div>}
    </aside></div>}

    {formOpen && <div className="product-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !saving && setFormOpen(false)}><form className="product-modal" onSubmit={save}>
      <div className="product-modal-head"><div><p className="eyebrow">PORTFOLIO RECORD</p><h2>{editingId ? 'Edit product' : 'Add new product'}</h2><span>Keep product ownership and lifecycle information current.</span></div><button type="button" onClick={() => setFormOpen(false)}><X size={18} /></button></div>
      {error && <div className="product-form-error">{error}</div>}
      <div className="product-form-grid">
        <Field label="Product / project name" required><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Product name" /></Field>
        <Field label="Owning company" required><select required value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })}><option value="">Select company</option>{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="SaaS, Travel, Marketplace…" /></Field>
        <Field label="Lifecycle status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{['Active', 'Development', 'Paused', 'Archived'].map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Website" full><input type="url" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://product.example.com" /></Field>
        <Field label="Description" full><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What the product does, its audience and strategic purpose" /></Field>
      </div>
      <div className="product-modal-footer"><button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update product' : 'Add product'}</button></div>
    </form></div>}
  </div>;
}

function ProductStat({ icon: Icon, label, value, note, tone }) { return <div className="product-stat"><div className={`product-stat-icon ${tone}`}><Icon size={18} /></div><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>; }
function Field({ label, required, full, children }) { return <label className={`product-field ${full ? 'full' : ''}`}><span>{label}{required ? ' *' : ''}</span>{children}</label>; }
