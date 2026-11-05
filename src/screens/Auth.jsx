import { useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Lock, User, Phone, ChevronRight, ChevronLeft } from 'lucide-react';
import { Logo, Button, TextField, ErrorBox, AppHeader } from '../components/ui';
import { useAuth, useUI } from '../store';
import { api, errMsg } from '../services/api';

const idRule = z.string().min(1, 'Email or phone is required').refine((v) => /^\S+@\S+\.\S+$/.test(v) || /^\+?[0-9]{8,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid email or phone number');
const pwRule = z.string().min(8, 'At least 8 characters');

const loginSchema = z.object({ identifier: idRule, password: z.string().min(1, 'Password is required'), remember: z.boolean().optional() });
const signupSchema = z.object({ name: z.string().min(2, 'Enter your full name'), identifier: idRule, password: pwRule, confirm: z.string(), terms: z.literal(true, { errorMap: () => ({ message: 'Please accept the Terms & Conditions and Privacy Policy' }) }) })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

const SocialRow = () => {
  const notify = useUI((s) => s.notify);
  const soon = (n) => () => notify(`${n} sign-in is not configured yet`);
  return (
    <div className="social-row">
      <button className="social" aria-label="Continue with Google" onClick={soon('Google')}><svg width="26" height="26" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.7l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg></button>
      <button className="social" aria-label="Continue with Apple" onClick={soon('Apple')}><svg width="24" height="26" viewBox="0 0 22 24" fill="currentColor"><path d="M16.365 1.43c0 1.14-.46 2.23-1.21 3.03-.78.83-2.06 1.47-3.1 1.39-.13-1.1.42-2.25 1.15-3 .8-.84 2.18-1.45 3.16-1.42zM20.5 17.3c-.55 1.27-.82 1.83-1.53 2.95-.99 1.56-2.38 3.5-4.1 3.52-1.53.02-1.93-1-4.01-.99-2.08.01-2.52 1.01-4.05.99-1.72-.02-3.04-1.77-4.03-3.33C-.01 16.1-.3 11.4 1.4 8.8c1.2-1.84 3.1-2.92 4.88-2.92 1.81 0 2.95 1 4.45 1 1.45 0 2.33-1 4.43-1 1.58 0 3.26.86 4.46 2.35-3.92 2.15-3.28 7.75.88 9.07z"/></svg></button>
      <button className="social" aria-label="Continue with phone" onClick={soon('Phone')}><Phone size={24} fill="currentColor" /></button>
    </div>
  );
};

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const login = useAuth((s) => s.login);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { remember: true } });
  const submit = async (v) => {
    setError('');
    try { await login({ identifier: v.identifier, password: v.password }, v.remember); nav(loc.state?.from || '/home', { replace: true }); }
    catch (e) { setError(errMsg(e)); }
  };
  return (
    <div className="screen auth-dark" style={{ padding: '0 24px calc(20px + var(--safe-bottom))', overflowY: 'auto' }}>
      <div className="center" style={{ marginTop: 22 }}><Logo size={150} tagline /></div>
      <form onSubmit={handleSubmit(submit)} noValidate style={{ marginTop: 26 }}>
        <ErrorBox>{error}</ErrorBox>
        <TextField dark icon={Mail} placeholder="Email or Phone" autoComplete="username" reg={register('identifier')} error={errors.identifier?.message} />
        <TextField dark icon={Lock} type="password" placeholder="Password" autoComplete="current-password" reg={register('password')} error={errors.password?.message} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 2px 22px' }}>
          <label className="check"><input type="checkbox" {...register('remember')} /> Remember me</label>
          <Link to="/forgot-password" className="link" style={{ fontSize: 15 }}>Forgot password?</Link>
        </div>
        <Button variant="login" type="submit" loading={isSubmitting}>Login</Button>
      </form>
      <div className="divider" style={{ margin: '24px 0 16px' }}>or continue with</div>
      <SocialRow />
      <p className="center" style={{ fontSize: 17, marginTop: 'auto', paddingTop: 22 }}>Don’t have an account? <Link className="link" to="/signup">Sign up</Link></p>
    </div>
  );
}

export function SignUp() {
  const nav = useNavigate();
  const signup = useAuth((s) => s.signup);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(signupSchema), defaultValues: { terms: true } });
  const submit = async (v) => {
    setError('');
    try { await signup({ name: v.name, identifier: v.identifier, password: v.password }); nav('/home', { replace: true }); }
    catch (e) { setError(errMsg(e)); }
  };
  return (
    <div className="screen auth-light" style={{ padding: 'calc(14px + var(--safe-top)) 24px calc(18px + var(--safe-bottom))', overflowY: 'auto' }}>
      <i className="blob" style={{ width: 150, height: 300, left: -70, top: 190, background: 'linear-gradient(160deg,#d9efff,#e6f3ff)' }} />
      <i className="blob" style={{ width: 230, height: 230, right: -90, top: -70, background: 'linear-gradient(160deg,#ffe7bd,#ffd7a1)' }} />
      <i className="blob" style={{ width: 54, height: 54, right: 26, top: 130, background: 'radial-gradient(circle at 35% 30%, #c9ecff, #ffe0b0)' }} />
      <i className="blob" style={{ width: 240, height: 200, left: -110, bottom: -60, background: 'linear-gradient(160deg,#ffe3b0,#ffd29a)' }} />
      <i className="blob" style={{ width: 280, height: 220, right: -120, bottom: -90, background: 'linear-gradient(160deg,#cfe9ff,#bfe0ff)' }} />
      <button className="round-back" aria-label="Back" onClick={() => nav(-1)}><ChevronLeft size={22} /></button>
      <div className="center" style={{ marginTop: -22 }}><Logo size={108} tagline /></div>
      <h1 className="big" style={{ marginTop: 22 }}>Create Your Account</h1>
      <p className="lead">Join Send ME/U and be part of something special. It’s quick and easy!</p>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <ErrorBox>{error}</ErrorBox>
        <TextField icon={User} placeholder="Full Name" autoComplete="name" reg={register('name')} error={errors.name?.message} />
        <TextField icon={Mail} placeholder="Email or Phone" autoComplete="username" reg={register('identifier')} error={errors.identifier?.message} />
        <TextField icon={Lock} type="password" placeholder="Password" autoComplete="new-password" reg={register('password')} error={errors.password?.message} />
        <TextField icon={Lock} type="password" placeholder="Confirm Password" autoComplete="new-password" reg={register('confirm')} error={errors.confirm?.message} />
        <label className="check-box"><input type="checkbox" {...register('terms')} /><span>I agree to the <span className="lk">Terms &amp; Conditions</span> and <span className="lk">Privacy Policy</span></span></label>
        {errors.terms && <p className="err" style={{ marginTop: -12, marginBottom: 12 }}>{errors.terms.message}</p>}
        <button className="btn-signup" type="submit" disabled={isSubmitting}>Sign Up<ChevronRight size={26} /></button>
      </form>
      <div className="divider">or continue with</div>
      <SocialRow />
      <p className="center" style={{ fontSize: 15.5, marginTop: 'auto', paddingTop: 18, color: '#4b4785' }}>Already have an account? <Link className="link" style={{ fontWeight: 700 }} to="/login">Login</Link></p>
    </div>
  );
}

export function ForgotPassword() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(z.object({ identifier: idRule })) });
  const submit = async (v) => {
    setError('');
    try { await api.forgot(v); notify('Reset code sent'); nav(`/reset-password?id=${encodeURIComponent(v.identifier)}`); }
    catch (e) { setError(errMsg(e)); }
  };
  return (
    <div className="screen soft-screen" style={{ padding: '0 22px' }}>
      <AppHeader back="/login" title="Forgot Password" />
      <div className="center" style={{ margin: '10px 0 20px' }}><Logo size={90} /></div>
      <p className="muted" style={{ marginBottom: 18 }}>Enter your email or phone and we'll send you a code to reset your password.</p>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <ErrorBox>{error}</ErrorBox>
        <TextField icon={Mail} placeholder="Email or Phone" reg={register('identifier')} error={errors.identifier?.message} />
        <Button type="submit" loading={isSubmitting}>Send reset code</Button>
      </form>
    </div>
  );
}

const resetSchema = z.object({ code: z.string().length(6, 'Enter the 6-digit code'), password: pwRule, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const notify = useUI((s) => s.notify);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(resetSchema) });
  const submit = async (v) => {
    setError('');
    try { await api.reset({ identifier: params.get('id'), code: v.code, password: v.password }); notify('Password updated. Please log in.'); nav('/login', { replace: true }); }
    catch (e) { setError(errMsg(e)); }
  };
  return (
    <div className="screen soft-screen" style={{ padding: '0 22px' }}>
      <AppHeader back="/forgot-password" title="Reset Password" />
      <div className="center" style={{ margin: '10px 0 20px' }}><Logo size={90} /></div>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <ErrorBox>{error}</ErrorBox>
        <TextField icon={Mail} placeholder="6-digit code" inputMode="numeric" maxLength={6} reg={register('code')} error={errors.code?.message} />
        <TextField icon={Lock} type="password" placeholder="New password" reg={register('password')} error={errors.password?.message} />
        <TextField icon={Lock} type="password" placeholder="Confirm new password" reg={register('confirm')} error={errors.confirm?.message} />
        <Button type="submit" loading={isSubmitting}>Update password</Button>
      </form>
    </div>
  );
}
