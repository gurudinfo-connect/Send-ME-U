import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreVertical, ArrowRight, Lock, Plus, Trash2, MapPin, LocateFixed, MessagesSquare, CalendarDays, Heart } from 'lucide-react';
import { useState } from 'react';
import { BrandLogo, AppHeader, useGoBack, Button, TextField, Modal, Empty, ListSkeleton, ErrorState, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI, usePrivate } from '../store';
import { LockSettings } from './PrivateLock';
import LiveLocation from './LiveLocation';

const CARDS = [
  { to: '/private/locked', title: 'Locked Chats', text: 'Keep private conversations secure', Icon: MessagesSquare, tone: 'violet' },
  { to: '/calendar', title: 'Calendar', text: 'Plan and manage your events', Icon: CalendarDays, tone: 'sky' },
  { to: '/private/couple', title: 'Couple Calendar', text: 'Share special moments with your partner', Icon: Heart, tone: 'rose' },
  { to: '/private/locations', title: 'Location', text: 'See where you are and share live location', Icon: MapPin, tone: 'teal' },
];

// Private Space hub (opened from the Chats tab)
export default function PrivateSpace() {
  const nav = useNavigate();
  const goBack = useGoBack('/home');
  const notify = useUI((s) => s.notify);
  const [lockOpen, setLockOpen] = useState(false);
  const convos = useAsync(() => api.conversations({}), []);
  const couple = (convos.data || []).find((c) => c.type === 'couple');
  return (
    <div className="screen ps">
      <div className="ps-bar">
        <button className="rbtn" aria-label="Back" onClick={goBack}><ArrowLeft size={24} /></button>
        <h1 className="ps-bar-title">Private Space</h1>
        <button className="rbtn" aria-label="Private Space lock settings" onClick={() => setLockOpen(true)}><MoreVertical size={22} /></button>
      </div>
      <div className="ps-grid">
        {CARDS.map((c) => (
          <button key={c.to} className="ps-card" onClick={() => nav(c.to)}>
            <span className="ps-ic" aria-hidden><c.Icon size={22} /></span>
            <b>{c.title}</b>
            <span className="d">{c.text}</span>
            <span className="go" aria-hidden><ArrowRight size={18} /></span>
          </button>
        ))}
      </div>
      {couple && (
        <button className="ps-couple" onClick={() => nav('/private/couple')}>
          <img className="av" src={couple.avatar} alt="" />
          <span className="meta">
            <span className="nm">{couple.name} <span aria-label="heart">❤️</span></span>
            <span className="ls">{couple.last}</span>
          </span>
          <span className="rt">{couple.time}</span>
        </button>
      )}
      <div className="ps-foot"><button aria-label="Lock Private Space" onClick={() => { usePrivate.getState().lock(); notify('Private Space locked'); nav('/home', { replace: true }); }}><Lock size={28} fill="currentColor" /></button></div>
      <LockSettings open={lockOpen} onClose={() => setLockOpen(false)} />
    </div>
  );
}

export function LockedChats() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const convos = useAsync(() => api.conversations({}), []);
  const list = (convos.data || []).filter((c) => c.locked);
  const unlock = async (c) => { try { await api.lockChat(c.id, false); convos.reload(); notify('Chat moved back to Chats'); } catch (e) { notify(errMsg(e)); } };
  return (
    <div className="screen aurora">
      <AppHeader back="/private" title="Locked Chats" />
      <div className="scroll" style={{ padding: 0 }}>
        {convos.loading && <div style={{ padding: '0 18px' }}><ListSkeleton n={2} /></div>}
        {convos.error && <ErrorState message={convos.error} onRetry={convos.reload} />}
        {!convos.loading && !convos.error && list.length === 0 && <Empty icon={Lock} title="No locked chats" text="Open a chat, tap the menu and choose Lock chat to move it here." />}
        {list.map((c) => (
          <div key={c.id} className="chat-row">
            <img className="av" src={c.avatar} alt="" onClick={() => nav(`/chats/${c.id}`)} />
            <span className="meta" onClick={() => nav(`/chats/${c.id}`)}><span className="nm">{c.name}</span><span className="ls" style={{ display: 'block' }}>Locked</span></span>
            <button className="pill-cta" onClick={() => unlock(c)}>Unlock</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Location page: a live map (current position + shared live locations). "+" still saves a place through the existing places API.
export function SavedLocations() {
  const notify = useUI((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (b) => {
    setBusy(true);
    try { await api.addPlace(b); setOpen(false); setName(''); setAddr(''); notify('Location saved'); }
    catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setAddr(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`), () => notify('Location unavailable'));
  return (
    <>
      <LiveLocation title="Location" back="/private" fallback="/private" mapHeight="min(62vh, 520px)"
        headerRight={<button className="icon-btn" aria-label="Add location" onClick={() => setOpen(true)}><Plus size={24} /></button>} />
      <Modal open={open} onClose={() => setOpen(false)} title="Save a place">
        <TextField placeholder="Name (e.g. Home)" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField placeholder="Address or coordinates" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <div style={{ display: 'grid', gap: 10 }}>
          <Button variant="outline" onClick={here}><LocateFixed size={18} /> Use my location</Button>
          <Button loading={busy} onClick={() => (name.trim() && addr.trim() ? save({ name: name.trim(), address: addr.trim() }) : notify('Add a name and an address'))}>Save place</Button>
        </div>
      </Modal>
    </>
  );
}
