import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BadgeIndianRupee, CheckCircle2, Clock3, Plus, UserPlus, Users } from 'lucide-react';
import { api } from '../../lib/api';

const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0));

export default function FrontdeskDashboard({ navigate }) {
  const [data, setData] = useState({ metrics: {}, due_customers: [], recent_payments: [] });
  const [error, setError] = useState('');
  useEffect(() => { api.get('/collections/dashboard').then(result => setData(result.data || {})).catch(err => setError(err.response?.data?.message || 'Unable to load today’s dashboard.')); }, []);
  const metrics = data.metrics || {};
  return <div className="fd-dashboard">
    {error && <div className="finance-error">{error}</div>}
    <section className="fd-dash-stats">
      <DashStat icon={Clock3} label="Due today" value={metrics.due_today || 0} note={money(metrics.expected_today)} tone="blue" />
      <DashStat icon={AlertTriangle} label="Overdue customers" value={metrics.overdue_customers || 0} note={`${money(metrics.expected_now)} total due`} tone="red" />
      <DashStat icon={CheckCircle2} label="Collected today" value={money(metrics.collected_today)} note={`${metrics.payments_today || 0} payments`} tone="green" />
      <DashStat icon={Users} label="Active customers" value={metrics.active_customers || 0} note="Current accounts" />
    </section>
    <section className="fd-quick-actions">
      <div><strong>Quick actions</strong><span>Start the most common front-desk tasks</span></div>
      <button onClick={() => navigate('loans')}><UserPlus size={17}/><span><strong>New loan</strong><small>Register for admin approval</small></span><ArrowRight size={15}/></button>
      <button onClick={() => navigate('collections')}><BadgeIndianRupee size={17}/><span><strong>Collect interest</strong><small>Open due collection list</small></span><ArrowRight size={15}/></button>
    </section>
    <div className="fd-dashboard-columns">
      <section className="fd-dashboard-card fd-priority-list">
        <header><div><strong>Collection priority</strong><span>Customers requiring action now</span></div><button onClick={() => navigate('collections')}>View all <ArrowRight size={13}/></button></header>
        {data.due_customers?.length ? <div>{data.due_customers.map(customer => <button key={customer.id} onClick={() => navigate('collections')}><span className={`fd-priority-mark ${Number(customer.days_overdue) > 0 ? 'overdue' : ''}`}>{Number(customer.days_overdue) > 0 ? <AlertTriangle size={15}/> : <Clock3 size={15}/>}</span><span className="fd-priority-person"><strong>{customer.customer_name}</strong><small>{customer.phone || customer.id_card_number}</small></span><span className="fd-priority-due"><strong>{money(customer.monthly_interest_amount,customer.currency)}</strong><small>{Number(customer.days_overdue) > 0 ? `${customer.days_overdue} days overdue` : 'Due today'}</small></span><ArrowRight size={14}/></button>)}</div> : <Empty icon={CheckCircle2} text="No customers are due today or overdue."/>}
      </section>
      <section className="fd-dashboard-card fd-activity-list">
        <header><div><strong>Recent collections</strong><span>Latest recorded interest payments</span></div></header>
        {data.recent_payments?.length ? <div>{data.recent_payments.map(payment => <div key={payment.id}><span className="fd-activity-icon"><BadgeIndianRupee size={14}/></span><span><strong>{payment.customer_name}</strong><small>{payment.payment_date} · {payment.payment_method}</small></span><b>{money(payment.amount,payment.currency)}</b></div>)}</div> : <Empty icon={BadgeIndianRupee} text="No interest collections recorded yet."/>}
      </section>
    </div>
  </div>;
}

function DashStat({ icon: Icon, label, value, note, tone = '' }) { return <div className={`fd-dash-stat ${tone}`}><span><Icon size={18}/></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></div>; }
function Empty({ icon: Icon, text }) { return <div className="fd-dashboard-empty"><Icon size={21}/><span>{text}</span></div>; }
