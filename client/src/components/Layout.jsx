import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  Building2,
  LayoutDashboard,
  Wallet,
  Users,
  UserRound,
  BadgeIndianRupee,
  BellRing,
  Laptop,
  MapPin,
  Globe2,
  Mail,
  Share2,
  KeyRound,
  FolderOpen,
  Boxes,
  Landmark,
  ShieldCheck,
  ScrollText,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  X
  ,ServerCog
  ,Handshake
  ,ChartNoAxesCombined
  ,ClipboardCheck
} from 'lucide-react';

import {
  clearSession,
  getUser,
  getPermissions,
  refreshAccess
} from '../lib/api';
import insightLogo from '../assets/insight-logo.png';
import NotificationCenter from './NotificationCenter';

const sections = [
  {
    label: 'Overview',
    items: [
      ['Dashboard', '/', LayoutDashboard, 'dashboard.view'],
      ['Companies', '/companies', Building2, 'companies.view']
    ]
  },
  {
    label: 'Organization',
    items: [
      ['Key People', '/people', Users, 'people.view'],
      ['Partner Management', '/partners', Handshake, 'partner.admin'],
      ['Partner Operations', '/partner-operations', ChartNoAxesCombined, 'partner.admin'],
      ['Meetings & Decisions', '/partner-governance', ClipboardCheck, 'partner.admin'],
      ['Products', '/products', Boxes, 'products.view']
    ]
  },
  {
    label: 'Finance',
    items: [
      ['Finance & Accounts', '/finance', Wallet, 'finance.view'],
      ['Loans', '/loans', BadgeIndianRupee, 'finance.view'],
      ['Investors', '/finance/investors', Handshake, 'finance.view'],
      ['Bank Accounts', '/bank', Landmark, 'bank.view'],
      ['Payroll', '/payroll', BadgeIndianRupee, 'payroll.view']
    ]
  },
  {
    label: 'People',
    items: [
      ['Employees', '/employees', UserRound, 'employees.view']
    ]
  },
  {
    label: 'Operations',
    items: [
      ['Reminders', '/reminders', BellRing, 'reminders.view'],
      ['Offices', '/offices', MapPin, 'offices.view'],
      ['Assets', '/assets', Laptop, 'assets.view']
    ]
  },
  {
    label: 'Digital',
    items: [
      ['Domains', '/domains', Globe2, 'domains.view'],
      ['Email Accounts', '/emails', Mail, 'emails.view'],
      ['Social Media', '/social', Share2, 'social.view'],
      ['Credentials', '/credentials', KeyRound, 'credentials.view']
    ]
  },
  {
    label: 'Documents',
    items: [
      ['Files', '/files', FolderOpen, 'files.view']
    ]
  },
  {
    label: 'Administration',
    items: [
      ['Programming', '/programming', ServerCog, 'programming.admin'],
      ['Users & Access', '/users', ShieldCheck, 'users.view'],
      ['Audit Log', '/audit', ScrollText, 'audit.view'],
      ['Settings', '/settings', Settings, 'users.manage']
    ]
  }
];

export default function Layout() {
  const nav = useNavigate();
  const [user, setUser] = useState(getUser());
  const [permissions, setPermissions] = useState(getPermissions());
  const [accessLoading, setAccessLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let active = true;

    refreshAccess()
      .then((data) => {
        if (!active) return;
        setUser(data?.user || getUser());
        setPermissions(data?.permissions || []);
      })
      .catch((err) => {
        if (!active) return;

        if (err?.response?.status === 401) {
          clearSession();
          nav('/login', { replace: true });
          return;
        }

        // Keep the last locally stored access if refresh fails temporarily.
        setUser(getUser());
        setPermissions(getPermissions());
      })
      .finally(() => {
        if (active) setAccessLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nav]);

  const visibleSections = useMemo(() => {
    const isGroupAdmin = user?.role === 'group_admin';

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter(([, path, , permission]) => {
          if (isGroupAdmin) return true;

          // A user with users.manage must also be able to reach Users & Access.
          if (path === '/users') {
            return (
              permissions.includes('users.view') ||
              permissions.includes('users.manage')
            );
          }

          return permissions.includes(permission);
        })
      }))
      .filter((section) => section.items.length > 0);
  }, [user, permissions]);

  const roleLabels = {
    group_admin: 'Group Admin',
    company_admin: 'Company Admin',
    accountant: 'Accountant',
    hr_manager: 'HR Manager',
    document_manager: 'Document Manager',
    it_admin: 'IT Admin',
    management_viewer: 'Management Viewer',
    viewer: 'Viewer'
  };

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <div className="brand"><div className="brand-mark"><img src={insightLogo} alt="" /></div><div><strong>Insight</strong><span>MCSITOBES</span></div></div>
        <button onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={22}/></button>
      </header>
      {mobileNavOpen && (
        <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>
      )}
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><img src={insightLogo} alt="Insight logo" /></div>
          <div>
            <strong>Insight</strong>
            <span>MCSITOBES</span>
          </div>
          <button className="mobile-nav-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={20}/></button>
        </div>

        <button className="company-switch">
          <div>
            <small>Workspace</small>
            <strong>Sanleo Capital Group</strong>
          </div>
          <ChevronDown size={16} />
        </button>

        <nav>
          {accessLoading ? (
            <div
              style={{
                padding: '14px 12px',
                color: '#98a2b3',
                fontSize: 12
              }}
            >
              Loading access...
            </div>
          ) : (
            visibleSections.map((section) => (
              <div className="nav-section" key={section.label}>
                <div className="nav-label">{section.label}</div>

                {section.items.map(([name, path, Icon]) => (
                  <NavLink
                    end={path === '/'}
                    to={path}
                    key={path}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <Icon size={18} />
                    <span>{name}</span>
                  </NavLink>
                ))}
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{user?.name?.[0] || 'A'}</div>

          <div>
            <strong>{user?.name || 'Admin'}</strong>
            <span>{roleLabels[user?.role] || user?.role || 'Viewer'}</span>
          </div>

          <button
            onClick={() => {
              clearSession();
              nav('/login', { replace: true });
            }}
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <NotificationCenter className="admin-notifications" />
        <Outlet />
      </main>
    </div>
  );
}
