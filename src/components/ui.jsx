import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ArrowLeft, MessageSquareText, Users, Phone, Video, Info, X, Inbox, AlertTriangle, Eye, EyeOff, Search, Bell, MoreVertical, ChevronRight } from 'lucide-react';
import { useUI, useAuth } from '../store';
import { api, errMsg } from '../services/api';
import { logoIcon } from '../data/art';

// Brand: the bubble + paper-plane mark, plus a live-text wordmark so it stays legible on light AND dark screens.
export const Mark = ({ size = 40 }) => <img src={logoIcon} alt="" aria-hidden="true" width={size} style={{ width: size, height: 'auto', display: 'block', objectFit: 'contain' }} />;

export const Wordmark = ({ size = 26, dark = false, lockup = false }) => (
  <span className={`wordmark ${dark ? 'on-dark' : ''} ${lockup ? 'lockup' : ''}`} style={{ fontSize: size }} role="img" aria-label="Send ME/U">
    <span className="wm-send">Send</span><span className="wm-me">ME</span><span className="wm-slash">/</span><span className="wm-u">U</span>
  </span>
);

// SendMe/U logo (tight-cropped transparent PNGs): black letters on the light theme, white letters on the dark theme
export const BrandLogo = ({ height, width, dark = false, className = '' }) => {
  const st = { height, width, objectFit: 'contain' };
  return (
    <span className={`brand-logo ${className}`} role="img" aria-label="Send Me/U" style={{ display: 'inline-flex' }}>
      {!dark && <img className="bl-light" src="/logo-new.png?v=2" alt="" aria-hidden="true" style={st} />}
      <img className={dark ? 'bl-dark always' : 'bl-dark'} src="/logo-new-dark.png?v=3" alt="" aria-hidden="true" style={st} />
    </span>
  );
};

export const Logo = ({ size = 80, dark = false, tagline = false }) => (
  <div className="logo-lockup">
    <BrandLogo width={Math.round(size * 1.6)} dark={dark} />
    {tagline && <span className={`tagline ${dark ? 'on-dark' : ''}`} style={{ fontSize: Math.max(9, Math.round(size * 0.075)) }}>CHAT<i />SHARE<i />BE REAL</span>}
  </div>
);

// Top bar used on the main tabs: brand on the left, actions on the right.
// `moreMenu` (optional) renders a dropdown anchored under the 3-dot button.
export function BrandBar({ search = true, bell = false, more = true, logo = true, onSearch, onMore, moreMenu = null, moreOpen = false }) {
  const nav = useNavigate();
  return (
    <div className="brand-bar">
      <div className="brand-mini">{logo && <BrandLogo width={150} className="brand-logo-bar" />}</div>
      {search && <button className="icon-btn" aria-label="Search" onClick={onSearch}><Search size={26} /></button>}
      {bell && <button className="icon-btn" aria-label="Notifications" onClick={() => nav('/notifications')}><Bell size={26} /><i style={{ position: 'absolute', top: 5, right: 6, width: 12, height: 12, borderRadius: '50%', background: '#ff8a00', border: '2px solid #fff' }} /></button>}
      {more && (
        <span className="more-wrap">
          <button className="icon-btn" aria-label="More" aria-haspopup={moreMenu ? 'menu' : undefined} aria-expanded={moreMenu ? !!moreOpen : undefined} onClick={onMore}><MoreVertical size={26} /></button>
          {moreMenu}
        </span>
      )}
    </div>
  );
}

// WhatsApp-style popover list opened from the 3-dot button on the Chats page
export function DropMenu({ open, onClose, items, label = 'More options' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const first = ref.current?.querySelector('button');
    first?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = [...ref.current.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const firstKey = items[0]?.key;
  useEffect(() => { if (open) ref.current?.querySelector('button')?.focus({ preventScroll: true }); }, [firstKey]); // eslint-disable-line
  if (!open) return null;
  return (
    <>
      <button className="dm-backdrop" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <div className="dm" role="menu" aria-label={label} ref={ref}>
        {items.map(({ key, label: l, onSelect, badge, keepOpen, arrow }) => (
          <button key={key} role="menuitem" className="dm-item" onClick={() => { if (!keepOpen) onClose(); onSelect(); }}>
            <span>{l}</span>{badge > 0 && <b className="dm-badge">{badge > 99 ? '99+' : badge}</b>}{arrow && <ChevronRight size={18} aria-hidden />}
          </button>
        ))}
      </div>
    </>
  );
}

export const PageTitle = ({ title, sub }) => <div className="page-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>;

export const Button = ({ variant = 'primary', loading, children, className = '', ...p }) => (
  <button className={`btn btn-${variant} ${className}`} disabled={loading || p.disabled} {...p}>
    {loading ? <span className="typing" style={{ background: 'transparent', padding: 0 }}><i /><i /><i /></span> : children}
  </button>
);

export const TextField = ({ icon: Icon, error, dark, type = 'text', reg, ...p }) => {
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  return (
    <div className="field">
      <label className={`input ${dark ? 'input-dark' : ''}`}>
        {Icon && <Icon size={18} />}
        <input type={isPw && show ? 'text' : type} {...reg} {...p} />
        {isPw && (
          <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </label>
      {error && <p className="err">{error}</p>}
    </div>
  );
};

export const Avatar = ({ src, size = 48, ring, online, alt = '' }) => {
  const img = <img className="avatar" src={src} alt={alt} width={size} height={size} style={{ width: size, height: size }} />;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      {ring ? <span className="avatar-ring">{img}</span> : img}
      {online && <i className="dot-online" />}
    </span>
  );
};

export const Chip = ({ active, children, ...p }) => <button className={`chip ${active ? 'active' : ''}`} {...p}>{children}</button>;
export const Badge = ({ children }) => <span className="badge">{children}</span>;
export const Toggle = ({ on, onChange, label }) => <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {title && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 className="h2">{title}</h3>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export const Toast = () => { const t = useUI((s) => s.toast); return t ? <div className="toast" role="status">{t}</div> : null; };

export const Skeleton = ({ h = 60, w = '100%', r = 14 }) => <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
export const ListSkeleton = ({ n = 4 }) => <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>{Array.from({ length: n }).map((_, i) => <Skeleton key={i} h={62} />)}</div>;
export const Empty = ({ icon: Icon = Inbox, title, text, action }) => (
  <div className="empty"><div className="ic"><Icon size={32} /></div><b style={{ color: 'var(--text)' }}>{title}</b><p className="muted" style={{ margin: '6px 0 14px' }}>{text}</p>{action}</div>
);
export const ErrorState = ({ message, onRetry }) => (
  <div className="empty"><div className="ic" style={{ background: 'var(--cream-soft)', color: '#ff4d6d' }}><AlertTriangle size={32} /></div><b style={{ color: 'var(--text)' }}>Something went wrong</b><p className="muted" style={{ margin: '6px 0 14px' }}>{message}</p>{onRetry && <Button className="btn-sm" onClick={onRetry}>Try again</Button>}</div>
);
export const ErrorBox = ({ children }) => children ? <div className="error-box" role="alert">{children}</div> : null;

// Go to the previous page; if the app was opened directly on this screen (no history), use the fallback.
export function useGoBack(fallback = '/home') {
  const nav = useNavigate();
  return () => (window.history.state && window.history.state.idx > 0 ? nav(-1) : nav(fallback, { replace: true }));
}

export function AppHeader({ title, back, right, dark, children, fallback }) {
  const nav = useNavigate();
  const goBack = useGoBack(typeof back === 'string' ? back : fallback);
  return (
    <header className="app-header" style={dark ? { color: '#fff' } : undefined}>
      {back && <button className="icon-btn" aria-label="Back" onClick={() => goBack()}><ArrowLeft size={22} /></button>}
      <div className="title">{title}{children}</div>
      {right}
    </header>
  );
}

const DailyIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="14" cy="14" r="11.5" strokeDasharray="4 3.2" /><circle cx="14" cy="14" r="6.2" /><circle cx="14" cy="14" r="1.8" fill="currentColor" stroke="none" />
  </svg>
);

export const TABS = ['/home', '/daily', '/timeline', '/calls', '/profile'];

export function BottomNav() {
  const user = useAuth((s) => s.user);
  const unread = useUI((s) => s.unread);
  const setUnread = useUI((s) => s.setUnread);
  useEffect(() => {
    if (unread !== null) return;
    api.conversations({}).then((l) => setUnread(l.reduce((a, c) => a + (c.unread || 0), 0))).catch(() => {});
  }, [unread, setUnread]);
  const { pathname } = useLocation();
  const items = [
    { to: '/home', label: 'Chats', icon: <MessageSquareText size={26} />, badge: unread },
    { to: '/daily', label: 'Daily', icon: <DailyIcon /> },
    { to: '/timeline', label: 'Timeline', icon: <Users size={26} /> },
    { to: '/calls', label: 'Calls', icon: <Phone size={25} /> },
    { to: '/profile', label: 'You', icon: null },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      <i className="bn-thumb" aria-hidden style={{ transform: `translateX(${Math.max(0, TABS.indexOf(pathname)) * 100}%)`, opacity: TABS.indexOf(pathname) < 0 ? 0 : 1 }} />
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
          <span className="bn-ico">
            {it.icon || <img className="bn-av" src={user?.avatar} alt="" />}
            {it.badge > 0 && <b className="bn-badge">{it.badge > 99 ? '99+' : it.badge}</b>}
          </span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

// Last result per request is remembered, so revisiting a screen shows data instantly (and refreshes quietly in the background)
const asyncCache = new Map();
export function useAsync(fn, deps = []) {
  const key = `${fn.toString()}|${JSON.stringify(deps)}`;
  const hit = asyncCache.get(key);
  const [state, set] = useState({ data: hit ?? null, loading: hit === undefined, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const cached = asyncCache.get(key);
    if (cached !== undefined) set({ data: cached, loading: false, error: null });
    else set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { asyncCache.set(key, data); live && set({ data, loading: false, error: null }); })
      .catch((e) => live && set({ data: null, loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load' }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (d) => set((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
export const daysUntil = (iso) => Math.max(0, Math.ceil((new Date(iso) - new Date(new Date().toDateString())) / 86400000));

// Slides/fades each screen in; direction follows the tab order, push vs back otherwise
export function PageTransition({ children }) {
  const loc = useLocation();
  const type = useNavigationType();
  const ref = useRef({ path: loc.pathname, dir: 'fade' });
  if (ref.current.path !== loc.pathname) {
    const a = TABS.indexOf(ref.current.path), b = TABS.indexOf(loc.pathname);
    ref.current = { path: loc.pathname, dir: a >= 0 && b >= 0 ? (b > a ? 'tab-next' : 'tab-prev') : type === 'POP' ? 'back' : 'push' };
  }
  return <div key={loc.pathname} className={`page ${ref.current.dir}`}>{children}</div>;
}

// Pill-shaped tab strip with a sliding glass thumb
export function GlassTabs({ items, value, onChange, label }) {
  const box = useRef(null);
  const btns = useRef({});
  const first = useRef(true);
  const [thumb, setThumb] = useState(null);
  const measure = () => { const el = btns.current[value]; if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth }); };
  useLayoutEffect(() => {
    measure();
    const el = btns.current[value];
    if (!first.current && el?.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    first.current = false;
  }, [value, items.length]); // eslint-disable-line
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(box.current);
    document.fonts?.ready?.then(measure);
    return () => ro.disconnect();
  }, [value]); // eslint-disable-line
  return (
    <div className="gtabs" role="tablist" aria-label={label} ref={box}>
      <i className="gthumb" aria-hidden style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width } : { opacity: 0 }} />
      {items.map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={value === k} ref={(el) => { btns.current[k] = el; }} className={`gtab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>
          {l}{n > 0 && <span className="gn">{n}</span>}
        </button>
      ))}
    </div>
  );
}

// Profile zoom, built from the reference recording: tapping an avatar dims the whole app and grows a card out of that
// avatar — square photo with the name on a darker strip across its top, and a bar of four outline icons underneath
// (Message, Voice call, Video call, Info). No close button: tap outside the card, Escape or Back dismisses it and the
// card shrinks back into the avatar. Message/Info use the existing routes; calls use the same api.placeCall as the Calls tab.
const PZ_RATIO = 566 / 476;      // card height / width, measured from the reference
export function ProfilePreview({ contact, from, onClose }) {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [broken, setBroken] = useState(false);
  const [geo, setGeo] = useState(null);
  const [big, setBig] = useState(false); // second zoom: the photo inside the opened card grows to full width
  const root = useRef(null);
  const card = useRef(null);
  const closing = useRef(false);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const name = contact?.name || '';
  const avatar = contact?.avatar;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  // size + place the card like the reference: 66% of the width, centred, top at ~20.5% of the height (kept on-screen)
  useLayoutEffect(() => {
    if (!contact) { setGeo(null); return; }
    const r = root.current.getBoundingClientRect();
    let w = r.width * 0.66;
    if (w * PZ_RATIO > r.height - 24) w = (r.height - 24) / PZ_RATIO;
    const h = w * PZ_RATIO;
    // big size: the full width of the screen (or as wide as the height allows), centred vertically
    let bw = r.width;
    if (bw * PZ_RATIO > r.height - 24) bw = (r.height - 24) / PZ_RATIO;
    const bh = bw * PZ_RATIO;
    setBig(false);
    setGeo({ w, top: Math.max(12, Math.min(r.height * 0.2048, r.height - h - 12)), bw, btop: Math.max(12, (r.height - bh) / 2) });
  }, [contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the card travels between the avatar's rectangle and its resting place (and the avatar's circle -> square corners)
  const origin = () => {
    const el = card.current;
    if (!el || !from || !from.width) return null;
    const c = el.getBoundingClientRect();
    if (!c.width) return null;
    return { t: `translate(${from.left + from.width / 2 - (c.left + c.width / 2)}px, ${from.top + from.height / 2 - (c.top + c.height / 2)}px) scale(${from.width / c.width})`, r: `${c.width / 2}px` };
  };
  useEffect(() => {
    if (!geo || reduce) return;
    closing.current = false;
    const o = origin();
    root.current?.animate([{ background: 'rgba(0,0,0,0)' }, { background: 'rgba(0,0,0,.43)' }], { duration: 250, easing: 'ease-out' });
    card.current?.animate(o ? [{ transform: o.t, borderRadius: o.r }, { transform: 'none', borderRadius: '0px' }] : [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 250, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!geo) return undefined;
    const prev = document.activeElement;
    card.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, [geo]);

  const close = (after) => {
    if (closing.current || !root.current) return;
    closing.current = true;
    const done = () => { onClose(); after?.(); };
    if (reduce) { done(); return; }
    const o = origin();
    root.current.animate([{ background: big ? 'rgba(0,0,0,.88)' : 'rgba(0,0,0,.43)' }, { background: 'rgba(0,0,0,0)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    const a = card.current?.animate(o ? [{ transform: 'none', borderRadius: '0px' }, { transform: o.t, borderRadius: o.r }] : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 220, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' });
    if (a) a.onfinish = done; else done();
    setTimeout(() => { if (closing.current && root.current) done(); }, 400); // safety net
  };
  useEffect(() => {
    if (!contact) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (big) setBig(false); else close(); return; }
      if (e.key !== 'Tab' || !card.current) return;
      const f = [...card.current.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!contact) return null;

  const place = async (video) => {
    try { await api.placeCall({ name, avatar, fav: false, video }); notify(`${video ? 'Video calling' : 'Calling'} ${name}…`); }
    catch (e) { notify(errMsg(e)); }
  };
  const actions = [
    ['Message', MessageSquareText, () => close(() => nav(`/chats/${contact.id}`))],
    ['Voice call', Phone, () => { close(); place(false); }],
    ['Video call', Video, () => { close(); place(true); }],
    ['Info', Info, () => close(() => nav(`/chats/${contact.id}/info`))],
  ];
  return createPortal(
    <div className={`pz-scrim ${big ? 'big' : ''}`} ref={root} onClick={(e) => { e.stopPropagation(); close(); }}>
      <div className="pz-card" role="dialog" aria-modal="true" aria-label={`${name} profile picture`} ref={card} onClick={(e) => e.stopPropagation()}
        style={geo ? (big ? { width: geo.bw, top: geo.btop, marginLeft: -geo.bw / 2 } : { width: geo.w, top: geo.top, marginLeft: -geo.w / 2 }) : { visibility: 'hidden' }}>
        <button type="button" className="pz-photo" aria-label={big ? 'Make profile picture smaller' : 'Make profile picture bigger'} aria-pressed={big} onClick={() => setBig((v) => !v)}>
          {avatar && !broken ? <img src={avatar} alt={`${name} profile picture`} draggable={false} onError={() => setBroken(true)} /> : <span className="pz-initials" role="img" aria-label={`${name} (no profile picture)`}>{initials}</span>}
          <b className="pz-name">{name}</b>
        </button>
        <div className="pz-actions">
          {actions.map(([label, Icon, fn]) => <button key={label} className="pz-act" aria-label={label} onClick={fn}><Icon strokeWidth={2} /></button>)}
        </div>
      </div>
    </div>,
    document.querySelector('.device') || document.body,
  );
}
