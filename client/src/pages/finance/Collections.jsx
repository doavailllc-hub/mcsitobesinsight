import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BadgeIndianRupee, BookOpenText, CalendarClock, CheckCircle2, CreditCard, Eye, FileUp, MapPin, Phone, Plus, Printer, Search, Trash2, UserRound, Users, X } from 'lucide-react';
import { api } from '../../lib/api';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const emptyForm = { company_id: '', customer_name: '', phone: '', address: '', id_card_number: '', principal_amount: '', interest_rate: '', interest_type: 'percentage', money_given_date: today(), notes: '' };

export default function Collections({ frontdesk = false, standalone = false, defaultFilter = 'active', showStats = true, defaultCompanyId = null }) {
  const [companies, setCompanies] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(defaultFilter);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [idCard, setIdCard] = useState(null);
  const [payments, setPayments] = useState([]);
  const [principalTransactions, setPrincipalTransactions] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [companyResult, customerResult, summaryResult] = await Promise.all([
      api.get('/collections/companies'), api.get('/collections/customers'), api.get('/collections/summary')
    ]);
    setCompanies(companyResult.data || []);
    setRows(customerResult.data || []);
    setSummary(summaryResult.data || {});
    if (!form.company_id && companyResult.data?.[0]) {
      const preferred = companyResult.data.find(company => Number(company.id) === Number(defaultCompanyId)) || companyResult.data[0];
      setForm(current => ({ ...current, company_id: String(preferred.id) }));
    }
  };

  useEffect(() => { load().catch(err => setError(err.response?.data?.message || 'Unable to load collections.')); }, []);

  const filtered = useMemo(() => rows.filter(row => {
    const matchesStatus = filter === 'all' || (filter === 'pending' ? row.approval_status === 'pending' : filter === 'due' ? row.status === 'active' && row.approval_status === 'approved' && row.next_interest_date <= today() : row.status === filter && row.approval_status !== 'pending');
    return matchesStatus && JSON.stringify(row).toLowerCase().includes(query.toLowerCase());
  }), [rows, query, filter]);
  const selectedCompany = companies.find(company => String(company.id) === String(form.company_id));
  const calculatedInterest = form.interest_type === 'flat_amount'
    ? Number(form.interest_rate || 0)
    : Number(form.principal_amount || 0) * Number(form.interest_rate || 0) / 100;

  const createCustomer = async event => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      if (idCard) body.append('id_card', idCard);
      await api.post('/collections/customers', body);
      setModal(null); setForm({ ...emptyForm, company_id: form.company_id }); setIdCard(null); await load();
    } catch (err) { setError(err.response?.data?.message || 'Unable to add customer.'); } finally { setSaving(false); }
  };

  const openPayment = async row => {
    setModal({ type: 'payment', row, periods_count: 1, penalty_amount: 0, amount: row.monthly_interest_amount, payment_date: today(), payment_method: 'cash', reference_no: '', notes: '' });
    setPayments((await api.get(`/collections/customers/${row.id}/payments`)).data || []);
  };

  const openProfile = async row => {
    setError('');
    setModal({ type: 'profile', row, loading: true });
    try {
      const statement = (await api.get(`/collections/customers/${row.id}/statement`)).data;
      setPayments(statement.interest_payments || []);
      setPrincipalTransactions(statement.principal_transactions || []);
      setModal({ type: 'profile', row, loading: false });
    } catch (err) {
      setPayments([]);
      setPrincipalTransactions([]);
      setModal({ type: 'profile', row, loading: false });
      setError(err.response?.data?.message || 'Unable to load customer profile.');
    }
  };

  const collect = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await api.post(`/collections/customers/${modal.row.id}/payments`, modal);
      const receipt = (await api.get(`/collections/payments/${result.data.id}/receipt`)).data;
      await load(); setModal({ type: 'receipt', receipt });
    } catch (err) { setError(err.response?.data?.message || 'Unable to record payment.'); } finally { setSaving(false); }
  };

  const savePrincipal = async event => { event.preventDefault(); setSaving(true); setError(''); try { await api.post(`/collections/customers/${modal.row.id}/principal`, modal); setModal(null); await load(); } catch(err) { setError(err.response?.data?.message || 'Unable to update principal.'); } finally { setSaving(false); } };
  const openEdit = row => { setIdCard(null); setModal({type:'edit',row,customer_name:row.customer_name||'',phone:row.phone||'',address:row.address||'',id_card_number:row.id_card_number||'',notes:row.notes||''}); };
  const saveEdit = async event => { event.preventDefault(); setSaving(true); setError(''); try { const body=new FormData(); ['customer_name','phone','address','id_card_number','notes'].forEach(key=>body.append(key,modal[key]||'')); if(idCard)body.append('id_card',idCard); await api.put(`/collections/customers/${modal.row.id}`,body); setIdCard(null); setModal(null); await load(); } catch(err) { setError(err.response?.data?.message||'Unable to update customer.'); } finally { setSaving(false); } };
  const voidPayment = async event => { event.preventDefault(); setSaving(true); setError(''); try { await api.post(`/collections/payments/${modal.payment.id}/void`,{admin_password:modal.admin_password,reason:modal.reason}); setModal(null); await load(); } catch(err) { setError(err.response?.data?.message||'Unable to cancel payment.'); } finally { setSaving(false); } };

  const toggleStatus = async row => {
    await api.patch(`/collections/customers/${row.id}/status`, { status: row.status === 'active' ? 'closed' : 'active' });
    await load();
  };

  return <div className={`${frontdesk ? 'collection-frontdesk-content' : ''} ${standalone ? 'loan-standalone-page page' : ''}`}>
    {standalone&&<header className="loan-page-hero"><span><BookOpenText size={24}/></span><div><p className="eyebrow">LENDING OPERATIONS</p><h1>Loans</h1><p>Register borrowers, review approvals, monitor principal and manage monthly interest collections.</p></div></header>}
    {showStats && <section className="collection-stats">
      <Stat icon={Users} label="Active customers" value={summary.active_customers || 0} />
      <Stat icon={BadgeIndianRupee} label="Principal given" value={money(summary.principal_outstanding)} />
      <Stat icon={CalendarClock} label="Monthly interest" value={money(summary.monthly_interest)} />
      <Stat icon={AlertCircle} label="Due / overdue" value={summary.due_now || 0} warning={Number(summary.due_now) > 0} />
      <Stat icon={CheckCircle2} label="Collected this month" value={money(summary.collected_this_month)} />
    </section>}

    {error && <div className="finance-error">{error}</div>}
    <div className="finance-page-toolbar collection-toolbar">
      <div className="finance-page-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer, phone or ID card" /></div>
      <div className="finance-page-actions">
        <select className="finance-status-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active</option><option value="pending">Pending approval</option><option value="due">Due now</option><option value="closed">Closed</option><option value="all">All</option></select>
        <button className="primary-btn" onClick={() => { setError(''); setModal({ type: 'customer' }); }}><Plus size={16}/>New loan</button>
      </div>
    </div>

    <section className="finance-list-card"><div className="finance-table-scroll"><table className="finance-table collection-table"><thead><tr><th>Customer</th><th>ID card</th><th>Principal</th><th>Monthly interest</th><th>Interest date</th><th>Status</th><th>Collected</th><th></th></tr></thead>
      <tbody>{filtered.map(row => { const pending=row.approval_status==='pending',rejected=row.approval_status==='rejected',due = !pending&&!rejected&&row.status === 'active' && row.next_interest_date <= today(); return <tr key={row.id}><td><button className="collection-customer-link" onClick={() => openProfile(row)}><strong>{row.customer_name}</strong><small>{row.phone || row.company_name}</small></button></td><td>{row.id_card_number}{row.id_card_url && <a href={row.id_card_url} target="_blank" rel="noreferrer"><Eye size={13}/> View</a>}</td><td>{money(row.principal_amount,row.currency)}</td><td className="finance-money">{money(row.monthly_interest_amount,row.currency)}<small>{row.interest_type === 'percentage' ? `${row.interest_rate}%` : 'Flat'}</small></td><td><strong className={due ? 'collection-due-text' : ''}>{row.next_interest_date}</strong>{due && <small>{Number(row.days_overdue) > 0 ? `${row.days_overdue} days overdue` : 'Due today'}</small>}</td><td><span className={`finance-badge ${rejected||due?'rejected':row.status==='closed'||row.approval_status==='approved'?'approved':'pending'}`}>{pending?'Awaiting approval':rejected?'Rejected':row.status==='closed'?'Closed':due?'Payment due':'Approved'}</span>{rejected&&<small>{row.rejection_reason}</small>}</td><td>{money(row.total_interest_collected,row.currency)}</td><td><div className="finance-actions"><button className="secondary-btn" onClick={() => openProfile(row)}>Profile</button>{row.status === 'active'&&row.approval_status==='approved'&&<button className="primary-btn collection-pay-btn" onClick={() => openPayment(row)}>Collect</button>}{row.approval_status==='approved'&&<button className="secondary-btn" onClick={() => toggleStatus(row)}>{row.status === 'active' ? 'Close' : 'Reopen'}</button>}</div></td></tr>; })}{!filtered.length && <tr><td colSpan="8" className="collection-empty">No loans found.</td></tr>}</tbody>
    </table></div></section>

    {modal?.type === 'customer' && <Modal title="Register new loan" subtitle="Enter the borrower, identity, principal and monthly interest agreement." close={() => setModal(null)} wide><form className="collection-customer-form" onSubmit={createCustomer}>
      <FormSection title="Customer details" note="Basic contact and company information"><div className="collection-form-grid">
        <Field label="Company" required><select value={form.company_id} onChange={e => setForm({...form,company_id:e.target.value})} required>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Customer name" required><input value={form.customer_name} onChange={e => setForm({...form,customer_name:e.target.value})} placeholder="Enter full name" required /></Field>
        <Field label="Phone number"><input value={form.phone} onChange={e => setForm({...form,phone:e.target.value})} placeholder="Enter contact number"/></Field>
        <Field label="Address"><textarea className="collection-compact-textarea" value={form.address} onChange={e => setForm({...form,address:e.target.value})} placeholder="Customer address"/></Field>
      </div></FormSection>
      <FormSection title="Identity verification" note="Record the ID number and attach a readable copy"><div className="collection-form-grid collection-identity-grid">
        <Field label="ID card number" required><input value={form.id_card_number} onChange={e => setForm({...form,id_card_number:e.target.value})} placeholder="Enter ID card number" required /></Field>
        <Field label="ID card document"><label className={`collection-file-drop ${idCard ? 'selected' : ''}`}><input type="file" accept="image/*,.pdf" onChange={e => setIdCard(e.target.files?.[0] || null)}/><span className="collection-file-icon"><FileUp size={20}/></span><span><strong>{idCard ? idCard.name : 'Upload ID card'}</strong><small>{idCard ? `${(idCard.size/1024).toFixed(0)} KB · Click to replace` : 'Drag and drop or browse · JPG, PNG or PDF'}</small></span>{idCard && <button type="button" onClick={event => { event.preventDefault(); setIdCard(null); }} title="Remove file"><Trash2 size={15}/></button>}</label></Field>
      </div></FormSection>
      <FormSection title="Loan and monthly interest" note="The money-given date is used as the recurring monthly due date"><div className="collection-form-grid">
        <Field label="Principal cash given" required><input type="number" min="0.01" step="0.01" value={form.principal_amount} onChange={e => setForm({...form,principal_amount:e.target.value})} placeholder="0.00" required /></Field>
        <Field label="Money given / first interest date" required><input type="date" value={form.money_given_date} onChange={e => setForm({...form,money_given_date:e.target.value})} required /></Field>
        <Field label="Interest method"><select value={form.interest_type} onChange={e => setForm({...form,interest_type:e.target.value})}><option value="percentage">Percentage per month</option><option value="flat_amount">Flat amount per month</option></select></Field>
        <Field label={form.interest_type === 'percentage' ? 'Monthly interest %' : 'Monthly interest amount'} required><input type="number" min="0.01" step="0.01" value={form.interest_rate} onChange={e => setForm({...form,interest_rate:e.target.value})} placeholder={form.interest_type === 'percentage' ? 'Example: 2.5' : '0.00'} required /></Field>
      </div><div className="collection-interest-preview"><div><span>Calculated monthly interest</span><strong>{money(calculatedInterest,selectedCompany?.currency)}</strong></div><div><span>Collection frequency</span><strong>Every month</strong></div><div><span>First interest date</span><strong>{form.money_given_date || 'Not selected'}</strong></div></div></FormSection>
      <FormSection title="Additional information" note="Optional internal notes for this account"><div className="collection-form-grid one"><Field label="Notes"><textarea className="collection-compact-textarea" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} placeholder="Add any useful customer or agreement notes"/></Field></div></FormSection>
      <Footer saving={saving} cancel={() => setModal(null)} text={frontdesk?'Submit for approval':'Create approved loan'}/>
    </form></Modal>}

    {modal?.type === 'payment' && <Modal title={`Collect from ${modal.row.customer_name}`} subtitle={`Interest due for ${modal.row.next_interest_date}`} close={() => setModal(null)}><form onSubmit={collect}><div className="collection-payment-summary"><span>Expected monthly interest</span><strong>{money(modal.row.monthly_interest_amount,modal.row.currency)}</strong></div><div className="finance-transaction-form-grid">
      <Field label="Months being settled"><select value={modal.periods_count} onChange={e => { const periods=Number(e.target.value); setModal({...modal,periods_count:periods,amount:Number(modal.row.monthly_interest_amount)*periods+Number(modal.penalty_amount||0)}); }}>{[1,2,3,4,5,6,12].map(value=><option key={value} value={value}>{value} month{value>1?'s':''}</option>)}</select></Field>
      <Field label="Penalty / late fee"><input type="number" min="0" step="0.01" value={modal.penalty_amount} onChange={e => { const penalty=Number(e.target.value||0); setModal({...modal,penalty_amount:e.target.value,amount:Number(modal.row.monthly_interest_amount)*Number(modal.periods_count)+penalty}); }}/></Field>
      <Field label="Amount collected" required><input type="number" min="0.01" step="0.01" value={modal.amount} onChange={e => setModal({...modal,amount:e.target.value})} required /></Field>
      <Field label="Payment date" required><input type="date" value={modal.payment_date} onChange={e => setModal({...modal,payment_date:e.target.value})} required /></Field>
      <Field label="Payment method"><select value={modal.payment_method} onChange={e => setModal({...modal,payment_method:e.target.value})}><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="other">Other</option></select></Field>
      <Field label="Reference number"><input value={modal.reference_no} onChange={e => setModal({...modal,reference_no:e.target.value})}/></Field>
      <Field label="Notes" full><textarea value={modal.notes} onChange={e => setModal({...modal,notes:e.target.value})}/></Field>
    </div>{payments.length > 0 && <div className="collection-history"><strong>Recent payments</strong>{payments.slice(0,4).map(p => <div key={p.id}><span>{p.payment_date} · {p.payment_method}</span><b>{money(p.amount,modal.row.currency)}</b></div>)}</div>}<Footer saving={saving} cancel={() => setModal(null)} text="Confirm collection"/></form></Modal>}

    {modal?.type === 'principal' && <Modal title="Update principal balance" subtitle={modal.row.customer_name} close={()=>setModal(null)}><form onSubmit={savePrincipal}><div className="collection-payment-summary"><span>Current principal</span><strong>{money(modal.row.principal_amount,modal.row.currency)}</strong></div><div className="finance-transaction-form-grid"><Field label="Transaction type"><select value={modal.transaction_type} onChange={e=>setModal({...modal,transaction_type:e.target.value})}><option value="principal_repayment">Principal repayment</option><option value="additional_loan">Additional loan</option></select></Field><Field label="Amount" required><input type="number" min="0.01" step="0.01" value={modal.amount} onChange={e=>setModal({...modal,amount:e.target.value})} required/></Field><Field label="Date" required><input type="date" value={modal.transaction_date} onChange={e=>setModal({...modal,transaction_date:e.target.value})} required/></Field><Field label="Payment method"><select value={modal.payment_method} onChange={e=>setModal({...modal,payment_method:e.target.value})}><option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option></select></Field><Field label="Reference"><input value={modal.reference_no} onChange={e=>setModal({...modal,reference_no:e.target.value})}/></Field><Field label="Notes"><input value={modal.notes} onChange={e=>setModal({...modal,notes:e.target.value})}/></Field></div><Footer saving={saving} cancel={()=>setModal(null)} text="Save principal transaction"/></form></Modal>}

    {modal?.type === 'receipt' && <ReceiptModal receipt={modal.receipt} close={()=>setModal(null)}/>} 
    {modal?.type === 'statement' && <StatementModal row={modal.row} payments={modal.payments} principalTransactions={modal.principalTransactions} close={()=>setModal(null)}/>} 
    {modal?.type === 'void-payment' && <div className="finance-modal-backdrop"><div className="fd-admin-confirm"><p className="eyebrow">ADMIN APPROVAL</p><h2>Cancel interest payment</h2><p>The receipt remains in history as voided and the customer’s interest due date is reversed.</p><form onSubmit={voidPayment}><label>Cancellation reason<input value={modal.reason} onChange={e=>setModal({...modal,reason:e.target.value})} required/></label><label>Group Admin password<input autoFocus type="password" value={modal.admin_password} onChange={e=>setModal({...modal,admin_password:e.target.value})} required/></label>{error&&<div className="finance-error">{error}</div>}<footer><button type="button" className="secondary-btn" onClick={()=>setModal(null)}>Back</button><button className="primary-btn" disabled={saving}>{saving?'Verifying…':'Cancel payment'}</button></footer></form></div></div>}

    {modal?.type === 'edit' && <Modal title="Edit customer profile" subtitle="Update contact details, identity information or replace the ID document." close={()=>setModal(null)} wide><form className="collection-customer-form" onSubmit={saveEdit}><FormSection title="Customer details" note="Changes apply to this customer account"><div className="collection-form-grid"><Field label="Customer name" required><input value={modal.customer_name} onChange={e=>setModal({...modal,customer_name:e.target.value})} required/></Field><Field label="Phone number"><input value={modal.phone} onChange={e=>setModal({...modal,phone:e.target.value})}/></Field><Field label="Address" full><textarea className="collection-compact-textarea" value={modal.address} onChange={e=>setModal({...modal,address:e.target.value})}/></Field></div></FormSection><FormSection title="Identity verification" note="Leave the upload unchanged to retain the current document"><div className="collection-form-grid collection-identity-grid"><Field label="ID card number" required><input value={modal.id_card_number} onChange={e=>setModal({...modal,id_card_number:e.target.value})} required/></Field><Field label="Replace ID card document"><label className={`collection-file-drop ${idCard?'selected':''}`}><input type="file" accept="image/*,.pdf" onChange={e=>setIdCard(e.target.files?.[0]||null)}/><span className="collection-file-icon"><FileUp size={20}/></span><span><strong>{idCard?idCard.name:(modal.row.id_card_original_name||'Choose replacement document')}</strong><small>{idCard?`${(idCard.size/1024).toFixed(0)} KB · Ready to replace`:'JPG, PNG or PDF · Existing file is preserved'}</small></span>{idCard&&<button type="button" onClick={event=>{event.preventDefault();setIdCard(null);}}><Trash2 size={15}/></button>}</label></Field></div></FormSection><FormSection title="Internal notes" note="Optional account information"><div className="collection-form-grid one"><Field label="Notes"><textarea className="collection-compact-textarea" value={modal.notes} onChange={e=>setModal({...modal,notes:e.target.value})}/></Field></div></FormSection><Footer saving={saving} cancel={()=>setModal(null)} text="Save customer changes"/></form></Modal>}

    {modal?.type === 'profile' && <ProfileModal row={modal.row} payments={payments} principalTransactions={principalTransactions} loading={modal.loading} close={() => setModal(null)} edit={()=>openEdit(modal.row)} collect={() => openPayment(modal.row)} principal={()=>setModal({type:'principal',row:modal.row,transaction_type:'principal_repayment',amount:'',transaction_date:today(),payment_method:'cash',reference_no:'',notes:''})} statement={()=>setModal({type:'statement',row:modal.row,payments,principalTransactions})} printReceipt={async id=>setModal({type:'receipt',receipt:(await api.get(`/collections/payments/${id}/receipt`)).data})} cancelPayment={payment=>setModal({type:'void-payment',payment,admin_password:'',reason:''})} toggleStatus={async () => { await toggleStatus(modal.row); setModal(null); }} />}
  </div>;
}

function Stat({ icon: Icon, label, value, warning }) { return <div className={`finance-stat collection-stat ${warning ? 'warning' : ''}`}><div className="finance-stat-icon"><Icon size={17}/></div><span>{label}</span><strong>{value}</strong></div>; }
function Field({ label, children, required, full }) { return <label className={`finance-transaction-field ${full ? 'finance-transaction-field-full' : ''}`}><span className="finance-transaction-label">{label}{required && <em>*</em>}</span>{children}</label>; }
function Modal({ title, subtitle, close, children, wide = false }) { return <div className="finance-modal-backdrop"><div className={`finance-transaction-modal ${wide ? 'collection-profile-modal' : ''}`}><header className="finance-transaction-modal-head"><div><p className="eyebrow">COLLECTION</p><h2>{title}</h2><p>{subtitle}</p></div><button className="finance-modal-close" onClick={close}><X size={18}/></button></header>{children}</div></div>; }
function Footer({ saving, cancel, text }) { return <footer className="finance-transaction-modal-footer"><button type="button" className="secondary-btn" onClick={cancel}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : text}</button></footer>; }
function FormSection({ title, note, children }) { return <section className="collection-form-section"><header><strong>{title}</strong><span>{note}</span></header>{children}</section>; }

function ProfileModal({ row, payments, principalTransactions, loading, close, edit, collect, principal, statement, printReceipt, cancelPayment, toggleStatus }) {
  const due = row.status === 'active' && row.next_interest_date <= today();
  return <Modal title={row.customer_name} subtitle={`${row.company_name} · Customer profile`} close={close} wide>
    <div className="collection-profile">
      <section className="collection-profile-hero">
        <div className="collection-profile-avatar"><UserRound size={26}/></div>
        <div><span>Customer</span><strong>{row.customer_name}</strong><small>{row.status === 'active' ? 'Active collection account' : 'Closed collection account'}</small></div>
        <span className={`finance-badge ${row.status === 'closed' ? 'approved' : due ? 'rejected' : 'pending'}`}>{row.status === 'closed' ? 'Closed' : due ? 'Payment due' : 'Active'}</span>
      </section>

      <section className="collection-profile-grid">
        <ProfileItem icon={Phone} label="Phone" value={row.phone || 'Not provided'} />
        <ProfileItem icon={CreditCard} label="ID card number" value={row.id_card_number} />
        <ProfileItem icon={MapPin} label="Address" value={row.address || 'Not provided'} wide />
      </section>

      <section className="collection-profile-money">
        <div><span>Principal cash given</span><strong>{money(row.principal_amount,row.currency)}</strong><small>Given on {row.money_given_date}</small></div>
        <div><span>Monthly interest</span><strong>{money(row.monthly_interest_amount,row.currency)}</strong><small>{row.interest_type === 'percentage' ? `${row.interest_rate}% per month` : 'Flat monthly amount'}</small></div>
        <div className={due ? 'due' : ''}><span>Next interest date</span><strong>{row.next_interest_date}</strong><small>{due ? (Number(row.days_overdue) > 0 ? `${row.days_overdue} days overdue` : 'Due today') : 'Upcoming collection'}</small></div>
        <div><span>Total interest collected</span><strong>{money(row.total_interest_collected,row.currency)}</strong><small>{payments.length} payment{payments.length === 1 ? '' : 's'}</small></div>
      </section>

      <div className="collection-profile-columns">
        <section className="collection-profile-panel"><header><div><strong>ID card document</strong><span>Uploaded identity proof</span></div></header>{row.id_card_url ? (row.id_card_mime_type?.startsWith('image/') ? <a href={row.id_card_url} target="_blank" rel="noreferrer" className="collection-id-preview"><img src={row.id_card_url} alt={`${row.customer_name} ID card`}/><span><Eye size={14}/> Open full document</span></a> : <a href={row.id_card_url} target="_blank" rel="noreferrer" className="collection-document-link"><CreditCard size={22}/><div><strong>{row.id_card_original_name || 'ID card document'}</strong><span><Eye size={13}/> View document</span></div></a>) : <div className="collection-profile-empty">No ID-card file uploaded.</div>}</section>
        <section className="collection-profile-panel"><header><div><strong>Notes</strong><span>Customer and account information</span></div></header><p className="collection-profile-notes">{row.notes || 'No notes added for this customer.'}</p></section>
      </div>

      <section className="collection-profile-panel collection-payment-list"><header><div><strong>Payment history</strong><span>Posted and cancelled interest receipts</span></div><b>{money(row.total_interest_collected,row.currency)} total</b></header>{loading ? <div className="collection-profile-empty">Loading payment history…</div> : payments.length ? <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Payment date</th><th>Interest for</th><th>Method</th><th>Receipt</th><th>Status</th><th>Collected by</th><th>Amount</th><th></th></tr></thead><tbody>{payments.map(payment => {const voided=payment.status==='voided';return <tr key={payment.id} className={voided?'fd-row-voided':''}><td>{payment.payment_date}</td><td>{payment.interest_for_date}</td><td className="finance-type">{payment.payment_method}</td><td><button className="collection-receipt-link" onClick={()=>printReceipt(payment.id)}><Printer size={12}/>{payment.receipt_number||'Receipt'}</button></td><td><span className={`finance-badge ${voided?'rejected':'approved'}`}>{voided?'Voided':'Posted'}</span></td><td>{payment.collected_by_name || '—'}</td><td className="finance-money">{money(payment.amount,row.currency)}</td><td>{!voided&&<button className="fd-cancel-link" onClick={()=>cancelPayment(payment)}>Cancel</button>}</td></tr>})}</tbody></table></div> : <div className="collection-profile-empty">No interest payments collected yet.</div>}</section>
      <section className="collection-profile-panel collection-payment-list"><header><div><strong>Principal history</strong><span>Additional loans and principal repayments</span></div><b>{money(row.principal_amount,row.currency)} outstanding</b></header>{loading ? <div className="collection-profile-empty">Loading principal history…</div> : principalTransactions.length ? <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Date</th><th>Transaction</th><th>Method</th><th>Reference</th><th>Recorded by</th><th>Amount</th></tr></thead><tbody>{principalTransactions.map(item=><tr key={item.id}><td>{item.transaction_date}</td><td><span className={`finance-badge ${item.transaction_type==='principal_repayment'?'approved':'pending'}`}>{item.transaction_type==='principal_repayment'?'Principal repayment':'Additional loan'}</span></td><td className="finance-type">{item.payment_method}</td><td>{item.reference_no||'—'}</td><td>{item.created_by_name||'—'}</td><td className="finance-money">{item.transaction_type==='principal_repayment'?'-':'+'}{money(item.amount,row.currency)}</td></tr>)}</tbody></table></div> : <div className="collection-profile-empty">No principal adjustments recorded. The original cash given is {money(row.principal_amount,row.currency)}.</div>}</section>
    </div>
    <footer className="finance-transaction-modal-footer collection-profile-footer"><button className="secondary-btn" onClick={close}>Close</button><button className="secondary-btn" onClick={statement}><Printer size={14}/> Statement</button><button className="secondary-btn" onClick={edit}>Edit customer</button>{row.approval_status==='approved'&&<><button className="secondary-btn" onClick={principal}>Principal adjustment</button><button className="secondary-btn" onClick={toggleStatus}>{row.status === 'active' ? 'Close account' : 'Reopen account'}</button>{row.status === 'active' && <button className="primary-btn" onClick={collect}>Collect interest</button>}</>}</footer>
  </Modal>;
}

function ProfileItem({ icon: Icon, label, value, wide }) { return <div className={wide ? 'wide' : ''}><Icon size={16}/><span>{label}</span><strong>{value}</strong></div>; }

function StatementModal({row,payments,principalTransactions,close}) {
  const posted=payments.filter(item=>item.status!=='voided');
  const additional=principalTransactions.filter(item=>item.transaction_type==='additional_loan').reduce((sum,item)=>sum+Number(item.amount),0);
  const repaid=principalTransactions.filter(item=>item.transaction_type==='principal_repayment').reduce((sum,item)=>sum+Number(item.amount),0);
  const opening=Number(row.principal_amount)-additional+repaid;
  const interest=posted.reduce((sum,item)=>sum+Number(item.amount),0);
  const ledger=[
    {key:'opening',date:row.money_given_date,type:'Original principal given',reference:'Opening loan',debit:opening,credit:0},
    ...principalTransactions.map(item=>({key:`p-${item.id}`,date:item.transaction_date,type:item.transaction_type==='additional_loan'?'Additional principal given':'Principal repayment',reference:item.reference_no||item.payment_method,debit:item.transaction_type==='additional_loan'?Number(item.amount):0,credit:item.transaction_type==='principal_repayment'?Number(item.amount):0})),
    ...payments.map(item=>({key:`i-${item.id}`,date:item.payment_date,type:item.status==='voided'?'Interest receipt (VOID)':'Interest collected',reference:item.receipt_number||item.payment_method,debit:0,credit:item.status==='voided'?0:Number(item.amount),voided:item.status==='voided'}))
  ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.key).localeCompare(String(b.key)));
  const print=()=>{const node=document.querySelector('.collection-statement-paper');const popup=window.open('','_blank','width=1000,height=850');popup.document.write(`<html><head><title>Statement - ${row.customer_name}</title><style>body{font-family:Arial;padding:30px;color:#101828}.statement{max-width:900px;margin:auto}h1{margin-bottom:4px}.meta,.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.meta div,.summary div{border:1px solid #ddd;padding:10px}.meta span,.summary span{display:block;color:#667085;font-size:11px}.summary strong{font-size:17px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:9px}th{background:#f2f4f7}.money{text-align:right}.voided{color:#b42318;text-decoration:line-through}.foot{margin-top:22px;color:#667085;font-size:11px}@media print{body{padding:0}}</style></head><body>${node.outerHTML}</body></html>`);popup.document.close();popup.print();};
  return <Modal title="Customer account statement" subtitle={`${row.customer_name} · ${row.company_name}`} close={close} wide><div className="collection-statement-paper statement"><p className="eyebrow">{row.company_name}</p><h1>Customer Account Statement</h1><div className="meta"><div><span>Customer</span><strong>{row.customer_name}</strong></div><div><span>ID card number</span><strong>{row.id_card_number}</strong></div><div><span>Statement date</span><strong>{today()}</strong></div><div><span>Phone</span><strong>{row.phone||'—'}</strong></div><div><span>Loan started</span><strong>{row.money_given_date}</strong></div><div><span>Account status</span><strong>{row.status}</strong></div></div><div className="summary"><div><span>Original principal</span><strong>{money(opening,row.currency)}</strong></div><div><span>Additional principal</span><strong>{money(additional,row.currency)}</strong></div><div><span>Principal repaid</span><strong>{money(repaid,row.currency)}</strong></div><div><span>Principal outstanding</span><strong>{money(row.principal_amount,row.currency)}</strong></div><div><span>Interest collected</span><strong>{money(interest,row.currency)}</strong></div><div><span>Next interest date</span><strong>{row.next_interest_date}</strong></div></div><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="money">Principal given</th><th className="money">Amount received</th></tr></thead><tbody>{ledger.map(item=><tr key={item.key} className={item.voided?'voided':''}><td>{item.date}</td><td>{item.type}</td><td>{item.reference}</td><td className="money">{item.debit?money(item.debit,row.currency):'—'}</td><td className="money">{item.credit?money(item.credit,row.currency):'—'}</td></tr>)}</tbody></table><p className="foot">This statement includes the original loan, principal adjustments and all interest receipts. Voided receipts are retained for audit but excluded from totals.</p></div><footer className="finance-transaction-modal-footer"><button className="secondary-btn" onClick={close}>Close</button><button className="primary-btn" onClick={print}><Printer size={15}/>Print statement</button></footer></Modal>;
}

function ReceiptModal({receipt,close}){const print=()=>{const node=document.querySelector('.collection-receipt-paper');const popup=window.open('','_blank','width=760,height=800');popup.document.write(`<html><head><title>${receipt.receipt_number||'Collection receipt'}</title><style>body{font-family:Arial;padding:40px;color:#101828}.paper{max-width:650px;margin:auto;border:1px solid #ddd;padding:30px}h1{font-size:22px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee}.total{font-size:20px;font-weight:bold}.collection-receipt-void{border:3px solid #d92d20;color:#d92d20;font-size:30px;font-weight:900;letter-spacing:6px;text-align:center;padding:8px;transform:rotate(-4deg);margin:18px 0}.collection-receipt-void-reason{color:#b42318}</style></head><body><div class="paper">${node.innerHTML}</div></body></html>`);popup.document.close();popup.print();};const voided=receipt.status==='voided';return <Modal title="Interest collection receipt" subtitle={receipt.receipt_number||'Payment receipt'} close={close}><div className="collection-receipt-paper"><p className="eyebrow">{receipt.company_name}</p><h1>Interest Collection Receipt</h1><div className="collection-receipt-number">{receipt.receipt_number}</div>{voided&&<><div className="collection-receipt-void">VOID</div><p className="collection-receipt-void-reason"><strong>Cancellation reason:</strong> {receipt.void_reason||'Not provided'}</p></>}<div className="row"><span>Customer</span><strong>{receipt.customer_name}</strong></div><div className="row"><span>Payment date</span><strong>{receipt.payment_date}</strong></div><div className="row"><span>Interest for</span><strong>{receipt.interest_for_date} · {receipt.periods_count||1} month(s)</strong></div><div className="row"><span>Payment method</span><strong>{receipt.payment_method}</strong></div><div className="row"><span>Penalty</span><strong>{money(receipt.penalty_amount,receipt.currency)}</strong></div><div className="row total"><span>Amount received</span><strong>{money(receipt.amount,receipt.currency)}</strong></div><p>Collected by {receipt.collected_by_name||'Front Desk'}</p></div><footer className="finance-transaction-modal-footer"><button className="secondary-btn" onClick={close}>Close</button><button className="primary-btn" onClick={print}><Printer size={15}/>Print receipt</button></footer></Modal>;}
