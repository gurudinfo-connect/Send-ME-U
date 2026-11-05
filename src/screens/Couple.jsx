import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Image as Img, BookOpen, Target, Heart, ChevronRight, Plus, Trash2, Upload, Link2, Check, MapPin } from 'lucide-react';
import { Avatar, AppHeader, Button, TextField, Modal, Empty, ErrorState, ListSkeleton, Skeleton, useAsync, daysUntil } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useAuth, useUI } from '../store';
import { sceneArt } from '../data/art';
import { CoupleCalendar } from './CoupleCalendar';

const dayDiff = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));

const CoupleArt = () => (
  <svg className="couple-art" viewBox="0 0 430 230" preserveAspectRatio="xMidYMax slice" aria-hidden>
    <defs>
      <linearGradient id="cs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ddff" stopOpacity="0" /><stop offset=".55" stop-color="#c9b4ff" /><stop offset="1" stop-color="#ff9fcf" /></linearGradient>
      <linearGradient id="ch1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5af0" /><stop offset="1" stop-color="#4b2fc0" /></linearGradient>
      <linearGradient id="ch2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3fd6" /><stop offset="1" stop-color="#2d1b86" /></linearGradient>
    </defs>
    <rect width="430" height="230" fill="url(#cs)" />
    <circle cx="300" cy="86" r="30" fill="#fff" opacity=".55" />
    <path d="M0 150 L70 104 L130 142 L200 92 L280 148 L350 108 L430 150 V230 H0Z" fill="url(#ch1)" opacity=".75" />
    <path d="M0 184 C80 150 150 170 220 168 C300 166 360 150 430 178 V230 H0Z" fill="url(#ch2)" />
    <g fill="#1d1250">
      <circle cx="198" cy="148" r="11" /><path d="M180 186 c0-22 8-34 18-34 s18 12 18 34z" />
      <circle cx="226" cy="150" r="10" /><path d="M210 186 c0-20 7-31 16-31 s16 11 16 31z" />
    </g>
    <path d="M212 126c-4-6-12-2-9 5 2 4 9 8 9 8s7-4 9-8c3-7-5-11-9-5z" fill="#ff8a00" />
  </svg>
);

export function Couple() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const c = useAsync(() => api.couple(), []);
  const rows = [
    ['Live Location', MapPin, '#e2ecff', '#2f6bff', '/private/couple/location'],
    ['Private Journal', BookOpen, '#e9e2ff', '#1236c9', '/private/couple/journal'],
    ['Shared Gallery', Img, '#e2ecff', '#2f6bff', '/private/couple/gallery'],
    ['Goals & Plans', Target, '#e9e2ff', '#1236c9', '/private/couple/goals'],
  ];
  return (
    <div className="screen" style={{ background: 'var(--grad-soft)' }}>
      <AppHeader back fallback="/private" title={<>Our Couple Space <Heart size={18} color="#ff4d6d" fill="#ff4d6d" /></>} />
      <div className="scroll">
        {c.loading && <Skeleton h={220} />}
        {c.error && <ErrorState message={c.error} onRetry={c.reload} />}
        {c.data && (
          c.data.partner ? (
            <>
              <div className="couple-hero">
                <div className="center"><Avatar src={c.data.partner.avatar} size={92} /><div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>{c.data.partner.name}</div></div>
                <Heart size={30} color="#ff4d6d" fill="#ff4d6d" style={{ margin: '-24px -10px 0', zIndex: 2 }} />
                <div className="center"><Avatar src={user?.avatar} size={92} /><div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>{user?.name}</div></div>
              </div>
              <div className="together"><span className="muted" style={{ fontSize: 13 }}>Together for</span><b>{dayDiff(c.data.startDate)} Days</b>
                <span className="muted" style={{ fontSize: 12 }}>Anniversary in {daysUntil(c.data.anniversary)} days 🎉</span></div>
              <CoupleCalendar partner={c.data.partner} />
            </>
          ) : (
            <Empty icon={Heart} title="Link your partner" text="Invite your partner to share a private space." action={<Button className="btn-sm" onClick={() => nav('/private/couple/invite')}>Invite partner</Button>} />
          )
        )}
        {rows.map(([l, I, bg, fg, to]) => (
          <button key={l} className="menu-row" onClick={() => nav(to)}><span className="ic" style={{ background: bg, color: fg }}><I size={20} /></span><span className="grow">{l}</span><ChevronRight size={18} color="var(--muted)" /></button>
        ))}
        <button className="menu-row" onClick={() => nav('/private/couple/invite')}><span className="ic" style={{ background: '#ffe1ec', color: '#ff8a00' }}><Link2 size={20} /></span><span className="grow">Invitations & linking</span><ChevronRight size={18} color="var(--muted)" /></button>
        <CoupleArt />
      </div>
    </div>
  );
}

export function Journal() {
  const notify = useUI((s) => s.notify);
  const j = useAsync(() => api.journal(), []);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const save = async () => {
    if (!title.trim() || !body.trim()) return notify('Add a title and some words');
    try { const e = await api.addJournal({ title, body }); j.setData((d) => [e, ...d]); setOpen(false); setTitle(''); setBody(''); } catch (e) { notify(errMsg(e)); }
  };
  const del = async (id) => { try { await api.deleteJournal(id); j.setData((d) => d.filter((x) => x.id !== id)); } catch (e) { notify(errMsg(e)); } };
  return (
    <div className="screen">
      <AppHeader back fallback="/private/couple" title="Private Journal" right={<button className="icon-btn" aria-label="New entry" onClick={() => setOpen(true)}><Plus size={22} /></button>} />
      <div className="scroll">
        {j.loading && <ListSkeleton n={3} />}
        {j.error && <ErrorState message={j.error} onRetry={j.reload} />}
        {j.data?.length === 0 && <Empty icon={BookOpen} title="No entries yet" text="Write your first private note." />}
        {(j.data || []).map((e) => (
          <div key={e.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{e.title}</b><button aria-label="Delete entry" onClick={() => del(e.id)}><Trash2 size={16} color="#ff4d6d" /></button></div>
            <p className="muted" style={{ margin: '4px 0 6px', fontSize: 13.5 }}>{e.body}</p><small className="muted">{e.date}</small>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New entry">
        <TextField placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="field"><label className="input textarea-box"><textarea rows={5} placeholder="Write something…" value={body} onChange={(e) => setBody(e.target.value)} /></label></div>
        <Button onClick={save}>Save entry</Button>
      </Modal>
    </div>
  );
}

export function SharedGallery() {
  const notify = useUI((s) => s.notify);
  const m = useAsync(() => api.media({ album: 'Couple' }), []);
  const f = useRef(null);
  const up = async (e) => { const file = e.target.files?.[0]; if (!file) return; try { const r = await api.uploadMedia(file, 'Couple'); m.setData((d) => [r, ...d]); notify('Added to shared gallery'); } catch (er) { notify(errMsg(er)); } };
  return (
    <div className="screen">
      <AppHeader back fallback="/private/couple" title="Shared Gallery" right={<button className="icon-btn" aria-label="Upload" onClick={() => f.current.click()}><Upload size={22} /></button>} />
      <input ref={f} type="file" accept="image/*,video/*" hidden onChange={up} />
      <div className="scroll">
        {m.loading && <ListSkeleton n={2} />}
        {m.error && <ErrorState message={m.error} onRetry={m.reload} />}
        {m.data?.length === 0 && <Empty icon={Img} title="Nothing shared yet" text="Upload photos for just the two of you." />}
        <div className="masonry">{(m.data || []).map((x) => <div key={x.id} className="tile"><img src={x.src} alt="" /></div>)}</div>
      </div>
    </div>
  );
}

export function Goals() {
  const notify = useUI((s) => s.notify);
  const g = useAsync(() => api.goals(), []);
  const [t, setT] = useState('');
  const add = async () => { if (!t.trim()) return; try { const r = await api.addGoal({ title: t }); g.setData((d) => [...d, r]); setT(''); } catch (e) { notify(errMsg(e)); } };
  const tog = async (id) => { g.setData((d) => d.map((x) => (x.id === id ? { ...x, done: !x.done } : x))); try { await api.toggleGoal(id); } catch (e) { notify(errMsg(e)); g.reload(); } };
  const del = async (id) => { g.setData((d) => d.filter((x) => x.id !== id)); try { await api.deleteGoal(id); } catch (e) { notify(errMsg(e)); g.reload(); } };
  const done = (g.data || []).filter((x) => x.done).length;
  return (
    <div className="screen">
      <AppHeader back fallback="/private/couple" title="Goals & Plans" />
      <div className="scroll">
        <div className="together"><b className="grad-text">{done}/{g.data?.length || 0}</b><span className="muted">goals achieved together</span></div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <label className="input" style={{ flex: 1 }}><input placeholder="Add a new goal…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          <button className="mic" aria-label="Add goal" onClick={add} style={{ background: 'var(--grad-btn)' }}><Plus size={22} /></button>
        </div>
        {g.loading && <ListSkeleton n={3} />}
        {g.error && <ErrorState message={g.error} onRetry={g.reload} />}
        {(g.data || []).map((x) => (
          <div key={x.id} className="menu-row">
            <button aria-label={x.done ? 'Mark not done' : 'Mark done'} onClick={() => tog(x.id)} style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid var(--blue)', background: x.done ? 'var(--blue)' : 'transparent', display: 'grid', placeItems: 'center', color: '#fff' }}>{x.done && <Check size={14} />}</button>
            <span className="grow" style={{ textDecoration: x.done ? 'line-through' : 'none', opacity: x.done ? .6 : 1 }}>{x.title}</span>
            <button aria-label="Delete goal" onClick={() => del(x.id)}><Trash2 size={16} color="#ff4d6d" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Invite() {
  const notify = useUI((s) => s.notify);
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const code = 'SMU-' + (useAuth.getState().user?.id || 'u0').toUpperCase() + '-2026';
  const send = async () => {
    if (!v.trim()) return notify('Enter their email or phone');
    setBusy(true);
    try { await api.invitePartner({ identifier: v }); notify('Invitation sent ❤️'); setV(''); } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="screen soft-screen">
      <AppHeader back fallback="/private/couple" title="Invite partner" />
      <div className="scroll">
        <div className="center" style={{ margin: '10px 0 20px' }}><Heart size={64} color="#ff4d6d" fill="#ff4d6d" className="float" /></div>
        <p className="muted center" style={{ marginBottom: 18 }}>Link accounts to unlock your private couple space: shared gallery, journal, goals and countdowns.</p>
        <TextField placeholder="Partner's email or phone" value={v} onChange={(e) => setV(e.target.value)} />
        <Button loading={busy} onClick={send}>Send invitation</Button>
        <div className="divider">or share your link code</div>
        <div className="card center" style={{ padding: 16 }}><b style={{ letterSpacing: 1 }}>{code}</b>
          <Button variant="outline" className="btn-sm" style={{ margin: '10px auto 0' }} onClick={() => { navigator.clipboard?.writeText(code); notify('Code copied'); }}>Copy code</Button></div>
      </div>
    </div>
  );
}
