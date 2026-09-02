import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { api, getUser, setSession } from '../../lib/api';
import { AuthFrame } from '../Login';

export default function FrontdeskLogin() {
  const user = getUser();
  const nav = useNavigate();
  const [email,setEmail] = useState('frontdesk@insight.local');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  if (user?.role === 'frontdesk') return <Navigate to="/frontdesk" replace/>;
  const submit = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try { const {data}=await api.post('/auth/frontdesk-login',{email,password}); setSession(data.token,data.user,true); nav('/frontdesk'); }
    catch(err){ setError(err.response?.data?.message || 'Unable to sign in.'); }
    finally{ setLoading(false); }
  };
  return <AuthFrame mode="login"><div className="auth-card-head"><p className="eyebrow">COLLECTION DESK</p><h1>Front-desk sign in</h1><p>Collect monthly interest and manage collection customers.</p></div><form className="auth-form" onSubmit={submit}><label><span>Email address</span><div className="auth-input"><Mail size={16}/><input autoFocus type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></div></label><label><span>Password</span><div className="auth-input"><LockKeyhole size={16}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></div></label>{error&&<div className="auth-error">{error}</div>}<button className="auth-submit" disabled={loading}>{loading?'Signing in…':<>Open collection desk <ArrowRight size={16}/></>}</button></form><div className="auth-security">Authorized front-desk users only</div></AuthFrame>;
}
