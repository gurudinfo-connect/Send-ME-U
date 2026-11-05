import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, ShieldCheck, Fingerprint, ScanFace } from 'lucide-react';
import { BrandLogo, Button, TextField, Modal, Toggle, ErrorBox, useGoBack } from '../components/ui';
import { useAuth, useUI, usePrivate } from '../store';
import { lockConfig, setPassword, verifyPassword, disableLock, clearLock, biometricAvailable, biometricLabel, isIOS, enrollBiometric, verifyBiometric, disableBiometric } from '../services/privateLock';

const MIN = 4;

function useBiometric() {
  const [ok, setOk] = useState(false);
  useEffect(() => { let on = true; biometricAvailable().then((v) => on && setOk(v)); return () => { on = false; }; }, []);
  const label = biometricLabel();
  return { ok, label, Icon: isIOS() ? ScanFace : Fingerprint };
}

// Wraps every Private Space route: first time → create a password, afterwards → ask for it each time.
export function PrivateGate() {
  usePrivate((s) => s.rev);
  const unlocked = usePrivate((s) => s.unlocked);
  const cfg = lockConfig();
  if (cfg && !cfg.enabled) return <Outlet />;      // lock switched off in Private Space settings
  if (cfg && unlocked) return <Outlet />;
  return <LockScreen mode={cfg ? 'unlock' : 'setup'} />;
}

function LockScreen({ mode }) {
  const nav = useNavigate();
  const goBack = useGoBack('/home');
  const notify = useUI((s) => s.notify);
  const logout = useAuth((s) => s.logout);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const bio = useBiometric();
  const [useBio, setUseBio] = useState(false);
  const bioOn = mode === 'unlock' && !!lockConfig()?.bio && bio.ok;
  const fails = useRef({ n: 0, until: 0 });
  const [shake, setShake] = useState(false);
  const bad = (m) => { setErr(m); setShake(true); setTimeout(() => setShake(false), 450); };

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (mode === 'setup') {
      if (pw.length < MIN) return bad(`Use at least ${MIN} characters`);
      if (pw !== pw2) return bad('Passwords do not match');
      setBusy(true); await setPassword(pw);
      let msg = 'Private Space lock is on';
      if (useBio && bio.ok) msg = (await enrollBiometric()) ? `Private Space lock is on — ${bio.label} unlock enabled` : `Lock is on, but ${bio.label} couldn’t be set up`;
      setBusy(false);
      usePrivate.getState().unlock(); usePrivate.getState().refresh(); notify(msg);
      return;
    }
    const wait = fails.current.until - Date.now();
    if (wait > 0) return bad(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s`);
    setBusy(true); const ok = await verifyPassword(pw); setBusy(false);
    if (ok) { fails.current.n = 0; usePrivate.getState().unlock(); return; }
    fails.current.n += 1;
    if (fails.current.n >= 5) { fails.current = { n: 0, until: Date.now() + 30000 }; return bad('Too many attempts. Try again in 30s'); }
    setPw(''); bad('Wrong password');
  };
  const bioUnlock = async (silent) => {
    setErr(''); setBusy(true); const ok = await verifyBiometric(); setBusy(false);
    if (ok) usePrivate.getState().unlock(); else if (!silent) setErr(`${bio.label} didn’t unlock. Enter your password instead.`);
  };
  useEffect(() => { if (bioOn) bioUnlock(true); }, [bioOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { clearLock(); usePrivate.getState().lock(); logout(); nav('/login', { replace: true }); };

  return (
    <div className="screen ps plock">
      <i className="ps-arch" />
      <div className="ps-bar">
        <button className="rbtn" aria-label="Back" onClick={goBack}><ArrowLeft size={24} /></button>
        <div className="brand-mini"><BrandLogo width={136} /></div><span style={{ width: 46 }} />
      </div>
      <div className="ps-hero"><img src="/assets/lock-hero.svg" alt="" /></div>
      <div className="ps-title">
        <h1>{mode === 'setup' ? 'Lock your space' : 'Private Space'}</h1>
        <p>{mode === 'setup' ? 'Create a password. You’ll enter it every time you open Private Space.' : 'Enter your password to continue'}</p>
        <i />
      </div>
      <form className={`plock-form ${shake ? 'shake' : ''}`} onSubmit={submit}>
        <TextField type="password" icon={Lock} placeholder={mode === 'setup' ? 'New password' : 'Password'} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" />
        {mode === 'setup' && <TextField type="password" icon={ShieldCheck} placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="off" />}
        {mode === 'setup' && bio.ok && (
          <div className="plock-bio">
            <bio.Icon size={24} />
            <div className="txt"><b>Unlock with {bio.label}</b><small>Skip typing your password next time</small></div>
            <Toggle on={useBio} label={`Unlock with ${bio.label}`} onChange={setUseBio} />
          </div>
        )}
        <ErrorBox>{err}</ErrorBox>
        <Button type="submit" loading={busy}>{mode === 'setup' ? 'Enable lock' : 'Unlock'}</Button>
        {bioOn && <Button type="button" variant="outline" onClick={() => bioUnlock(false)}><bio.Icon size={20} /> Use {bio.label}</Button>}
        {mode === 'unlock' && <button type="button" className="plock-forgot" onClick={() => setForgot(true)}>Forgot password?</button>}
      </form>
      <Modal open={forgot} onClose={() => setForgot(false)} title="Reset Private Space lock?">
        <p className="muted" style={{ marginBottom: 16 }}>To keep your space safe, you’ll be signed out. Sign in again with your account and you can create a new Private Space password.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><Button variant="outline" onClick={() => setForgot(false)}>Cancel</Button><Button variant="danger" onClick={reset}>Sign out & reset</Button></div>
      </Modal>
    </div>
  );
}

// Content of the ⋮ sheet in Private Space: turn the lock on/off, change the password.
export function LockSettings({ open, onClose }) {
  usePrivate((s) => s.rev);
  const notify = useUI((s) => s.notify);
  const cfg = lockConfig();
  const on = !!cfg?.enabled;
  const bio = useBiometric();
  const [step, setStep] = useState(null); // null | 'disable' | 'enable' | 'change'
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setStep(null); setCur(''); setPw(''); setPw2(''); setErr(''); } }, [open]);
  const done = (m) => { usePrivate.getState().refresh(); notify(m); setStep(null); setCur(''); setPw(''); setPw2(''); setErr(''); };

  const run = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (step === 'disable') {
        if (!(await verifyPassword(cur))) return setErr('Wrong password');
        disableLock(); return done('Private Space lock is off');
      }
      if (step === 'change' && !(await verifyPassword(cur))) return setErr('Current password is wrong');
      if (pw.length < MIN) return setErr(`Use at least ${MIN} characters`);
      if (pw !== pw2) return setErr('Passwords do not match');
      await setPassword(pw); usePrivate.getState().unlock();
      done(step === 'change' ? 'Password changed' : 'Private Space lock is on');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Private Space lock">
      {!step ? (
        <>
          <div className="menu-row" style={{ marginBottom: 8 }}>
            <span className="grow">Ask for password to open</span>
            <Toggle on={on} label="Password lock" onChange={(v) => setStep(v ? 'enable' : 'disable')} />
          </div>
          {on && bio.ok && (
            <div className="menu-row" style={{ marginBottom: 8 }}>
              <span className="grow">Unlock with {bio.label}</span>
              <Toggle on={!!cfg?.bio} label={`Unlock with ${bio.label}`} onChange={async (v) => {
                if (!v) { disableBiometric(); usePrivate.getState().refresh(); return notify(`${bio.label} unlock is off`); }
                const ok = await enrollBiometric(); usePrivate.getState().refresh();
                notify(ok ? `${bio.label} unlock is on` : `Couldn’t set up ${bio.label}`);
              }} />
            </div>
          )}
          {on && <Button variant="outline" onClick={() => setStep('change')}>Change password</Button>}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{on ? 'You’ll enter your password every time you open Private Space.' : 'Turn on to protect Private Space with a password.'}</p>
        </>
      ) : (
        <form onSubmit={run}>
          {(step === 'disable' || step === 'change') && <TextField type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus autoComplete="off" />}
          {(step === 'enable' || step === 'change') && <>
            <TextField type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={step === 'enable'} autoComplete="off" />
            <TextField type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="off" />
          </>}
          <ErrorBox>{err}</ErrorBox>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Button type="button" variant="outline" onClick={() => { setStep(null); setErr(''); }}>Cancel</Button>
            <Button type="submit" loading={busy}>{step === 'disable' ? 'Turn off' : step === 'change' ? 'Save' : 'Turn on'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
