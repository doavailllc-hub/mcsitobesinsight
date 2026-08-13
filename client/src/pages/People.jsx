import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Download, Mail, MoreHorizontal, Pencil, Phone, Plus,
  Search, ShieldCheck, Trash2, UserRound, Users, X
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

const emptyForm = { name: '', position: '', primary_company_id: '', phone: '', email: '', notes: '' };
const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const tones = ['violet', 'blue', 'green', 'orange', 'rose'];

export default function People() {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('all');
  const [view, setView] = useState('grid');
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getUser();
  const permissions = new Set(getPermissions());
  const canManage = user?.role === 'group_admin' || permissions.has('people.manage');

  const load = async () => {
    setLoading(true);
    const [peopleResult, companiesResult] = await Promise.all([
      api.get('/people').catch(() => ({ data: [] })),
      api.get('/company-options').catch(() => ({ data: [] }))
    ]);
    setRows(peopleResult.data || []); setCompanies(companiesResult.data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(person => {
    const matchesCompany = company === 'all' || String(person.company_id) === company;
    const matchesQuery = !query || [person.name, person.position, person.company_name, person.phone, person.email].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesCompany && matchesQuery;
  }), [rows, company, query]);

  const roles = new Set(rows.map(row => row.position).filter(Boolean)).size;
  const represented = new Set(rows.map(row => row.company_id).filter(Boolean)).size;

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setError(''); setFormOpen(true); };
  const openProfile = async person => {
    try { setSelected((await api.get(`/people/${person.id}`)).data); }
    catch { setSelected(person); }
  };
  const openEdit = async person => {
    setError('');
    try {
      const detail = (await api.get(`/people/${person.id}`)).data;
      setForm({ ...emptyForm, ...detail, primary_company_id: detail.primary_company_id || '' }); setEditingId(person.id); setSelected(null); setFormOpen(true);
    } catch (err) { window.alert(err.response?.data?.message || 'Unable to load this person.'); }
  };
  const save = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (editingId) await api.put(`/people/${editingId}`, form); else await api.post('/people', form);
      setFormOpen(false); setEditingId(null); await load();
    } catch (err) { setError(err.response?.data?.message || err.response?.data?.detail || 'Unable to save this person.'); }
    finally { setSaving(false); }
  };
  const remove = async person => {
    if (!window.confirm(`Delete ${person.name}? This action cannot be undone.`)) return;
    try { await api.delete(`/people/${person.id}`); setSelected(null); await load(); }
    catch (err) { window.alert(err.response?.data?.message || 'Unable to delete this person.'); }
  };
  const exportCsv = () => {
    const headers = ['Name', 'Position', 'Company', 'Phone', 'Email'];
    const cells = value => `"${String(value || '').replaceAll('"', '""')}"`;
    const csv = [headers.map(cells), ...filtered.map(p => [p.name, p.position, p.company_name, p.phone, p.email].map(cells))].map(row => row.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'key-people.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="page people-page">
    <header className="people-hero">
      <div className="people-hero-icon"><Users size={24} /></div>
      <div><p className="eyebrow">ORGANIZATION</p><h1>Key People</h1><p>Shareholders, directors, partners and leadership across your group.</p></div>
      {canManage ? <button className="people-add-btn" onClick={openCreate}><Plus size={17} /> Add person</button> : <span className="people-readonly"><ShieldCheck size={15} /> Read-only access</span>}
    </header>

    <section className="people-stats">
      <Stat icon={Users} label="People" value={rows.length} note="Across the group" tone="violet" />
      <Stat icon={Building2} label="Companies represented" value={represented} note="With key contacts" tone="blue" />
      <Stat icon={UserRound} label="Leadership roles" value={roles} note="Unique positions" tone="green" />
    </section>

    <div className="people-toolbar">
      <div className="people-search"><Search size={16} /><input placeholder="Search people, roles or contact details" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select value={company} onChange={e => setCompany(e.target.value)}><option value="all">All companies</option>{companies.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <div className="people-view-toggle"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Cards</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button></div>
      <button className="people-export" onClick={exportCsv}><Download size={15} /> Export</button>
    </div>

    {loading ? <div className="people-loading">{[1,2,3,4,5,6].map(i => <div key={i} />)}</div> : view === 'grid' ? (
      <section className="people-grid">{filtered.map((person, index) => <article className="person-card" key={person.id} onClick={() => openProfile(person)}>
        <div className="person-card-top"><div className={`person-avatar ${tones[index % tones.length]}`}>{initials(person.name)}</div>{canManage && <button title="Edit person" onClick={e => { e.stopPropagation(); openEdit(person); }}><Pencil size={15} /></button>}</div>
        <h3>{person.name}</h3><span className="person-role">{person.position}</span>
        <div className="person-company"><Building2 size={13} /> {person.company_name || 'Group'}</div>
        <div className="person-contact">{person.email ? <span><Mail size={13} /> {person.email}</span> : <span className="muted-contact"><Mail size={13} /> No email added</span>}{person.phone ? <span><Phone size={13} /> {person.phone}</span> : <span className="muted-contact"><Phone size={13} /> No phone added</span>}</div>
        <div className="person-card-footer"><span>View profile</span><MoreHorizontal size={17} /></div>
      </article>)}{!filtered.length && <PeopleEmpty />}</section>
    ) : <section className="people-list-card"><div className="table-scroll"><table className="people-table"><thead><tr><th>Person</th><th>Role</th><th>Primary company</th><th>Phone</th><th>Email</th><th></th></tr></thead><tbody>{filtered.map((person, index) => <tr key={person.id} onClick={() => openProfile(person)}><td><span className={`person-avatar small ${tones[index % tones.length]}`}>{initials(person.name)}</span><strong>{person.name}</strong></td><td>{person.position}</td><td>{person.company_name}</td><td>{person.phone || '—'}</td><td>{person.email || '—'}</td><td>{canManage && <button onClick={e => { e.stopPropagation(); openEdit(person); }}><Pencil size={14} /></button>}</td></tr>)}</tbody></table></div>{!filtered.length && <PeopleEmpty />}</section>}

    {selected && <div className="people-drawer-backdrop" onMouseDown={e => e.target === e.currentTarget && setSelected(null)}><aside className="people-drawer">
      <div className="people-drawer-head"><span>Person profile</span><button onClick={() => setSelected(null)}><X size={18} /></button></div>
      <div className="profile-identity"><div className="person-avatar violet large">{initials(selected.name)}</div><h2>{selected.name}</h2><p>{selected.position}</p><span><Building2 size={13} /> {companies.find(c => Number(c.id) === Number(selected.primary_company_id))?.name || selected.company_name || 'Group'}</span></div>
      <div className="profile-section"><h3>Contact information</h3><ProfileRow icon={Mail} label="Email" value={selected.email} href={selected.email ? `mailto:${selected.email}` : null} /><ProfileRow icon={Phone} label="Phone" value={selected.phone} href={selected.phone ? `tel:${selected.phone}` : null} /></div>
      <div className="profile-section"><h3>Internal notes</h3><p className="profile-notes">{selected.notes || 'No notes have been added for this person.'}</p></div>
      {canManage && <div className="profile-actions"><button className="secondary-btn danger-action" onClick={() => remove(selected)}><Trash2 size={15} /> Delete</button><button className="primary-btn" onClick={() => openEdit(selected)}><Pencil size={15} /> Edit profile</button></div>}
    </aside></div>}

    {formOpen && <div className="people-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !saving && setFormOpen(false)}><form className="people-modal" onSubmit={save}>
      <div className="people-modal-head"><div><p className="eyebrow">KEY PEOPLE</p><h2>{editingId ? 'Edit person' : 'Add key person'}</h2><span>Maintain leadership and stakeholder contact details.</span></div><button type="button" onClick={() => setFormOpen(false)}><X size={18} /></button></div>
      {error && <div className="people-form-error">{error}</div>}
      <div className="people-form-grid">
        <Field label="Full name" required><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full legal name" /></Field>
        <Field label="Position / role" required><input required value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="Director, Partner, Shareholder…" /></Field>
        <Field label="Primary company" required><select required value={form.primary_company_id} onChange={e => setForm({ ...form, primary_company_id: e.target.value })}><option value="">Select company</option>{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Phone number"><input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91…" /></Field>
        <Field label="Email address" full><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></Field>
        <Field label="Internal notes" full><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Responsibilities, relationship context or other notes" /></Field>
      </div>
      <div className="people-modal-footer"><button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update person' : 'Add person'}</button></div>
    </form></div>}
  </div>;
}

function Stat({ icon: Icon, label, value, note, tone }) { return <div className="people-stat"><div className={`people-stat-icon ${tone}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function Field({ label, required, full, children }) { return <label className={`people-field ${full ? 'full' : ''}`}><span>{label}{required ? ' *' : ''}</span>{children}</label>; }
function ProfileRow({ icon: Icon, label, value, href }) { const content = <><div><Icon size={15} /></div><span><small>{label}</small><strong>{value || 'Not provided'}</strong></span></>; return href ? <a className="profile-row" href={href}>{content}</a> : <div className="profile-row muted-row">{content}</div>; }
function PeopleEmpty() { return <div className="people-empty"><Users size={24} /><strong>No people found</strong><span>Try changing your search or company filter.</span></div>; }
