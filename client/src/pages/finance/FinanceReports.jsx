import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Building2, CalendarRange,
  Download, FileSpreadsheet, FileText, HandCoins, PieChart, ReceiptText,
  RefreshCw, Search, WalletCards
} from 'lucide-react';
import { api } from '../../lib/api';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const currencyMoney = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const today = new Date().toISOString().slice(0, 10);
const yearStart = `${new Date().getFullYear()}-01-01`;

const reportTabs = [
  ['summary', 'Summary', PieChart], ['company', 'Company-wise', Building2],
  ['invoices', 'Invoice register', FileText], ['aging', 'Receivables aging', WalletCards],
  ['payments', 'Collections', HandCoins], ['transactions', 'Transactions', ReceiptText]
];

export default function FinanceReports() {
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState('summary');
  const [filters, setFilters] = useState({ company: 'all', from: yearStart, to: today, query: '' });

  const load = async () => {
    setLoading(true);
    const [tx, inv, pay, cos] = await Promise.all([
      api.get('/finance').catch(() => ({ data: [] })), api.get('/sales-invoices').catch(() => ({ data: [] })),
      api.get('/customer-payments').catch(() => ({ data: [] })), api.get('/company-options').catch(() => ({ data: [] }))
    ]);
    setTransactions(tx.data || []); setInvoices(inv.data || []); setPayments(pay.data || []); setCompanies(cos.data || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const inRange = date => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  const match = row => filters.company === 'all' || String(row.company_id) === filters.company;
  const search = row => !filters.query || JSON.stringify(row).toLowerCase().includes(filters.query.toLowerCase());
  const tx = useMemo(() => transactions.filter(row => match(row) && inRange(String(row.date || '').slice(0, 10)) && search(row)), [transactions, filters]);
  const inv = useMemo(() => invoices.filter(row => match(row) && inRange(String(row.invoice_date || '').slice(0, 10)) && search(row)), [invoices, filters]);
  const pay = useMemo(() => payments.filter(row => match(row) && inRange(String(row.payment_date || '').slice(0, 10)) && search(row)), [payments, filters]);

  const metrics = useMemo(() => {
    const approved = tx.filter(row => (row.approval_status || 'approved') === 'approved');
    const income = approved.filter(row => row.type === 'income').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expense = approved.filter(row => row.type === 'expense').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const billed = inv.filter(row => row.status !== 'cancelled').reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const outstanding = inv.filter(row => row.status !== 'cancelled').reduce((sum, row) => sum + Number(row.balance_amount || 0), 0);
    const collected = pay.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const overdue = inv.filter(row => row.display_status === 'overdue').reduce((sum, row) => sum + Number(row.balance_amount || 0), 0);
    return { income, expense, net: income - expense, billed, outstanding, collected, overdue };
  }, [tx, inv, pay]);

  const companyReport = useMemo(() => {
    const map = {};
    const ensure = (id, name) => map[id] ||= { id, name: name || 'Company', income: 0, expense: 0, invoiced: 0, collected: 0, outstanding: 0, invoices: 0 };
    companies.forEach(c => ensure(String(c.id), c.name));
    tx.filter(r => (r.approval_status || 'approved') === 'approved').forEach(r => { const c = ensure(String(r.company_id), r.company_name); c[r.type === 'income' ? 'income' : 'expense'] += Number(r.amount || 0); });
    inv.filter(r => r.status !== 'cancelled').forEach(r => { const c = ensure(String(r.company_id), r.company_name); c.invoiced += Number(r.total_amount || 0); c.outstanding += Number(r.balance_amount || 0); c.invoices += 1; });
    pay.forEach(r => { ensure(String(r.company_id), r.company_name).collected += Number(r.amount || 0); });
    return Object.values(map).filter(c => filters.company === 'all' || c.id === filters.company).map(c => ({ ...c, net: c.income - c.expense }));
  }, [tx, inv, pay, companies, filters.company]);

  const monthly = useMemo(() => {
    const map = {};
    tx.filter(r => (r.approval_status || 'approved') === 'approved').forEach(r => { const key = String(r.date || '').slice(0, 7); map[key] ||= { month: key, income: 0, expense: 0 }; map[key][r.type === 'income' ? 'income' : 'expense'] += Number(r.amount || 0); });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [tx]);

  const aging = useMemo(() => inv.filter(r => Number(r.balance_amount) > 0 && r.status !== 'cancelled').map(r => {
    const days = r.due_date ? Math.floor((new Date(today) - new Date(r.due_date)) / 86400000) : 0;
    const bucket = days <= 0 ? 'Current' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '90+ days';
    return { ...r, overdueDays: Math.max(0, days), bucket };
  }), [inv]);

  const exportRows = () => {
    const datasets = {
      company: companyReport,
      invoices: inv,
      aging,
      payments: pay,
      transactions: tx,
      summary: monthly.map(r => ({ ...r, net: r.income - r.expense }))
    };
    downloadCsv(`finance-${active}-${today}.csv`, datasets[active] || []);
  };

  return <div className="reports-center">
    <section className="reports-intro">
      <div><span className="section-kicker">FINANCIAL INTELLIGENCE</span><h2>Reports center</h2><p>Consolidated and company-level financial reporting from approved records.</p></div>
      <button className="secondary-btn" onClick={load}><RefreshCw size={15} /> Refresh data</button>
    </section>

    <section className="reports-filterbar">
      <label><Building2 size={15} /><select value={filters.company} onChange={e => setFilters({ ...filters, company: e.target.value })}><option value="all">All companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><CalendarRange size={15} /><input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /><span>to</span><input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      <label className="report-search"><Search size={15} /><input placeholder="Search report data" value={filters.query} onChange={e => setFilters({ ...filters, query: e.target.value })} /></label>
      <button className="report-export" onClick={exportRows}><Download size={15} /> Export CSV</button>
    </section>

    <nav className="report-type-tabs">{reportTabs.map(([id, name, Icon]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}><Icon size={15} /> {name}</button>)}</nav>

    {loading ? <ReportLoading /> : <>
      {active === 'summary' && <Summary metrics={metrics} monthly={monthly} companyReport={companyReport} />}
      {active === 'company' && <CompanyReport rows={companyReport} />}
      {active === 'invoices' && <InvoiceReport rows={inv} />}
      {active === 'aging' && <AgingReport rows={aging} />}
      {active === 'payments' && <PaymentReport rows={pay} />}
      {active === 'transactions' && <TransactionReport rows={tx} />}
    </>}
  </div>;
}

function Summary({ metrics, monthly, companyReport }) {
  const max = Math.max(1, ...monthly.flatMap(r => [r.income, r.expense]));
  return <>
    <div className="report-kpis"><ReportStat icon={ArrowUpRight} tone="green" label="Approved income" value={money(metrics.income)} /><ReportStat icon={ArrowDownRight} tone="red" label="Approved expense" value={money(metrics.expense)} /><ReportStat icon={FileSpreadsheet} tone="blue" label="Total invoiced" value={money(metrics.billed)} /><ReportStat icon={WalletCards} tone="amber" label="Outstanding" value={money(metrics.outstanding)} /></div>
    <div className="report-summary-grid"><section className="report-card"><ReportHead title="Monthly performance" note="Approved income and expenses" /><div className="monthly-chart">{monthly.map(r => <div className="month-chart-row" key={r.month}><span>{new Date(`${r.month}-02`).toLocaleDateString('en', { month: 'short', year: '2-digit' })}</span><div><i className="income" style={{ width: `${r.income / max * 100}%` }} /><i className="expense" style={{ width: `${r.expense / max * 100}%` }} /></div><b className={r.income - r.expense < 0 ? 'negative' : ''}>{money(r.income - r.expense)}</b></div>)}{!monthly.length && <Empty />}</div><div className="chart-legend"><span><i className="income" /> Income</span><span><i className="expense" /> Expense</span></div></section>
      <section className="report-card"><ReportHead title="Company snapshot" note="Net movement and outstanding" /><div className="company-snapshot">{companyReport.map(c => <div key={c.id}><span><i>{c.name.slice(0, 2).toUpperCase()}</i><strong>{c.name}</strong></span><span><small>Net movement</small><b className={c.net < 0 ? 'negative' : ''}>{money(c.net)}</b></span><span><small>Outstanding</small><b>{money(c.outstanding)}</b></span></div>)}{!companyReport.length && <Empty />}</div></section></div>
  </>;
}

function CompanyReport({ rows }) { return <section className="report-card report-table-card"><ReportHead title="Company-wise performance" note={`${rows.length} companies · income, expenses, invoices and collections`} /><Table headers={['Company', 'Income', 'Expense', 'Net result', 'Invoices', 'Invoiced', 'Collected', 'Outstanding']}>{rows.map(r => <tr key={r.id}><td><strong>{r.name}</strong></td><Money value={r.income} /><Money value={r.expense} /><Money value={r.net} negative /><td>{r.invoices}</td><Money value={r.invoiced} /><Money value={r.collected} /><Money value={r.outstanding} /></tr>)}</Table>{!rows.length && <Empty />}</section>; }
function InvoiceReport({ rows }) { return <section className="report-card report-table-card"><ReportHead title="Detailed invoice register" note={`${rows.length} invoices in the selected period`} /><Table headers={['Invoice', 'Company', 'Customer', 'Invoice date', 'Due date', 'Status', 'Total', 'Paid', 'Balance']}>{rows.map(r => <tr key={r.id}><td><Link className="report-link" to={`/finance/invoices/${r.id}`}>{r.invoice_number}</Link></td><td>{r.company_name}</td><td><strong>{r.customer_name}</strong><small>{r.customer_email}</small></td><td>{dateLabel(r.invoice_date)}</td><td>{dateLabel(r.due_date)}</td><td><span className={`finance-badge ${r.display_status || r.status}`}>{titleCase(r.display_status || r.status)}</span></td><CurrencyMoney value={r.total_amount} currency={r.currency} /><CurrencyMoney value={r.paid_amount} currency={r.currency} /><CurrencyMoney value={r.balance_amount} currency={r.currency} /></tr>)}</Table>{!rows.length && <Empty />}</section>; }
function AgingReport({ rows }) { const buckets = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days']; return <><div className="aging-kpis">{buckets.map(bucket => <div key={bucket}><span>{bucket}</span><strong>{money(rows.filter(r => r.bucket === bucket && (r.currency || 'INR') === 'INR').reduce((s, r) => s + Number(r.balance_amount), 0))}</strong><small>{rows.filter(r => r.bucket === bucket).length} invoices</small></div>)}</div><section className="report-card report-table-card"><ReportHead title="Receivables aging detail" note="Outstanding invoices grouped by days past due; cards show INR totals" /><Table headers={['Invoice', 'Company', 'Customer', 'Due date', 'Age', 'Bucket', 'Original amount', 'Outstanding']}>{rows.map(r => <tr key={r.id}><td><Link className="report-link" to={`/finance/invoices/${r.id}`}>{r.invoice_number}</Link></td><td>{r.company_name}</td><td>{r.customer_name}</td><td>{dateLabel(r.due_date)}</td><td>{r.overdueDays ? `${r.overdueDays} days` : 'Not due'}</td><td><span className={`aging-badge age-${r.bucket.replace(/\D/g, '') || 'current'}`}>{r.bucket}</span></td><CurrencyMoney value={r.total_amount} currency={r.currency} /><CurrencyMoney value={r.balance_amount} currency={r.currency} /></tr>)}</Table>{!rows.length && <Empty />}</section></>; }
function PaymentReport({ rows }) { const total = rows.filter(r => (r.currency || 'INR') === 'INR').reduce((s, r) => s + Number(r.amount || 0), 0); return <section className="report-card report-table-card"><ReportHead title="Collection report" note={`${rows.length} payments · ${money(total)} collected in INR`} /><Table headers={['Date', 'Company', 'Invoice', 'Customer', 'Method', 'Reference', 'Received by', 'Amount']}>{rows.map(r => <tr key={r.id}><td>{dateLabel(r.payment_date)}</td><td>{r.company_name}</td><td>{r.invoice_id ? <Link className="report-link" to={`/finance/invoices/${r.invoice_id}`}>{r.invoice_number}</Link> : 'Unallocated'}</td><td>{r.customer_name || '—'}</td><td>{titleCase(r.payment_method)}</td><td>{r.reference_number || '—'}</td><td>{r.received_by_name || '—'}</td><CurrencyMoney value={r.amount} currency={r.currency} /></tr>)}</Table>{!rows.length && <Empty />}</section>; }
function TransactionReport({ rows }) { return <section className="report-card report-table-card"><ReportHead title="Transaction detail" note={`${rows.length} transaction records`} /><Table headers={['Date', 'Company', 'Type', 'Category', 'Description', 'Approval', 'Amount']}>{rows.map(r => <tr key={r.id}><td>{dateLabel(r.date)}</td><td>{r.company_name}</td><td><span className={`transaction-type ${r.type}`}>{titleCase(r.type)}</span></td><td>{r.category}</td><td>{r.description}</td><td>{titleCase(r.approval_status || 'approved')}</td><Money value={r.amount} /></tr>)}</Table>{!rows.length && <Empty />}</section>; }

function ReportStat({ icon: Icon, tone, label, value }) { return <div className="report-stat"><div className={`report-stat-icon ${tone}`}><Icon size={18} /></div><span>{label}</span><strong>{value}</strong></div>; }
function ReportHead({ title, note }) { return <div className="report-card-head"><div><h3>{title}</h3><p>{note}</p></div></div>; }
function Table({ headers, children }) { return <div className="report-table-wrap"><table className="report-table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Money({ value, negative }) { return <td className={`report-money ${negative && Number(value) < 0 ? 'negative' : ''}`}>{money(value)}</td>; }
function CurrencyMoney({ value, currency }) { return <td className="report-money">{currencyMoney(value, currency)}</td>; }
function Empty() { return <div className="report-empty"><BarChart3 size={20} /> No report data matches these filters.</div>; }
function ReportLoading() { return <div className="report-loading"><div /><div /><div /></div>; }

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).filter(key => typeof rows[0][key] !== 'object');
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(','), ...rows.map(row => keys.map(key => escape(row[key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
