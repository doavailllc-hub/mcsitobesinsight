import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api, setSession } from '../lib/api';
import insightLogo from '../assets/insight-logo.png';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email: email.trim(), password });
      setSession(data.token, data.user, remember);
      nav('/');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to sign in. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  }

  return <AuthFrame mode="login">
    <div className="auth-card-head">
      <span className="auth-mobile-mark"><img src={insightLogo} alt="Insight logo" /></span>
      <p className="eyebrow">WELCOME BACK</p><h1>Sign in to Insight</h1><p>Use your approved business account to continue.</p>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <label><span>Email address</span><div className="auth-input"><Mail size={16} /><input autoFocus autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></div></label>
      <label><span>Password</span><div className="auth-input"><LockKeyhole size={16} /><input autoComplete="current-password" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
      <div className="auth-options"><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />Remember me</label><span>Contact your administrator to reset access</span></div>
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" disabled={loading}>{loading ? 'Signing in…' : <>Sign in securely<ArrowRight size={16} /></>}</button>
    </form>
    <div className="auth-switch">New to Insight? <Link to="/create-account">Request an account</Link></div>
    <div className="auth-security"><ShieldCheck size={14} />Protected by role-based access controls</div>
  </AuthFrame>;
}

export function AuthFrame({ children, mode }) {
  return <main className={`auth-page auth-${mode}`}>
    <section className="auth-brand-panel">
      <div className="auth-brand"><span><img src={insightLogo} alt="Insight logo" /></span><div><strong>Insight</strong><small>MCSITOBES</small></div></div>
      <div className="auth-brand-copy"><p>GROUP OPERATIONS PLATFORM</p><h2>One secure workspace for every company.</h2><span>Manage finance, people, assets, documents and access with complete organizational visibility.</span><ul><li><CheckCircle2 size={15} />Company-level permissions</li><li><CheckCircle2 size={15} />Protected financial workflows</li><li><CheckCircle2 size={15} />Centralized operational records</li></ul></div>
      <footer>Sanleo Capital Group · Secure internal platform</footer>
    </section>
    <section className="auth-form-panel"><div className="auth-card">{children}</div></section>
  </main>;
}
