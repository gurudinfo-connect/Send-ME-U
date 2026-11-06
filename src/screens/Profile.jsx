import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Search, Share2, Pencil, Plus, ChevronDown, ArrowLeft, X, Camera, Image as ImageIcon, CircleDot, Eye, LogOut, Copy, User, AtSign, Phone, Link2, Info } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { useAuth, useUI, useProfile, moodActive } from '../store';
import { api, errMsg } from '../services/api';
import { MENU, buildIndex } from '../profile/registry';

const PRESETS = [['😊', 'Happy'], ['🥰', 'Feeling loved'], ['🎧', 'Vibing'], ['🔥', 'Focused'], ['😴', 'Sleepy'], ['🌧️', 'Need some space'], ['✈️', 'On the move'], ['🍿', 'Movie mode']];
const FOR = [['1h', 'For 1 hour'], ['today', 'Today'], ['week', 'This week'], ['never', "Don't clear"]];
const untilFor = (k) => {
  const n = new Date();
  if (k === '1h') return Date.now() + 36e5;
  if (k === 'today') return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime();
  if (k === 'week') return Date.now() + 7 * 864e5;
  return null;
};
const prompt = () => { const h = new Date().getHours(); return `How's your ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'}?`; };

export function Profile() {
  const nav = useNavigate();
  const { user, logout, setUser } = useAuth();
  const notify = useUI((s) => s.notify);
  const settings = useUI((s) => s.settings);
  const { mood, setMood, plan, lists } = useProfile();
  const moodOn = moodActive(mood);

  const screenRef = useRef(null); const scrollRef = useRef(null); const raf = useRef(0);
  const fileRef = useRef(null); const camRef = useRef(null);
  const [q, setQ] = useState(''); const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState(null); // 'photo' | 'name' | 'mood' | 'logout'
  const [viewer, setViewer] = useState(false);
  const [draft, setDraft] = useState({ emoji: '😊', text: '', dur: 'today' });

  // Collapse progress (0 → 1) drives the hero + header purely through a CSS variable: no re-render while scrolling.
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const p = Math.min(1, Math.max(0, (scrollRef.current?.scrollTop || 0) / 150));
      screenRef.current?.style.setProperty('--p', p.toFixed(3));
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const handle = (user?.handle || '').replace(/^@/, '');
  const link = `https://sendmeu.app/@${handle}`;
  const ctx = { plan, lists, lang: settings.lang || 'en' };
  const val = (v) => (typeof v === 'function' ? v(ctx) : v);
  const index = useMemo(buildIndex, []);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return t.length ? index.filter((e) => t.every((w) => e.words.toLowerCase().includes(w))).slice(0, 30) : [];
  }, [q, index]);

  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try { const u = await api.uploadAvatar(f); setUser({ ...user, ...u }); notify('Profile photo updated'); } catch (er) { notify(errMsg(er)); }
    setSheet(null);
  };
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: user?.name, text: `${user?.name} on Send ME/U`, url: link }); else { await navigator.clipboard.writeText(link); notify('Profile link copied'); } } catch { /* cancelled */ }
  };
  const copyHandle = async () => { try { await navigator.clipboard.writeText(`@${handle}`); notify('Username copied'); } catch { notify(`@${handle}`); } setSheet(null); };
  const openMood = () => { setDraft({ emoji: moodOn ? mood.emoji : '😊', text: moodOn ? mood.text : '', dur: 'today' }); setSheet('mood'); };
  const saveMood = () => {
    const text = draft.text.trim(); if (!text) return notify('Write a few words first');
    setMood({ emoji: draft.emoji, text, until: untilFor(draft.dur) }); setSheet(null); notify('Mood updated');
  };
  const go = (to) => { setSheet(null); nav(to); };

  return (
    <div className="screen yh" ref={screenRef} style={{ '--p': 0 }}>
      <header className={`yh-bar ${searching ? 'solid' : ''}`}>
        {searching ? (
          <>
            <button className="yh-ib" aria-label="Close search" onClick={() => { setSearching(false); setQ(''); }}><ArrowLeft size={22} /></button>
            <input className="yh-search" autoFocus type="search" placeholder="Search settings" aria-label="Search settings" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button className="yh-ib" aria-label="Clear" onClick={() => setQ('')}><X size={20} /></button>}
          </>
        ) : (
          <>
            <h2 className="yh-bar-title">{user?.name}</h2>
            <button className="yh-ib" aria-label="Search settings" onClick={() => { scrollRef.current?.scrollTo({ top: 0 }); setSearching(true); }}><Search size={22} /></button>
            <button className="yh-ib" aria-label="Share profile" onClick={share}><Share2 size={22} /></button>
            <button className="yh-ib" aria-label="Edit profile" onClick={() => nav('/profile/edit')}><Pencil size={22} /></button>
          </>
        )}
      </header>

      <div className="scroll yh-scroll" ref={scrollRef} onScroll={onScroll}>
        {searching ? (
          <div className="yh-results" role="list">
            {!q.trim() && <p className="yh-empty">Search for a setting, like “last seen”, “theme” or “backup”.</p>}
            {q.trim() && !hits.length && <p className="yh-empty">No results for “{q}”</p>}
            {hits.map((h, i) => (
              <button key={`${h.to}-${h.label}-${i}`} role="listitem" className="yh-row" onClick={() => nav(h.to)}>
                <span className="yh-t"><b>{h.label}</b>{h.trail && <small>{h.trail}</small>}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <section className="yh-hero">
              <div className="yh-hero-in">
                <button className={`yh-mood ${moodOn ? 'set' : ''}`} onClick={openMood} aria-label="Set your current mood">
                  {moodOn ? <><span className="e">{mood.emoji}</span> {mood.text}</> : prompt()}
                  <i className="tail" />
                </button>
                <div className="yh-avatar">
                  <button className="yh-av" aria-label="Profile photo options" onClick={() => setSheet('photo')}>
                    <img src={user?.avatar} alt={user?.name} />
                  </button>
                  <button className="yh-plus" aria-label="Add photo or story" onClick={() => setSheet('photo')}><Plus size={22} strokeWidth={3} /></button>
                </div>
                <button className="yh-name" onClick={() => setSheet('name')} aria-haspopup="dialog">{user?.name}<ChevronDown size={20} /></button>
                <p className="yh-handle">@{handle}</p>
              </div>
            </section>

            <nav className="yh-list" aria-label="Settings">
              {MENU.map((m, i) => {
                const sub = val(m.sub); const badge = m.badge ? val(m.badge) : null; const I = m.icon;
                return (
                  <button key={m.id} className="yh-row" style={{ '--i': i }} onClick={() => nav(m.to)}>
                    <span className="yh-ic"><I size={24} strokeWidth={1.9} /></span>
                    <span className="yh-t"><b>{m.title}</b>{sub && <small>{sub}</small>}</span>
                    {badge && <em className="yh-badge">{badge}</em>}
                  </button>
                );
              })}
            </nav>

            <div className="yh-div" />
            <button className="yh-row out" onClick={() => setSheet('logout')}>
              <span className="yh-ic"><LogOut size={24} strokeWidth={1.9} /></span><span className="yh-t"><b>Log out</b></span>
            </button>
            <p className="yh-foot">Send ME/U</p>
          </>
        )}
      </div>

      <input ref={fileRef} hidden type="file" accept="image/*" onChange={pick} />
      <input ref={camRef} hidden type="file" accept="image/*" capture="user" onChange={pick} />

      <Modal open={sheet === 'photo'} onClose={() => setSheet(null)} title="Profile photo">
        <button className="yh-act" onClick={() => fileRef.current?.click()}><ImageIcon size={22} />Choose from gallery</button>
        <button className="yh-act" onClick={() => camRef.current?.click()}><Camera size={22} />Take a photo</button>
        <button className="yh-act" onClick={() => go('/stories/new')}><CircleDot size={22} />Add to my story</button>
        <button className="yh-act" onClick={() => { setSheet(null); setViewer(true); }}><Eye size={22} />View photo</button>
      </Modal>

      <Modal open={sheet === 'name'} onClose={() => setSheet(null)} title={user?.name}>
        <p className="muted" style={{ margin: '-6px 0 10px' }}>@{handle}</p>
        <button className="yh-act" onClick={() => go('/profile/edit')}><Pencil size={22} />Edit profile</button>
        <button className="yh-act" onClick={() => { setSheet(null); share(); }}><Share2 size={22} />Share profile link</button>
        <button className="yh-act" onClick={copyHandle}><Copy size={22} />Copy username</button>
        <button className="yh-act" onClick={() => setSheet('logout')}><LogOut size={22} />Log out</button>
      </Modal>

      <Modal open={sheet === 'mood'} onClose={() => setSheet(null)} title="Current mood">
        <div className="mood-grid">
          {PRESETS.map(([e, t]) => <button key={t} className={`yp-chip ${draft.text === t && draft.emoji === e ? 'on' : ''}`} onClick={() => setDraft({ ...draft, emoji: e, text: t })}>{e} {t}</button>)}
        </div>
        <label className="input" style={{ marginTop: 12 }}>
          <span style={{ fontSize: 22 }}>{draft.emoji}</span>
          <input maxLength={40} placeholder="What's your mood?" aria-label="Mood text" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <small className="muted">{draft.text.length}/40</small>
        </label>
        <p className="yp-h" style={{ margin: '14px 2px 6px' }}>Clear after</p>
        <div className="yp-chips" role="radiogroup" aria-label="Clear after">
          {FOR.map(([k, l]) => <button key={k} role="radio" aria-checked={draft.dur === k} className={`yp-chip ${draft.dur === k ? 'on' : ''}`} onClick={() => setDraft({ ...draft, dur: k })}>{l}</button>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: moodOn ? '1fr 2fr' : '1fr', gap: 10, marginTop: 14 }}>
          {moodOn && <Button variant="outline" onClick={() => { setMood(null); setSheet(null); notify('Mood cleared'); }}>Clear</Button>}
          <Button onClick={saveMood}>Save mood</Button>
        </div>
      </Modal>

      <Modal open={sheet === 'logout'} onClose={() => setSheet(null)} title="Log out?">
        <p className="muted" style={{ marginBottom: 16 }}>You'll need to sign in again to read your messages.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button><Button variant="danger" onClick={() => { logout(); nav('/login', { replace: true }); }}>Log out</Button></div>
      </Modal>

      {viewer && (
        <div className="yh-viewer" role="dialog" aria-modal="true" aria-label="Profile photo" onClick={() => setViewer(false)}>
          <button className="yh-ib" aria-label="Close" onClick={() => setViewer(false)}><X size={24} /></button>
          <img src={user?.avatar} alt={user?.name} />
        </div>
      )}
    </div>
  );
}
export function EditProfile() {
  const nav = useNavigate();
  const { user, setUser } = useAuth();
  const notify = useUI((s) => s.notify);
  const fileRef = useRef(null); const camRef = useRef(null);
  const [photo, setPhoto] = useState(false);
  const [field, setField] = useState(null); // key of the row being edited
  const [val, setVal] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const handle = (user?.handle || '').replace(/^@/, '');
  const FIELDS = {
    name: { icon: User, label: 'Name', value: user?.name, hint: 'This is the name people see in chats and on your profile.', max: 25, check: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : '') },
    about: { icon: Info, label: 'About', value: user?.about, empty: 'Set About', hint: 'Tell people a little about you.', max: 160, area: true },
    phone: { icon: Phone, label: 'Phone', value: user?.phone, empty: 'Add phone number', hint: 'Include your country code, e.g. +91 98765 43210', max: 20, mode: 'tel' },
    handle: { icon: AtSign, label: 'Reserved username', value: handle, hint: '3–20 letters, numbers, . or _', max: 20, check: (v) => (/^[a-z0-9._]{3,20}$/i.test(v.replace(/^@/, '')) ? '' : 'Username: 3–20 letters, numbers, . or _') },
    links: { icon: Link2, label: 'Links', value: user?.links, empty: 'Add links', hint: 'Your Instagram, website or any link.', max: 80 },
  };
  const f = field ? FIELDS[field] : null;
  const open = (k) => { setVal(k === 'handle' ? handle : (user?.[k] || '')); setErr(''); setField(k); };
  const save = async () => {
    const v = val.trim(); const bad = f.check?.(v); if (bad) return setErr(bad);
    setBusy(true); setErr('');
    try { const u = await api.updateMe({ [field]: field === 'handle' ? v.replace(/^@/, '') : v }); setUser({ ...user, ...u }); notify(`${f.label} saved`); setField(null); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { const u = await api.uploadAvatar(file); setUser({ ...user, ...u }); notify('Profile photo updated'); } catch (er) { notify(errMsg(er)); }
    setPhoto(false);
  };
  return (
    <div className="screen yp">
      <header className="ep-head">
        <button className="yh-ib" aria-label="Back" onClick={() => (window.history.state && window.history.state.idx > 0 ? nav(-1) : nav('/profile', { replace: true }))}><ArrowLeft size={24} /></button>
        <h1>Profile</h1>
      </header>
      <div className="scroll yp-scroll">
        <div className="ep-photo">
          <button className="ep-av" aria-label="Change profile photo" onClick={() => setPhoto(true)}><img src={user?.avatar} alt={user?.name} /></button>
          <button className="ep-cam" aria-label="Change profile photo" onClick={() => setPhoto(true)}><Camera size={24} /></button>
        </div>
        <section className="yp-sec">
          {Object.entries(FIELDS).map(([k, r]) => {
            const I = r.icon; const empty = !r.value;
            return (
              <button key={k} className="yp-row ep-row" onClick={() => open(k)}>
                <span className="yp-ic"><I size={24} strokeWidth={1.9} /></span>
                <span className="yp-t"><b>{r.label}</b><small className={empty ? 'set' : ''}>{empty ? r.empty : r.value}</small></span>
              </button>
            );
          })}
        </section>
      </div>

      <input ref={fileRef} hidden type="file" accept="image/*" onChange={pick} />
      <input ref={camRef} hidden type="file" accept="image/*" capture="user" onChange={pick} />
      <Modal open={photo} onClose={() => setPhoto(false)} title="Profile photo">
        <button className="yh-act" onClick={() => fileRef.current?.click()}><ImageIcon size={22} />Choose from gallery</button>
        <button className="yh-act" onClick={() => camRef.current?.click()}><Camera size={22} />Take a photo</button>
      </Modal>

      <Modal open={!!f} onClose={() => setField(null)} title={f?.label}>
        {f && (
          <>
            <p className="muted" style={{ margin: '-4px 0 12px' }}>{f.hint}</p>
            {err && <div className="error-box" role="alert">{err}</div>}
            <label className={`input ${f.area ? 'textarea-box' : ''}`}>
              {f.area
                ? <textarea autoFocus rows={4} maxLength={f.max} aria-label={f.label} value={val} onChange={(e) => setVal(e.target.value)} />
                : <input autoFocus maxLength={f.max} inputMode={f.mode} aria-label={f.label} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />}
              <small className="muted">{val.length}/{f.max}</small>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <Button variant="outline" onClick={() => setField(null)}>Cancel</Button>
              <Button loading={busy} onClick={save}>Save</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// Old /settings/* links keep working: they now open the matching "You" page
export function SettingsPage() {
  const { section } = useParams();
  const to = { privacy: 'privacy', chat: 'chats', help: 'help' }[section] || 'privacy';
  return <Navigate to={`/you/${to}`} replace />;
}
