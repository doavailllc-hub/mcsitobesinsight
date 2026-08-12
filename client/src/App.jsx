import { Navigate, Route, Routes } from 'react-router-dom';
import { getPermissions, getUser } from './lib/api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import DataModule from './pages/DataModule';
import Settings from './pages/Settings';
import Files from './pages/Files';
import UsersAccess from './pages/UsersAccess';

function Guard(){return getUser()?<Layout/>:<Navigate to="/login" replace/>}

function PermissionRoute({permission,children}){
  const user=getUser();
  if(!user) return <Navigate to="/login" replace/>;
  if(user.role==='group_admin') return children;
  return getPermissions().includes(permission)?children:<Navigate to="/" replace/>;
}

const protect=(permission,element)=><PermissionRoute permission={permission}>{element}</PermissionRoute>;
export default function App(){return <Routes><Route path="/login" element={<Login/>}/>
<Route element={<Guard/>}><Route path="/" element={protect('dashboard.view',<Dashboard/>)}/
><Route path="/companies" element={protect('companies.view',<Companies/>)}/>
<Route path="/companies/:id" element={protect('companies.view',<CompanyDetail/>)}/>
<Route path="/finance" element={protect('finance.view',<DataModule type="finance"/>)}/>
<Route path="/people" element={protect('people.view',<DataModule type="people"/>)}/>
<Route path="/employees" element={protect('employees.view',<DataModule type="employees"/>)}/>
<Route path="/payroll" element={protect('payroll.view',<DataModule type="payroll"/>)}/>
<Route path="/reminders" element={protect('reminders.view',<DataModule type="reminders"/>)}/>
<Route path="/assets" element={protect('assets.view',<DataModule type="assets"/>)}/>
<Route path="/offices" element={protect('offices.view',<DataModule type="offices"/>)}/>
<Route path="/domains" element={protect('domains.view',<DataModule type="domains"/>)}/>
<Route path="/emails" element={protect('emails.view',<DataModule type="emails"/>)}/>
<Route path="/social" element={protect('social.view',<DataModule type="social"/>)}/>
<Route path="/credentials" element={protect('credentials.view',<DataModule type="credentials"/>)}/>
<Route path="/files" element={protect('files.view',<Files/>)}/><Route path="/products" element={protect('products.view',<DataModule type="products"/>)}/>
<Route path="/bank" element={protect('bank.view',<DataModule type="bank"/>)}/>
<Route path="/users" element={protect('users.view',<UsersAccess/>)}/>
<Route path="/audit" element={protect('audit.view',<DataModule type="audit"/>)}/>
<Route path="/settings" element={protect('users.manage',<Settings/>)}/></Route>
<Route path="*" element={<Navigate to="/" replace/>}/></Routes>}