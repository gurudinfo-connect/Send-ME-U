import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Logo } from '../components/ui';

const pages = [
  { art: '/assets/ob-private-dark.jpg', bg: 'linear-gradient(180deg, #0b1630 0%, #0f1a33 45%, #070d20 100%)', title: 'Your Private World', text: 'Secure chats, photos and memories — always protected.' },
  { art: '/assets/ob-couples-dark.jpg', bg: 'linear-gradient(180deg, #071228 0%, #091a3a 45%, #050c20 100%)', title: 'Made for Couples', text: 'Share moments, plan dates and save memories together.' },
  { art: '/assets/ob-memories-dark.jpg', bg: 'linear-gradient(180deg, #081a40 0%, #0a1f4c 45%, #050f2e 100%)', title: 'Stories & Memories', text: 'Capture your day, share stories and keep your special moments in one place.' },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState('next');
  const x0 = useRef(null);
  const nav = useNavigate();
  const last = i === pages.length - 1;
  const finish = () => { localStorage.setItem('smu_onboarded', '1'); nav('/login', { replace: true }); };
  const go = (n) => { if (n < 0 || n > pages.length - 1) return; setDir(n > i ? 'next' : 'prev'); setI(n); };
  const p = pages[i];
  return (
    <div className="screen ob" style={{ '--ob-bg': p.bg }} onTouchStart={(e) => { x0.current = e.touches[0].clientX; }} onTouchEnd={(e) => { const d = e.changedTouches[0].clientX - x0.current; if (Math.abs(d) > 50) go(d < 0 ? i + 1 : i - 1); }}>
      <div className="center"><Logo size={104} dark /></div>
      <div className={`center ob-${dir}`} key={`t${i}`} style={{ marginTop: 22 }}>
        <h1>{p.title}</h1>
        <p className="sub">{p.text}</p>
      </div>
      <div className={`art ob-${dir}`} key={i}><img src={p.art} alt="" /></div>
      <div className="dots" aria-label={`Page ${i + 1} of 3`}>{pages.map((_, k) => <i key={k} className={k === i ? 'on' : ''} onClick={() => go(k)} />)}</div>
      <button className="btn-cta" onClick={() => (last ? finish() : go(i + 1))}>
        {last ? 'Get Started' : 'Next'}<ChevronRight size={26} />
      </button>
      {!last ? <button className="btn-skip" onClick={finish}>Skip</button> : <div style={{ height: 50 }} />}
    </div>
  );
}
