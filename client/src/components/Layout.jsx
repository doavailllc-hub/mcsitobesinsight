import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Building2, LayoutDashboard, Wallet, Users, UserRound, BadgeIndianRupee, BellRing, Laptop, MapPin, Globe2, Mail, Share2, KeyRound, FolderOpen, Boxes, Landmark, ShieldCheck, ScrollText, Settings, LogOut, ChevronDown } from 'lucide-react';
import { clearSession, getUser } from '../lib/api';
const sections=[
 {label:'Overview',items:[['Dashboard','/',LayoutDashboard],['Companies','/companies',Building2]]},
 {label:'Organization',items:[['Key People','/people',Users],['Products','/products',Boxes]]},
 {label:'Finance',items:[['Finance','/finance',Wallet],['Bank Accounts','/bank',Landmark],['Payroll','/payroll',BadgeIndianRupee]]},
 {label:'People',items:[['Employees','/employees',UserRound]]},
 {label:'Operations',items:[['Reminders','/reminders',BellRing],['Offices','/offices',MapPin],['Assets','/assets',Laptop]]},
 {label:'Digital',items:[['Domains','/domains',Globe2],['Email Accounts','/emails',Mail],['Social Media','/social',Share2],['Credentials','/credentials',KeyRound]]},
 {label:'Documents',items:[['Files','/files',FolderOpen]]},
 {label:'Administration',items:[['Users & Access','/users',ShieldCheck],['Audit Log','/audit',ScrollText],['Settings','/settings',Settings]]}
];
export default function Layout(){const nav=useNavigate();const user=getUser();return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">IM</div><div><strong>Insight</strong><span>MCSITOBES</span></div></div><button className="company-switch"><div><small>Workspace</small><strong>Sanleo Capital Group</strong></div><ChevronDown size={16}/></button><nav>{sections.map(s=><div className="nav-section" key={s.label}><div className="nav-label">{s.label}</div>{s.items.map(([n,p,I])=><NavLink end={p==='/'} to={p} key={p} className={({isActive})=>`nav-item ${isActive?'active':''}`}><I size={18}/><span>{n}</span></NavLink>)}</div>)}</nav><div className="sidebar-user"><div className="avatar">{user?.name?.[0]||'A'}</div><div><strong>{user?.name||'Admin'}</strong><span>{user?.role||'Group Admin'}</span></div><button onClick={()=>{clearSession();nav('/login')}} title="Logout"><LogOut size={18}/></button></div></aside><main className="main"><Outlet/></main></div>}
