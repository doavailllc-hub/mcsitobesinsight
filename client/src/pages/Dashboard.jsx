import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarDays,
  Clock3,
  IndianRupee,
  TrendingUp,
  Users
} from 'lucide-react';
import { api } from '../lib/api';

const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const today = new Date();
const monthLabel = today.toLocaleDateString('en', { month: 'long', year: 'numeric' });

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function dueLabel(date) {
  const days = Math.ceil((new Date(date).setHours(23, 59, 59, 999) - Date.now()) / 86400000);
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `In ${days} days`;
}

export default function Dashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then((response) => setData(response.data)).catch(() => setData({}));
  }, []);

  const companies = data?.companies || [];
  const reminders = data?.reminders || [];
  const stats = data?.stats || {};

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div className="hero-copy">
          <p className="eyebrow">SANLEO CAPITAL GROUP</p>
          <h1>{greeting()}</h1>
          <p>Here’s what’s happening across your group today.</p>
        </div>
        <div className="date-chip"><CalendarDays size={17} /><span>{monthLabel}</span></div>
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
      </header>

      <section className="stats-grid dashboard-stats" aria-label="Group statistics">
        <Stat icon={Building2} label="Active companies" value={data ? (stats.companies ?? 0) : '—'} tone="violet" />
        <Stat icon={Users} label="Key people" value={data ? (stats.people ?? 0) : '—'} tone="blue" />
        <Stat icon={IndianRupee} label="Net cashflow" value={data ? money(stats.cashflow) : '—'} tone="emerald" note="This month" />
        <Stat icon={BellRing} label="Needs attention" value={data ? (stats.reminders ?? 0) : '—'} tone="amber" note="Next 45 days" />
      </section>

      <div className="dashboard-grid">
        <section className="panel portfolio-panel">
          <div className="panel-head dashboard-panel-head">
            <div>
              <span className="section-kicker">PORTFOLIO</span>
              <h2>Company overview</h2>
              <p>Ownership across your operating companies</p>
            </div>
            <Link className="text-link" to="/companies">View all <ArrowRight size={15} /></Link>
          </div>

          <div className="company-list">
            {companies.map((company, index) => (
              <Link className="company-row" to={`/companies/${company.id}`} key={company.id}>
                <div className={`company-icon company-color-${index % 5}`}>
                  {company.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="grow">
                  <strong>{company.name}</strong>
                  <span>{company.industry || 'General'}</span>
                </div>
                <div className="ownership-visual">
                  <div className="ownership-copy"><span>Ownership</span><b>{company.sanleo_share}%</b></div>
                  <div className="ownership-bar"><i style={{ width: `${company.sanleo_share}%` }} /></div>
                </div>
                <span className="status"><i /> Active</span>
                <span className="row-action"><ArrowUpRight size={17} /></span>
              </Link>
            ))}
            {data && !companies.length && <Empty icon={Building2} text="No companies to show" />}
          </div>
        </section>

        <section className="panel reminders-panel">
          <div className="panel-head dashboard-panel-head">
            <div>
              <span className="section-kicker">SCHEDULE</span>
              <h2>Upcoming</h2>
              <p>Your next deadlines and renewals</p>
            </div>
            <Link className="icon-link" to="/reminders" aria-label="View all reminders"><ArrowUpRight size={17} /></Link>
          </div>

          <div className="timeline">
            {reminders.map((reminder) => {
              const date = new Date(reminder.due_date);
              return (
                <div className="timeline-item" key={reminder.id}>
                  <div className="datebox"><span>{date.toLocaleString('en', { month: 'short' })}</span><b>{date.getDate()}</b></div>
                  <div className="timeline-copy">
                    <div className="timeline-meta"><span className={`priority priority-${(reminder.priority || 'medium').toLowerCase()}`}>{reminder.priority || 'Medium'}</span><span>{dueLabel(reminder.due_date)}</span></div>
                    <strong>{reminder.title}</strong>
                    <span>{reminder.company_name || 'Group'} · {reminder.category}</span>
                  </div>
                </div>
              );
            })}
            {data && !reminders.length && <Empty icon={Clock3} text="You’re all caught up" />}
          </div>
          {!!reminders.length && <Link className="reminders-footer" to="/reminders">Manage all reminders <ArrowRight size={15} /></Link>}
        </section>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone, note }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon stat-icon-${tone}`}><Icon size={20} /></div>
      <div className="stat-content"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
      <TrendingUp className="stat-watermark" size={42} />
    </div>
  );
}

function Empty({ icon: Icon, text }) {
  return <div className="empty dashboard-empty"><Icon size={22} /><strong>{text}</strong><span>There’s nothing requiring your attention.</span></div>;
}
