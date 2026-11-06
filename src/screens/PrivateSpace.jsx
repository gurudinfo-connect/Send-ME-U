import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreVertical, ArrowRight, Lock, Plus, Trash2, MapPin, LocateFixed, MessagesSquare, CalendarDays, Heart } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

// Location page: a live map (current position + shared live locations) plus the places the person saved with "+".
const parseCoords = (t) => { const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(t); if (!m) return null; const lat = +m[1], lng = +m[2]; return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null; };
async function geocode(q) {
  const c = parseCoords(q); if (c) return c;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    const j = await r.json();
    return j?.[0] ? { latitude: +j[0].lat, longitude: +j[0].lon } : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export function SavedLocations() {
  const notify = useUI((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const [gone, setGone] = useState(null);
  const load = async () => { try { setList(await api.places()); } catch { /* keep what we have */ } };
  useEffect(() => { load(); }, []);
  const save = async (b) => {
    setBusy(true);
    try {
      const pos = await geocode(b.address);          // lets the place appear as a pin when it can be found
      await api.addPlace({ ...b, ...(pos || {}) });
      setOpen(false); setName(''); setAddr(''); await load();
      notify(pos ? 'Location saved' : 'Location saved (not found on the map, shown in the list)');
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async (pl) => { try { await api.deletePlace(pl.id); setGone(null); await load(); notify('Place removed'); } catch (e) { notify(errMsg(e)); } };
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setAddr(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`), () => notify('Location unavailable'));
  const markers = useMemo(() => list.filter((l) => l.latitude != null && l.longitude != null).map((l) => ({ id: `place:${l.id}`, lat: l.latitude, lng: l.longitude, name: l.name, pin: true, live: false, dim: false })), [list]);
  const mapsUrl = (l) => `https://www.google.com/maps?q=${l.latitude != null ? `${l.latitude},${l.longitude}` : encodeURIComponent(l.address)}`;
  return (
    <>
      <LiveLocation title="Location" back="/private" fallback="/private" mapHeight="min(62vh, 520px)" extraMarkers={markers}
        onExtraMarker={(id) => { const l = list.find((x) => `place:${x.id}` === id); if (l) notify(`${l.name} · ${l.address}`); }}
        headerRight={<button className="icon-btn" aria-label="Add location" onClick={() => setOpen(true)}><Plus size={24} /></button>}>
        <div className="ll-card" aria-label="Saved places">
          <div className="ll-row"><span className="ll-ic"><MapPin size={20} /></span><span className="grow"><b>Saved places</b><small>{list.length ? `${list.length} saved` : 'Tap + to save a place'}</small></span></div>
          {list.map((l) => (
            <div key={l.id} className="ll-row" style={{ marginTop: 10 }}>
              <span className="grow"><b>{l.name}</b><small>{l.address}</small></span>
              <a className="btn btn-outline btn-sm" href={mapsUrl(l)} target="_blank" rel="noopener noreferrer">Open</a>
              <button className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setGone(l)}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
      </LiveLocation>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Save a place">
        <TextField placeholder="Name (e.g. Home)" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField placeholder="Address or coordinates" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <div style={{ display: 'grid', gap: 10 }}>
          <Button variant="outline" onClick={here}><LocateFixed size={18} /> Use my location</Button>
          <Button loading={busy} onClick={() => (name.trim() && addr.trim() ? save({ name: name.trim(), address: addr.trim() }) : notify('Add a name and an address'))}>Save place</Button>
        </div>
      </Modal>
      <Modal open={!!gone} onClose={() => setGone(null)} title="Remove this place?">
        <p className="muted" style={{ marginBottom: 14 }}>{gone?.name} will be removed from your saved places.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setGone(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => remove(gone)}>Remove</Button>
        </div>
      </Modal>
    </>
  );
}
