import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  ReceiptText,
  FileText,
  WalletCards,
  HandCoins,
  ShieldCheck,
  BarChart3,
  BadgeIndianRupee
} from 'lucide-react';

import './finance.css';

const tabs = [
  ['Overview', '/finance', LayoutDashboard, true],
  ['Transactions', '/finance/transactions', ReceiptText],
  ['Sales Invoices', '/finance/invoices', FileText],
  ['Receivables', '/finance/receivables', WalletCards],
  ['Payments', '/finance/payments', HandCoins],
  ['Approvals', '/finance/approvals', ShieldCheck],
  ['Reports', '/finance/reports', BarChart3]
];

export default function FinanceLayout() {
  return (
    <div className="page finance-shell">
      <header className="finance-workspace-header">
        <div className="finance-workspace-icon">
          <BadgeIndianRupee size={20} />
        </div>

        <div className="finance-workspace-copy">
          <p className="eyebrow">FINANCE & ACCOUNTS</p>
          <h1>Finance & Accounts</h1>
          <p>Transactions, invoices, receivables, payments, approvals and reports.</p>
        </div>

        <div className="finance-workspace-status">
          <span />
          Accounting workspace
        </div>
      </header>

      <nav className="finance-tabs" aria-label="Finance navigation">
        {tabs.map(([name, path, Icon, end]) => (
          <NavLink
            key={path}
            to={path}
            end={Boolean(end)}
            className={({ isActive }) =>
              `finance-tab ${isActive ? 'active' : ''}`
            }
          >
            <Icon size={15} />
            <span>{name}</span>
          </NavLink>
        ))}
      </nav>

      <main className="finance-content">
        <Outlet />
      </main>
    </div>
  );
}