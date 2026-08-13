import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, CircleAlert, Clock3, Globe2, Mail, Palette, RotateCcw, Save, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

const defaults = {
  platform_name: 'Insight MCSITOBES', parent_company: 'Sanleo Group', base_currency: 'INR',
  financial_year: 'April - March', company_address: '', support_email: '', logo_url: '', timezone: 'Asia/Riyadh'
};

const sections = [
  { id: 'general', title: 'Workspace identity', description: 'Names used across the dashboard and generated records.', icon: Building2, fields: [
    { key: 'platform_name', label: 'Platform name', required: true, placeholder: 'Insight MCSITOBES' },
    { key: 'parent_company', label: 'Parent company', required: true, placeholder: 'Group or holding company' },
    { key: 'company_address', label: 'Company address', type: 'textarea', full: true, placeholder: 'Registered group address' }
  ]},
  { id: 'regional', title: 'Regional preferences', description: 'Defaults used for finance, dates and reporting periods.', icon: Globe2, fields: [
    { key: 'base_currency', label: 'Base currency', type: 'select', required: true, options: ['INR', 'SAR', 'AED', 'USD', 'EUR', 'GBP'] },
    { key: 'financial_year', label: 'Financial year', type: 'select', required: true, options: ['January - December', 'April - March', 'July - June'] },
    { key: 'timezone', label: 'Timezone', type: 'select', options: ['Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'UTC'] }
  ]},
  { id: 'brand', title: 'Brand & support', description: 'Public-facing identity and the help contact shown to users.', icon: Palette, fields: [
    { key: 'logo_url', label: 'Logo URL', type: 'url', full: true, placeholder: 'https://example.com/logo.png' },
    { key: 'support_email', label: 'Support email', type: 'email', full: true, placeholder: 'support@company.com' }
  ]}
];

export default function Settings() {
  const [form, setForm] = useState(defaults);
  const [saved, setSaved] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [active, setActive] = useState('general');
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  useEffect(() => {
    api.get('/settings').then(response => {
      const values = { ...defaults, ...(response.data?.settings || {}) };
      setForm(values); setSaved(values);
    }).catch(err => setError(err.response?.data?.message || 'Unable to load application settings.'))
      .finally(() => setLoading(false));
  }, []);

  const change = (key, value) => { setForm(current => ({ ...current, [key]: value })); setSuccess(''); };
  const reset = () => { setForm(saved); setError(''); setSuccess(''); };
  const save = async event => {
    event.preventDefault(); setError(''); setSuccess('');
    if (!form.platform_name.trim() || !form.parent_company.trim() || !form.base_currency || !form.financial_year) return setError('Complete all required settings before saving.');
    if (form.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.support_email)) return setError('Enter a valid support email.');
    try {
      setSaving(true);
      const response = await api.put('/settings', { settings: form });
      const values = { ...defaults, ...(response.data?.settings || form) };
      setForm(values); setSaved(values); setSuccess('Settings saved successfully.');
    } catch (err) { setError(err.response?.data?.message || 'Unable to save settings.'); }
    finally { setSaving(false); }
  };

  return <div className="page settings-page">
    <header className="settings-hero"><div className="settings-hero-icon"><SettingsIcon size={24}/></div><div><p className="eyebrow">SYSTEM CONFIGURATION</p><h1>Settings</h1><p>Control group identity, regional defaults, branding and support information.</p></div><span><ShieldCheck size={15}/>Administrator access</span></header>
    <section className="settings-status-grid"><Status icon={Building2} label="Workspace" value={form.platform_name || 'Not configured'} tone="blue"/><Status icon={Globe2} label="Currency" value={form.base_currency || '—'} tone="green"/><Status icon={Clock3} label="Timezone" value={form.timezone || 'UTC'} tone="purple"/><Status icon={Mail} label="Support" value={form.support_email || 'Not configured'} tone="amber"/></section>
    <form onSubmit={save} className="settings-shell">
      <aside className="settings-nav"><div><strong>Configuration</strong><span>Choose a section to edit</span></div>{sections.map(section => { const Icon=section.icon; return <button type="button" className={active===section.id?'active':''} onClick={()=>setActive(section.id)} key={section.id}><Icon size={16}/><span>{section.title}</span></button>})}<div className={`settings-save-state ${dirty?'dirty':''}`}>{dirty?<CircleAlert size={14}/>:<Check size={14}/>}<span>{dirty?'Unsaved changes':'All changes saved'}</span></div></aside>
      <main className="settings-content">
        {loading ? <div className="settings-loading"/> : sections.filter(section=>section.id===active).map(section => <section key={section.id} className="settings-section"><header><div className="settings-section-icon"><section.icon size={20}/></div><div><h2>{section.title}</h2><p>{section.description}</p></div></header><div className="settings-form-grid">{section.fields.map(field => <label className={field.full?'full':''} key={field.key}><span>{field.label}{field.required?' *':''}</span>{field.type==='textarea'?<textarea value={form[field.key]} placeholder={field.placeholder} onChange={e=>change(field.key,e.target.value)}/>:field.type==='select'?<select value={form[field.key]} onChange={e=>change(field.key,e.target.value)}>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input type={field.type||'text'} value={form[field.key]} placeholder={field.placeholder} onChange={e=>change(field.key,e.target.value)}/>}</label>)}</div></section>)}
        {!loading&&<section className="settings-preview"><div><span>LIVE IDENTITY PREVIEW</span><strong>{form.platform_name||'Platform name'}</strong><small>{form.parent_company||'Parent company'} · {form.base_currency} · {form.financial_year}</small></div>{form.logo_url?<img src={form.logo_url} alt="Workspace logo" onError={e=>{e.currentTarget.style.display='none'}}/>:<div className="settings-preview-mark">{(form.platform_name||'I').slice(0,1).toUpperCase()}</div>}</section>}
        {error&&<div className="settings-message error"><CircleAlert size={16}/>{error}</div>}{success&&<div className="settings-message success"><Check size={16}/>{success}</div>}
        <footer className="settings-actions"><button type="button" className="secondary-btn" disabled={!dirty||saving} onClick={reset}><RotateCcw size={15}/>Discard changes</button><button className="primary-btn" disabled={!dirty||saving}><Save size={15}/>{saving?'Saving…':'Save settings'}</button></footer>
      </main>
    </form>
  </div>;
}

function Status({icon:Icon,label,value,tone}){return <div className="settings-status"><div className={`settings-status-icon ${tone}`}><Icon size={18}/></div><span><small>{label}</small><strong title={value}>{value}</strong><em>Current setting</em></span></div>}
