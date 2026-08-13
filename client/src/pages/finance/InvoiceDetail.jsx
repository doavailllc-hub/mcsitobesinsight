import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Ban, Building2, CalendarDays, Check, CheckCircle2, Clipboard,
  Clock3, Download, HandCoins, Mail, MapPin, Phone, Printer, ReceiptText,
  Send, WalletCards
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getPermissions, getUser } from '../../lib/api';
import { downloadSalesInvoicePdf } from './invoicePdf';

const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2
}).format(Number(value || 0));
const formatDate = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set';
const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const user = getUser();
  const permissions = new Set(getPermissions());
  const canEdit = user?.role === 'group_admin' || permissions.has('finance.edit');

  const load = async () => {
    try { setLoading(true); setData((await api.get(`/sales-invoices/${id}`)).data); }
    catch (err) { window.alert(err.response?.data?.message || 'Unable to load invoice.'); navigate('/finance/invoices', { replace: true }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const changeStatus = async (action, question) => {
    if (!window.confirm(question)) return;
    try { await api.put(`/sales-invoices/${id}/${action}`); await load(); }
    catch (err) { window.alert(err.response?.data?.message || `Unable to ${action} invoice.`); }
  };
  const downloadPdf = async () => {
    try { await downloadSalesInvoicePdf(data); }
    catch { window.alert('Unable to create invoice PDF.'); }
  };
  const copyNumber = async () => {
    try { await navigator.clipboard.writeText(data.invoice.invoice_number); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { /* Clipboard can be unavailable on non-secure local origins. */ }
  };
  const calculated = useMemo(() => {
    const invoice = data?.invoice || {}; const paid = Number(invoice.paid_amount || 0); const total = Number(invoice.total_amount || 0);
    return { paid, progress: total ? Math.min(100, (paid / total) * 100) : 0 };
  }, [data]);

  if (loading) return <InvoiceSkeleton />;
  if (!data?.invoice) return null;
  const invoice = data.invoice;
  const isOverdue = invoice.status === 'issued' && Number(invoice.balance_amount) > 0 && invoice.due_date && new Date(invoice.due_date) < new Date(new Date().toDateString());
  const displayStatus = isOverdue ? 'overdue' : invoice.status;
  const canReceivePayment = ['issued', 'partially_paid'].includes(invoice.status);

  return <div className="invoice-workspace">
    <div className="invoice-topbar no-print">
      <div className="invoice-topbar-title">
        <Link to="/finance/invoices" className="invoice-back"><ArrowLeft size={17} /></Link>
        <div><span>Sales invoice</span><div><h2>{invoice.invoice_number}</h2><button onClick={copyNumber} title="Copy invoice number">{copied ? <Check size={14} /> : <Clipboard size={14} />}</button></div></div>
        <span className={`finance-badge ${displayStatus}`}>{titleCase(displayStatus)}</span>
      </div>
      <div className="invoice-toolbar-actions">
        <button className="secondary-btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
        <button className="secondary-btn" onClick={downloadPdf}><Download size={15} /> PDF</button>
        {canEdit && invoice.status === 'draft' && <button className="primary-btn" onClick={() => changeStatus('issue', `Issue invoice ${invoice.invoice_number}?`)}><Send size={15} /> Issue invoice</button>}
        {canReceivePayment && <Link to={`/finance/payments?invoice=${invoice.id}`} className="primary-btn"><HandCoins size={15} /> Record payment</Link>}
      </div>
    </div>

    <div className="invoice-layout">
      <main className="invoice-paper">
        <header className="invoice-paper-head">
          <div className="invoice-brand-block"><div className="invoice-brand-mark"><Building2 size={23} /></div><div><strong>{invoice.company_name}</strong><span>Finance & Accounts</span></div></div>
          <div className="invoice-title-block"><span>INVOICE</span><strong>{invoice.invoice_number}</strong></div>
        </header>
        <section className="invoice-info-band">
          <div className="invoice-client"><span className="invoice-label">BILL TO</span><h3>{invoice.customer_name}</h3>
            {invoice.customer_address && <p><MapPin size={13} /> {invoice.customer_address}</p>}
            {invoice.customer_email && <p><Mail size={13} /> {invoice.customer_email}</p>}
            {invoice.customer_phone && <p><Phone size={13} /> {invoice.customer_phone}</p>}
          </div>
          <dl className="invoice-meta-list"><div><dt>Invoice date</dt><dd>{formatDate(invoice.invoice_date)}</dd></div><div><dt>Payment due</dt><dd className={isOverdue ? 'overdue-text' : ''}>{formatDate(invoice.due_date)}</dd></div><div><dt>Currency</dt><dd>{invoice.currency || 'INR'}</dd></div></dl>
        </section>
        <div className="invoice-lines-wrap"><table className="invoice-lines-table"><thead><tr><th>#</th><th>Item & description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody>{(data.items || []).map((item, index) => <tr key={item.id || index}><td>{String(index + 1).padStart(2, '0')}</td><td><strong>{item.item_name}</strong>{item.description && <span>{item.description}</span>}</td><td>{Number(item.quantity || 0).toLocaleString('en-IN')}</td><td>{money(item.unit_price, invoice.currency)}</td><td>{Number(item.tax_rate || 0)}%</td><td>{money(item.line_total, invoice.currency)}</td></tr>)}</tbody></table></div>
        <section className="invoice-closing">
          <div className="invoice-notes">{invoice.notes && <div><span className="invoice-label">NOTES</span><p>{invoice.notes}</p></div>}{invoice.terms && <div><span className="invoice-label">TERMS & CONDITIONS</span><p>{invoice.terms}</p></div>}</div>
          <div className="invoice-totals"><div><span>Subtotal</span><strong>{money(invoice.subtotal, invoice.currency)}</strong></div><div><span>Tax</span><strong>{money(invoice.tax_amount, invoice.currency)}</strong></div>{Number(invoice.discount_amount) > 0 && <div><span>Discount</span><strong>− {money(invoice.discount_amount, invoice.currency)}</strong></div>}<div className="invoice-grand-total"><span>Total</span><strong>{money(invoice.total_amount, invoice.currency)}</strong></div>{Number(invoice.paid_amount) > 0 && <div className="invoice-paid-row"><span>Amount paid</span><strong>− {money(invoice.paid_amount, invoice.currency)}</strong></div>}<div className="invoice-balance-row"><span>Balance due</span><strong>{money(invoice.balance_amount, invoice.currency)}</strong></div></div>
        </section>
        <footer className="invoice-paper-footer"><span>Thank you for your business.</span><span>Generated through Insight MCSITOBES</span></footer>
      </main>

      <aside className="invoice-side no-print">
        <section className="invoice-side-card invoice-payment-card"><div className="side-card-icon"><WalletCards size={19} /></div><span>Balance due</span><strong>{money(invoice.balance_amount, invoice.currency)}</strong><div className="payment-progress"><i style={{ width: `${calculated.progress}%` }} /></div><div className="payment-progress-copy"><span>{Math.round(calculated.progress)}% paid</span><span>{money(calculated.paid, invoice.currency)} received</span></div>{canReceivePayment && <Link to={`/finance/payments?invoice=${invoice.id}`} className="invoice-side-action"><HandCoins size={15} /> Record a payment</Link>}{invoice.status === 'paid' && <div className="invoice-paid-message"><CheckCircle2 size={16} /> Paid in full</div>}</section>
        <section className="invoice-side-card"><div className="invoice-side-heading"><div><ReceiptText size={17} /><strong>Invoice activity</strong></div><span>{titleCase(displayStatus)}</span></div><div className="invoice-activity"><Activity icon={CalendarDays} title="Invoice created" detail={formatDate(invoice.invoice_date)} done /><Activity icon={Send} title="Invoice issued" detail={invoice.status === 'draft' ? 'Waiting to be issued' : 'Sent to customer'} done={invoice.status !== 'draft'} /><Activity icon={invoice.status === 'paid' ? CheckCircle2 : Clock3} title={invoice.status === 'paid' ? 'Payment complete' : 'Payment due'} detail={formatDate(invoice.due_date)} done={invoice.status === 'paid'} danger={isOverdue} /></div></section>
        {canEdit && Number(invoice.paid_amount || 0) === 0 && !['paid', 'cancelled'].includes(invoice.status) && <button className="invoice-cancel-btn" onClick={() => changeStatus('cancel', `Cancel invoice ${invoice.invoice_number}? This action will mark it as cancelled.`)}><Ban size={15} /> Cancel invoice</button>}
      </aside>
    </div>

    <section className="invoice-payments-section no-print">
      <div className="invoice-section-head"><div><span className="section-kicker">PAYMENT HISTORY</span><h2>Payments received</h2><p>All payments recorded against this invoice.</p></div><span>{data.payments?.length || 0} records</span></div>
      {data.payments?.length ? <div className="invoice-payments-list">{data.payments.map(payment => <div className="invoice-payment-row" key={payment.id}><div className="payment-method-icon"><HandCoins size={17} /></div><div><strong>{titleCase(payment.payment_method)}</strong><span>{formatDate(payment.payment_date)} · {payment.received_by_name || 'Finance team'}</span></div><div><span>Reference</span><strong>{payment.reference_number || '—'}</strong></div><b>{money(payment.amount, payment.currency || invoice.currency)}</b></div>)}</div> : <div className="invoice-payments-empty"><div><HandCoins size={22} /></div><strong>No payments recorded yet</strong><span>Payments added to this invoice will appear here.</span></div>}
    </section>
  </div>;
}

function Activity({ icon: Icon, title, detail, done, danger }) { return <div className={`activity-item ${done ? 'done' : ''} ${danger ? 'danger' : ''}`}><div><Icon size={14} /></div><span><strong>{title}</strong><small>{detail}</small></span></div>; }
function InvoiceSkeleton() { return <div className="invoice-loading"><div /><div className="invoice-loading-grid"><div /><div /></div></div>; }
