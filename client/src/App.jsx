import { Navigate, Route, Routes } from 'react-router-dom';
import { getUser } from './lib/api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import DataModule from './pages/DataModule';
import Settings from './pages/Settings';
import Files from './pages/Files';
function Guard(){return getUser()?<Layout/>:<Navigate to="/login" replace/>}
export default function App(){return <Routes><Route path="/login" element={<Login/>}/><Route element={<Guard/>}><Route path="/" element={<Dashboard/>}/><Route path="/companies" element={<Companies/>}/><Route path="/companies/:id" element={<CompanyDetail/>}/><Route path="/finance" element={<DataModule type="finance"/>}/><Route path="/people" element={<DataModule type="people"/>}/><Route path="/employees" element={<DataModule type="employees"/>}/><Route path="/payroll" element={<DataModule type="payroll"/>}/><Route path="/reminders" element={<DataModule type="reminders"/>}/><Route path="/assets" element={<DataModule type="assets"/>}/><Route path="/offices" element={<DataModule type="offices"/>}/><Route path="/domains" element={<DataModule type="domains"/>}/><Route path="/emails" element={<DataModule type="emails"/>}/><Route path="/social" element={<DataModule type="social"/>}/><Route path="/credentials" element={<DataModule type="credentials"/>}/><Route path="/files" element={<Files/>}/><Route path="/products" element={<DataModule type="products"/>}/><Route path="/bank" element={<DataModule type="bank"/>}/><Route path="/users" element={<DataModule type="users"/>}/><Route path="/audit" element={<DataModule type="audit"/>}/><Route path="/settings" element={<Settings/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}