import { Navigate, Route, Routes } from 'react-router-dom';
import { getPermissions, getUser } from './lib/api';

import Layout from './components/Layout';
import Login from './pages/Login';
import CreateAccount from './pages/CreateAccount';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import DataModule from './pages/DataModule';
import FinanceLayout from './pages/finance/FinanceLayout';
import FinanceOverview from './pages/finance/FinanceOverview';
import Transactions from './pages/finance/Transactions';
import Approvals from './pages/finance/Approvals';
import FinanceReports from './pages/finance/FinanceReports';
import SalesInvoices from './pages/finance/SalesInvoices';
import InvoiceDetail from './pages/finance/InvoiceDetail';
import Receivables from './pages/finance/Receivables';
import Payments from './pages/finance/Payments';
import Settings from './pages/Settings';
import Files from './pages/Files';
import UsersAccess from './pages/UsersAccess';
import People from './pages/People';
import Products from './pages/Products';
import BankAccounts from './pages/BankAccounts';
import Payroll from './pages/Payroll';
import Employees from './pages/Employees';
import Reminders from './pages/Reminders';
import Offices from './pages/Offices';
import Collections from './pages/finance/Collections';
import CollectionAdmin from './pages/finance/CollectionAdmin';
import Investors from './pages/finance/Investors';
import FrontdeskLogin from './pages/frontdesk/FrontdeskLogin';
import FrontdeskApp from './pages/frontdesk/FrontdeskApp';
import Programming from './pages/Programming';
import PartnerLogin from './pages/partner/PartnerLogin';
import PartnerPortal from './pages/partner/PartnerPortal';
import PartnerAdmin from './pages/PartnerAdmin';
import PartnerOperations from './pages/PartnerOperations';
import PartnerGovernance from './pages/PartnerGovernance';

function Guard() {
  return getUser() ? <Layout /> : <Navigate to="/login" replace />;
}

function PermissionRoute({ permission, children }) {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'group_admin') {
    return children;
  }

  return getPermissions().includes(permission)
    ? children
    : <Navigate to="/" replace />;
}

function HomeRoute() {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'partner') {
    return <Navigate to="/partner" replace />;
  }

  if (
    user.role === 'group_admin' ||
    getPermissions().includes('dashboard.view')
  ) {
    return <Dashboard />;
  }

  const permissions = new Set(getPermissions());

  const firstAllowedRoute = [
    ['companies.view', '/companies'],
    ['finance.view', '/finance'],
    ['people.view', '/people'],
    ['employees.view', '/employees'],
    ['payroll.view', '/payroll'],
    ['reminders.view', '/reminders'],
    ['assets.view', '/assets'],
    ['offices.view', '/offices'],
    ['domains.view', '/domains'],
    ['emails.view', '/emails'],
    ['social.view', '/social'],
    ['credentials.view', '/credentials'],
    ['files.view', '/files'],
    ['products.view', '/products'],
    ['bank.view', '/bank'],
    ['users.view', '/users'],
    ['users.manage', '/users'],
    ['audit.view', '/audit']
  ].find(([permission]) => permissions.has(permission));

  return firstAllowedRoute
    ? <Navigate to={firstAllowedRoute[1]} replace />
    : <NoAccess />;
}

function NoAccess() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#f8fafc'
      }}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          padding: 24,
          border: '1px solid #e4e7ec',
          borderRadius: 14,
          background: '#fff',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(16,24,40,.04)'
        }}
      >
        <h2 style={{ margin: '0 0 8px', color: '#101828' }}>
          No module access
        </h2>

        <p
          style={{
            margin: 0,
            color: '#667085',
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          Your account is active, but no application modules are assigned.
          Contact your Group Administrator to update your access.
        </p>
      </div>
    </div>
  );
}

const protect = (permission, element) => (
  <PermissionRoute permission={permission}>
    {element}
  </PermissionRoute>
);

export default function App() {
  return (
    <Routes>
      <Route path="/partner/login" element={<PartnerLogin />} />
      <Route path="/partner" element={<PartnerPortal />} />
      <Route path="/frontdesk/login" element={<FrontdeskLogin />} />
      <Route path="/frontdesk" element={<FrontdeskApp />} />
      <Route
        path="/login"
        element={
          getUser()
            ? <Navigate to="/" replace />
            : <Login />
        }
      />
      <Route path="/create-account" element={getUser() ? <Navigate to="/" replace /> : <CreateAccount />} />

      <Route element={<Guard />}>
        <Route path="/" element={<HomeRoute />} />

        <Route
          path="/companies"
          element={protect('companies.view', <Companies />)}
        />

        <Route
          path="/companies/:id"
          element={protect('companies.view', <CompanyDetail />)}
        />

        <Route
          path="/finance"
          element={protect('finance.view', <FinanceLayout />)}
        >
          <Route index element={<FinanceOverview />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="invoices" element={<SalesInvoices />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="receivables" element={<Receivables />} />
          <Route path="payments" element={<Payments />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="reports" element={<FinanceReports />} />
          <Route path="collections" element={<CollectionAdmin />} />
          <Route path="collections/customers" element={<Collections />} />
          <Route path="investors" element={<Investors />} />
        </Route>
        <Route path="/loans" element={protect('finance.view', <Collections standalone />)} />

        <Route
          path="/partner-operations"
          element={getUser()?.role === 'group_admin' ? <PartnerOperations /> : <Navigate to="/" replace />}
        />

        <Route
          path="/partners"
          element={getUser()?.role === 'group_admin' ? <PartnerAdmin /> : <Navigate to="/" replace />}
        />

        <Route
          path="/partner-governance"
          element={getUser()?.role === 'group_admin' ? <PartnerGovernance /> : <Navigate to="/" replace />}
        />

        <Route
          path="/people"
          element={protect(
            'people.view',
            <People />
          )}
        />

        <Route
          path="/employees"
          element={protect(
            'employees.view',
            <Employees />
          )}
        />

        <Route
          path="/payroll"
          element={protect(
            'payroll.view',
            <Payroll />
          )}
        />

        <Route
          path="/reminders"
          element={protect(
            'reminders.view',
            <Reminders />
          )}
        />

        <Route
          path="/assets"
          element={protect(
            'assets.view',
            <DataModule type="assets" />
          )}
        />

        <Route
          path="/offices"
          element={protect(
            'offices.view',
            <Offices />
          )}
        />

        <Route
          path="/domains"
          element={protect(
            'domains.view',
            <DataModule type="domains" />
          )}
        />

        <Route
          path="/emails"
          element={protect(
            'emails.view',
            <DataModule type="emails" />
          )}
        />

        <Route
          path="/social"
          element={protect(
            'social.view',
            <DataModule type="social" />
          )}
        />

        <Route
          path="/credentials"
          element={protect(
            'credentials.view',
            <DataModule type="credentials" />
          )}
        />

        <Route
          path="/files"
          element={protect('files.view', <Files />)}
        />

        <Route
          path="/products"
          element={protect(
            'products.view',
            <Products />
          )}
        />

        <Route
          path="/bank"
          element={protect(
            'bank.view',
            <BankAccounts />
          )}
        />

        <Route
          path="/users"
          element={protect('users.view', <UsersAccess />)}
        />

        <Route
          path="/audit"
          element={protect(
            'audit.view',
            <DataModule type="audit" />
          )}
        />

        <Route
          path="/programming"
          element={getUser()?.role === 'group_admin' ? <Programming /> : <Navigate to="/" replace />}
        />

        <Route
          path="/settings"
          element={protect('users.manage', <Settings />)}
        />
      </Route>

      <Route path="/no-access" element={<NoAccess />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
