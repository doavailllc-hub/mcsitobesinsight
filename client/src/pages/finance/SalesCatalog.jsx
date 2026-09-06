import { useEffect, useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { api } from '../../lib/api';

const labels = { items: 'Items', categories: 'Categories', people: 'Salespeople' };
const singular = { items: 'item', categories: 'category', people: 'salesperson' };
const blank = { name: '', category_id: '', description: '', unit_price: '', tax_rate: 0, phone: '', email: '' };
export default function SalesCatalog({ kind, defaultCompanyId, canCreate, canEdit }) {
  const [companies,setCompanies] = useState([]), [company,setCompany] = useState('');
  const [data,setData] = useState({items:[],categories:[],people:[]});
  const [query,setQuery] = useState(''), [error,setError] = useState(''), [loading,setLoading] = useState(false);
  const [form,setForm] = useState(null), [saving,setSaving] = useState(false);
  useEffect(() => {
    api.get('/sales-catalog/companies').then(({data: rows}) => {
      setCompanies(rows); setCompany(rows.some(row => Number(row.id) === Number(defaultCompanyId)) ? String(defaultCompanyId) : String(rows[0]?.id || ''));
    }).catch(err => setError(err.response?.data?.message || 'Unable to load companies.'));
  }, [defaultCompanyId]);
  useEffect(() => {
    let active = true; setError(''); setData({items:[],categories:[],people:[]});
    if (!company) return;
    setLoading(true);
    api.get('/sales-catalog', {params:{company_id:company}}).then(({data}) => { if(active) setData(data); })
      .catch(err => {if(active) setError(err.response?.data?.message || 'Unable to load sales catalog.');})
      .finally(() => {if(active) setLoading(false);});
    return () => { active = false; };
  },[company]);
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const payload = {...form,company_id:company};
      if(form.id) await api.put(`/sales-catalog/${kind}/${form.id}`,payload);
      else await api.post(`/sales-catalog/${kind}`,payload);
      setData((await api.get('/sales-catalog',{params:{company_id:company}})).data); setForm(null);
    } catch(err) {setError(err.response?.data?.message || 'Unable to save.');} finally {setSaving(false);}
  };
  const field = (key,label,props={}) => <label className="invoice-field"><span>{label}</span><input {...props} value={form[key] ?? ''} onChange={event => setForm({...form,[key]:event.target.value})}/></label>;
  const currency = companies.find(row => String(row.id) === company)?.currency || 'INR';
  return <section className="sales-catalog">
    <div className="sales-catalog-toolbar"><label className="invoice-field"><span>Company</span><select value={company} onChange={event => setCompany(event.target.value)}><option value="">Select company</option>{companies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="invoice-field sales-catalog-search"><span>Search {labels[kind].toLowerCase()}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name"/></label>
      {canCreate && <button className="primary-btn" disabled={!company || loading} onClick={() => {setError('');setForm({...blank});}}><Plus size={16}/>Add {singular[kind]}</button>}
    </div>
    {error && <div className="finance-error" role="alert">{error}</div>}
    <div className="sales-table-scroll"><table className="finance-table"><thead><tr><th>Name</th>{kind==='items' && <><th>Category</th><th>Unit price ({currency})</th><th>Tax</th></>}{kind==='people' && <><th>Phone</th><th>Email</th></>}<th>Actions</th></tr></thead><tbody>
      {!loading && data[kind].filter(row => row.name.toLowerCase().includes(query.toLowerCase())).map(row => <tr key={row.id}><td><strong>{row.name}</strong>{kind==='items' && <small className="sales-muted">{row.description}</small>}</td>{kind==='items' && <><td>{row.category_name || 'Uncategorized'}</td><td>{Number(row.unit_price).toFixed(2)}</td><td>{Number(row.tax_rate)}%</td></>}{kind==='people' && <><td>{row.phone || '—'}</td><td>{row.email || '—'}</td></>}<td>{canEdit && <button className="secondary-btn" onClick={() => {setError('');setForm({...blank,...row});}}><Pencil size={14}/>Edit</button>}</td></tr>)}
    </tbody></table></div>
    {loading ? <div className="finance-empty">Loading…</div> : !data[kind].some(row => row.name.toLowerCase().includes(query.toLowerCase())) && <div className="finance-empty">{company ? `No ${labels[kind].toLowerCase()} found. Add one to get started.` : 'Select a company to manage its sales catalog.'}</div>}
    {form && <div className="finance-modal-backdrop sales-modal-backdrop"><form className="finance-modal sales-catalog-modal" onSubmit={save} role="dialog" aria-modal="true" aria-label={`${form.id?'Edit':'Add'} ${singular[kind]}`}>
      <div className="invoice-modal-head"><div><p className="eyebrow">{companies.find(row => String(row.id)===company)?.name}</p><h2>{form.id?'Edit':'Add'} {singular[kind]}</h2></div><button type="button" className="finance-icon-btn" aria-label="Close" disabled={saving} onClick={() => setForm(null)}><X size={18}/></button></div>
      {error && <div className="finance-error" role="alert">{error}</div>}
      <div className="invoice-form-grid">{field('name','Name *',{required:true,maxLength:180})}
        {kind==='items' && <><label className="invoice-field"><span>Category</span><select value={form.category_id || ''} onChange={event => setForm({...form,category_id:event.target.value})}><option value="">Uncategorized</option>{data.categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{field('unit_price',`Unit price (${currency}) *`,{type:'number',min:0,step:'0.01',required:true})}{field('tax_rate','Tax (%)',{type:'number',min:0,max:100,step:'0.01'})}<label className="invoice-field sales-full"><span>Description</span><textarea value={form.description || ''} onChange={event => setForm({...form,description:event.target.value})}/></label></>}
        {kind==='people' && <>{field('phone','Phone',{type:'tel',maxLength:40})}{field('email','Email',{type:'email',maxLength:180})}</>}
      </div><div className="finance-modal-actions"><button type="button" className="secondary-btn" disabled={saving} onClick={() => setForm(null)}>Cancel</button><button className="primary-btn" disabled={saving}>{saving?'Saving…':'Save '+singular[kind]}</button></div>
    </form></div>}
  </section>;
}
