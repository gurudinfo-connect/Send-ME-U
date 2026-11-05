import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/ui';
import { useAuth } from '../store';

export default function Splash() {
  const nav = useNavigate();
  const { user, ready } = useAuth();
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (user) return nav('/home', { replace: true });
      nav(localStorage.getItem('smu_onboarded') ? '/login' : '/onboarding', { replace: true });
    }, 900);
    return () => clearTimeout(t);
  }, [ready, user, nav]);

  return (
    <div className="screen dark-screen splash" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="splash-glow" />
      <div style={{ position: 'relative', textAlign: 'center', marginTop: -40 }} className="fade-in">
        <Logo size={150} dark tagline />
      </div>
      <div style={{ position: 'absolute', bottom: 'calc(40px + var(--safe-bottom))', left: 0, right: 0, textAlign: 'center' }}>
        <p style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 26, color: '#fff' }}>
          Private chats,<br />Couple moments,<br />Lifetime memories.
        </p>
        <div className="progress" role="progressbar" aria-label="Loading"><b /></div>
      </div>
    </div>
  );
}
