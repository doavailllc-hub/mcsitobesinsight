import { useEffect, useState } from 'react';
import { BarChart3, BellRing, BookOpenText, ChevronRight, CircleDollarSign, HandCoins, LayoutDashboard, LogOut, Menu, ReceiptIndianRupee, Settings, Users, WalletCards, X } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../../lib/api';
import Collections from '../finance/Collections';
import Investors from '../finance/Investors';
import FrontdeskDashboard from './FrontdeskDashboard';
import OfficeExpenses from './OfficeExpenses';
import FrontdeskSettings from './FrontdeskSettings';
import Cashbook from './Cashbook';
import FrontdeskReports from './FrontdeskReports';
import FrontdeskReminders from './FrontdeskReminders';
import { api } from '../../lib/api';
import '../finance/finance.css';
import './frontdesk-extra.css';
import NotificationCenter from '../../components/NotificationCenter';

const sections = [
  { label: 'Overview', items: [{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Interest Operations', items: [{ key: 'customers', label: 'Customers', icon: Users }, { key: 'collections', label: 'Interest Collection', icon: HandCoins }, { key: 'payouts', label: 'Interest Payouts', icon: CircleDollarSign }, { key: 'reminders', label: 'Due Reminders', icon: BellRing }] },
  { label: 'Cash & Expenses', items: [{ key: 'cashbook', label: 'Cashbook', icon: WalletCards }, { key: 'expenses', label: 'Office Expenses', icon: ReceiptIndianRupee }] },
  { label: 'Insights', items: [{ key: 'reports', label: 'Reports', icon: BarChart3 }] },
  { label: 'Administration', items: [{ key: 'settings', label: 'Settings', icon: Settings }] }
];

const pageCopy = {
  dashboard: ['TODAY’S WORKSPACE', 'Front-desk overview', 'Monitor customers, upcoming interest and collections from one place.'],
  customers: ['CUSTOMER OPERATIONS', 'Customers', 'Find customers, open complete profiles and manage active accounts.'],
  collections: ['DAILY COLLECTION', 'Interest collection', 'Prioritize due accounts and record monthly interest payments.'],
  payouts: ['MONTHLY PAYOUTS', 'Interest payouts', 'Pay monthly interest on time to investors who provided money to the company.'],
  reminders: ['FOLLOW-UP WORKSPACE', 'Due reminders', 'Review overdue, due-today and upcoming customers, then contact them from one list.'],
  cashbook: ['CASH MANAGEMENT', 'Cashbook', 'Track opening cash, receipts, payments and daily closing balance.'],
  expenses: ['OFFICE OPERATIONS', 'Office expenses', 'Record and review petty cash and operating expenses.'],
  reports: ['MANAGEMENT INSIGHTS', 'Reports', 'Review collection, customer, cash and expense performance.'],
  settings: ['FRONT-DESK ADMINISTRATION', 'Settings', 'Configure protected defaults for this front-desk account.']
};

export default function FrontdeskApp() {
  const user = getUser();
  const nav = useNavigate();
  const [page, setPage] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [preference, setPreference] = useState({ default_company_id: null, default_company_name: 'All Companies' });
  useEffect(() => { api.get('/frontdesk/preferences').then(result => setPreference(result.data || {})).catch(() => {}); }, []);
  if (user?.role !== 'frontdesk') return <Navigate to="/frontdesk/login" replace />;
  const openPage = key => { setPage(key); setMobileOpen(false); };
  const logout = () => { clearSession(); nav('/frontdesk/login', { replace: true }); };
  const copy = pageCopy[page];

  return <div className="frontdesk-shell frontdesk-workspace">
    <header className="frontdesk-mobile-header"><button onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21}/></button><div className="frontdesk-brand"><span><HandCoins size={20}/></span><div><strong>Insight Desk</strong><small>Front office</small></div></div><div className="frontdesk-mobile-avatar">{user.name?.[0] || 'F'}</div></header>
    {mobileOpen && <button className="frontdesk-sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close menu"/>}
    <aside className={`frontdesk-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="frontdesk-sidebar-brand"><span><HandCoins size={22}/></span><div><strong>Insight</strong><small>COLLECTION DESK</small></div><button onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={19}/></button></div>
      <div className="frontdesk-office-card"><small>DEFAULT COMPANY</small><strong>{preference.default_company_name || 'All Companies'}</strong><span><i/> All companies available</span></div>
      <nav>{sections.map(section => <section key={section.label}><p>{section.label}</p>{section.items.map(item => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => openPage(item.key)}><item.icon size={17}/><span>{item.label}</span>{page === item.key && <ChevronRight size={14}/>}</button>)}</section>)}</nav>
      <div className="frontdesk-sidebar-user"><div className="frontdesk-user-avatar">{user.name?.[0] || 'F'}</div><div><strong>{user.name}</strong><span>Front Desk Officer</span></div><button onClick={logout} title="Sign out"><LogOut size={17}/></button></div>
    </aside>
    <main className="frontdesk-main">
      <header className="frontdesk-page-header"><div className="frontdesk-title"><p className="eyebrow">{copy[0]}</p><h1>{copy[1]}</h1><p>{copy[2]}</p></div><div className="frontdesk-header-tools"><NotificationCenter className="frontdesk-notifications" onTarget={()=>openPage('reminders')}/><div className="frontdesk-date"><small>WORKING DATE</small><strong>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</strong></div></div></header>
      {page === 'dashboard' && <FrontdeskDashboard navigate={openPage} />}
      {page === 'customers' && <Collections key={`customers-${preference.default_company_id}`} frontdesk defaultFilter="all" showStats={false} defaultCompanyId={preference.default_company_id}/>} 
      {page === 'collections' && <Collections key={`collections-${preference.default_company_id}`} frontdesk defaultFilter="due" defaultCompanyId={preference.default_company_id}/>} 
      {page === 'payouts' && <Investors key={`payouts-${preference.default_company_id}`} frontdesk defaultCompanyId={preference.default_company_id}/>} 
      {page === 'reminders' && <FrontdeskReminders navigate={openPage}/>} 
      {page === 'cashbook' && <Cashbook key={`cashbook-${preference.default_company_id}`} defaultCompanyId={preference.default_company_id}/>} 
      {page === 'expenses' && <OfficeExpenses key={`expenses-${preference.default_company_id}`} defaultCompanyId={preference.default_company_id}/>} 
      {page === 'reports' && <FrontdeskReports defaultCompanyId={preference.default_company_id}/>} 
      {page === 'settings' && <FrontdeskSettings onChanged={setPreference} />}
    </main>
  </div>;
}

const workflowContent = {
  cashbook: { icon: WalletCards, title: 'Daily cashbook workflow', note: 'This menu is ready for the next build phase. The recommended workflow keeps every rupee traceable.', steps: ['Enter opening cash balance', 'Automatically include cash interest collections', 'Record cash received and cash paid', 'Count and confirm closing cash'] },
  expenses: { icon: ReceiptIndianRupee, title: 'Office expense workflow', note: 'Expenses should feed the cashbook and remain separate from customer interest records.', steps: ['Choose expense category', 'Enter vendor, amount and payment method', 'Upload bill or receipt', 'Submit and include in daily closing'] },
  reports: { icon: BookOpenText, title: 'Front-desk reporting workflow', note: 'Reports will combine customer, collection, cash and expense activity without exposing admin-only finance data.', steps: ['Daily collection summary', 'Due and overdue customer report', 'Cash closing statement', 'Office expense summary'] }
};

function WorkflowPreview({ type }) {
  const content = workflowContent[type]; const Icon = content.icon;
  return <section className="frontdesk-workflow-preview"><div className="frontdesk-workflow-icon"><Icon size={25}/></div><p className="eyebrow">WORKFLOW DESIGN</p><h2>{content.title}</h2><p>{content.note}</p><div className="frontdesk-workflow-steps">{content.steps.map((step, index) => <div key={step}><span>{index + 1}</span><strong>{step}</strong></div>)}</div><div className="frontdesk-workflow-status">Planned module · Data entry is not enabled yet</div></section>;
}
