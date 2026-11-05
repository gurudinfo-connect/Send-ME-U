import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Star, Trash2, Plus, Check, X, Smartphone, Monitor, Tablet, Users, Megaphone, Send, Pencil, ChevronRight, ArrowUpRight, ArrowDownLeft, Search, Info, LogOut } from 'lucide-react';
import { AppHeader, Avatar, Button, Empty, ErrorState, ListSkeleton, Modal, TextField, useAsync, fmtTime } from '../components/ui';
import { api } from '../services/api';
import { useMenu, useUI } from '../store';

/* ---------- helpers ---------- */
const rid = () => Math.random().toString(36).slice(2, 9);
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date(); const y = new Date(); y.setDate(now.getDate() - 1);
  const t = fmtTime(iso);
  if (d.toDateString() === now.toDateString()) return `Today, ${t}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${t}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${t}`;
};
const dateOnly = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const rupee = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const preview = (m) => (m.type === 'image' ? '📷 Photo' : m.type === 'video' ? '🎥 Video' : m.type === 'voice' ? '🎤 Voice message' : m.text || 'Message');
const isGroup = (c) => c.type === 'group' || c.kind === 'groups';

// People you already chat with (broadcast recipients, payment contacts)
function useChats() {
  const r = useAsync(() => api.conversations({}), []);
  const all = (r.data || []).filter((c) => !c.locked && c.type !== 'couple');
  return { ...r, direct: all.filter((c) => !isGroup(c)), groups: all.filter(isGroup) };
}

function PickList({ items, selected, onToggle, empty }) {
  if (!items.length) return <p className="muted" style={{ padding: '12px 4px', textAlign: 'center' }}>{empty}</p>;
  return (
    <div className="mp-pick" role="group">
      {items.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button key={c.id} type="button" className={`mp-pick-row ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onToggle(c)}>
            <Avatar src={c.avatar} size={44} />
            <span className="grow">{c.name}</span>
            <span className="mp-check">{on && <Check size={16} strokeWidth={3} />}</span>
          </button>
        );
      })}
    </div>
  );
}

const Stack = ({ people, size = 40 }) => (
  <span className="mp-stack">{people.slice(0, 3).map((p) => <img key={p.id} src={p.avatar} alt="" style={{ width: size, height: size }} />)}</span>
);

const toggleIn = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

/* ---------- Starred messages ---------- */
export function Starred() {
  const nav = useNavigate();
  const starred = useMenu((s) => s.starred);
  const toggleStar = useMenu((s) => s.toggleStar);
  const clearStars = useMenu((s) => s.clearStars);
  const notify = useUI((s) => s.notify);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);
  const list = starred.filter((m) => `${preview(m)} ${m.convoName || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="Starred messages" right={starred.length > 0 ? <button className="icon-btn" aria-label="Unstar all" onClick={() => setConfirm(true)}><Trash2 size={22} /></button> : null} />
      {starred.length > 0 && (
        <div style={{ padding: '0 16px 8px' }}>
          <label className="input" style={{ borderRadius: 999, height: 44 }}><Search size={16} /><input placeholder="Search starred" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      )}
      <div className="scroll">
        {starred.length === 0 && <Empty icon={Star} title="No starred messages" text="Tap and hold any message in a chat, then choose Star message to keep it here." />}
        {starred.length > 0 && list.length === 0 && <Empty icon={Search} title="No matches" text="Try a different word." />}
        {list.map((m) => (
          <div key={m.id} className="mp-row">
            <button className="mp-row-main" onClick={() => nav(`/chats/${m.convoId}`)}>
              <Avatar src={m.avatar} size={46} />
              <span className="mp-meta">
                <span className="mp-top"><b>{m.from === 'me' ? `You → ${m.convoName || 'Chat'}` : m.convoName || 'Chat'}</b><small>{when(m.at || m.starredAt)}</small></span>
                <span className="mp-sub">{preview(m)}</span>
              </span>
            </button>
            <button className="icon-btn mp-star" aria-label="Remove star" onClick={() => { toggleStar(m); notify('Removed from starred'); }}><Star size={20} fill="currentColor" /></button>
          </div>
        ))}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Unstar all messages?">
        <p className="muted" style={{ marginBottom: 16 }}>The messages stay in their chats. Only the stars are removed.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { clearStars(); setConfirm(false); notify('All stars removed'); }}>Unstar all</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Broadcast lists ---------- */
export function Broadcasts() {
  const nav = useNavigate();
  const lists = useMenu((s) => s.broadcasts);
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="Broadcast lists" />
      <div className="scroll">
        {lists.length === 0 && <Empty icon={Megaphone} title="No broadcast lists yet" text="Send one message to many people at once. They get it as a normal chat message and replies arrive in your regular chats." />}
        {lists.map((b) => {
          const last = b.messages[b.messages.length - 1];
          return (
            <button key={b.id} className="mp-row-main mp-card" onClick={() => nav(`/broadcasts/${b.id}`)}>
              <Stack people={b.recipients} />
              <span className="mp-meta">
                <span className="mp-top"><b>{b.name}</b>{last && <small>{when(last.at)}</small>}</span>
                <span className="mp-sub">{last ? last.text : `${b.recipients.length} recipients`}</span>
              </span>
              <ChevronRight size={20} />
            </button>
          );
        })}
      </div>
      <div style={{ padding: '8px 16px calc(14px + var(--safe-bottom))' }}><Button onClick={() => nav('/broadcasts/new')}><Plus size={18} /> New list</Button></div>
    </div>
  );
}

export function BroadcastNew() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const addBroadcast = useMenu((s) => s.addBroadcast);
  const lists = useMenu((s) => s.broadcasts);
  const chats = useChats();
  const [name, setName] = useState('');
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState('');
  const shown = chats.direct.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const create = () => {
    if (sel.length < 2) return notify('Pick at least 2 recipients');
    const recipients = chats.direct.filter((c) => sel.includes(c.id)).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }));
    const b = addBroadcast({ name: name.trim() || `Broadcast list ${lists.length + 1}`, recipients });
    notify('Broadcast list created');
    nav(`/broadcasts/${b.id}`, { replace: true });
  };
  return (
    <div className="screen">
      <AppHeader back fallback="/broadcasts" title="New broadcast list" />
      <div className="scroll">
        <TextField placeholder="List name (optional)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="input" style={{ borderRadius: 999, height: 44, marginBottom: 10 }}><Search size={16} /><input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <p className="mp-label">People you chat with · {sel.length} selected</p>
        {chats.loading && <ListSkeleton n={3} />}
        {chats.error && <ErrorState message={chats.error} onRetry={chats.reload} />}
        {!chats.loading && !chats.error && <PickList items={shown} selected={sel} onToggle={(c) => setSel((s) => toggleIn(s, c.id))} empty="No chats to pick from yet. Start a chat first." />}
      </div>
      <div style={{ padding: '8px 16px calc(14px + var(--safe-bottom))' }}><Button disabled={sel.length < 2} onClick={create}>Create list ({sel.length})</Button></div>
    </div>
  );
}

export function BroadcastView() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const b = useMenu((s) => s.broadcasts.find((x) => x.id === id));
  const updateBroadcast = useMenu((s) => s.updateBroadcast);
  const deleteBroadcast = useMenu((s) => s.deleteBroadcast);
  const chats = useChats();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null); // 'more' | 'rename' | 'people' | 'delete'
  const [name, setName] = useState('');
  const [sel, setSel] = useState([]);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [b?.messages.length]);
  if (!b) return <div className="screen"><AppHeader back fallback="/broadcasts" title="Broadcast list" /><Empty icon={Megaphone} title="List not found" text="It may have been deleted." action={<Button className="btn-sm" onClick={() => nav('/broadcasts', { replace: true })}>Back to lists</Button>} /></div>;

  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true);
    const res = await Promise.allSettled(b.recipients.map((r) => api.sendMessage(r.id, { type: 'text', text: t })));
    const ok = res.filter((x) => x.status === 'fulfilled').length;
    updateBroadcast(b.id, (cur) => ({ messages: [...cur.messages, { id: rid(), text: t, at: new Date().toISOString(), sent: ok, total: res.length }] }));
    setText(''); setBusy(false);
    notify(ok === res.length ? `Sent to ${ok} ${ok === 1 ? 'person' : 'people'}` : `Delivered to ${ok} of ${res.length}`);
  };
  const openPeople = () => { setSel(b.recipients.map((r) => r.id)); setSheet('people'); };
  const savePeople = () => {
    if (sel.length < 2) return notify('Keep at least 2 recipients');
    const pool = [...chats.direct, ...b.recipients];
    const recipients = sel.map((i) => pool.find((c) => c.id === i)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }));
    updateBroadcast(b.id, { recipients }); setSheet(null); notify('Recipients updated');
  };
  const pickItems = [...chats.direct, ...b.recipients.filter((r) => !chats.direct.some((c) => c.id === r.id))];

  return (
    <div className="screen chat-bg">
      <AppHeader back fallback="/broadcasts" title={<span className="mp-title"><b>{b.name}</b><small>{b.recipients.length} recipients</small></span>} right={<button className="icon-btn" aria-label="List options" onClick={() => setSheet('more')}><Pencil size={20} /></button>} />
      <div className="mp-chips" aria-label="Recipients">{b.recipients.map((r) => <span key={r.id} className="mp-chip"><img src={r.avatar} alt="" />{r.name}</span>)}</div>
      <div className="msgs">
        {b.messages.length === 0 && <Empty icon={Megaphone} title="Broadcast to everyone" text={`Your message goes to ${b.recipients.length} people as a private chat message.`} />}
        {b.messages.map((m) => (
          <div key={m.id} className="mrow me">
            <div className="bubble out"><span>{m.text}</span><div className="time">Sent to {m.sent}/{m.total} · {fmtTime(m.at)}</div></div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <label className="input"><input placeholder="Broadcast a message…" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} /></label>
        <button className="mic" aria-label="Send broadcast" disabled={!text.trim() || busy} onClick={send}><Send size={24} /></button>
      </div>

      <Modal open={sheet === 'more'} onClose={() => setSheet(null)} title="List options">
        <button className="menu-row" onClick={() => { setName(b.name); setSheet('rename'); }}><Pencil size={18} /><span className="grow">Rename list</span></button>
        <button className="menu-row" onClick={openPeople}><Users size={18} /><span className="grow">Edit recipients</span></button>
        <button className="menu-row" style={{ color: '#ff4d6d' }} onClick={() => setSheet('delete')}><Trash2 size={18} /><span className="grow">Delete list</span></button>
      </Modal>
      <Modal open={sheet === 'rename'} onClose={() => setSheet(null)} title="Rename list">
        <TextField placeholder="List name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!name.trim()} onClick={() => { updateBroadcast(b.id, { name: name.trim() }); setSheet(null); }}>Save</Button>
      </Modal>
      <Modal open={sheet === 'people'} onClose={() => setSheet(null)} title="Recipients">
        <PickList items={pickItems} selected={sel} onToggle={(c) => setSel((s) => toggleIn(s, c.id))} empty="No chats to pick from." />
        <Button style={{ marginTop: 12 }} disabled={sel.length < 2} onClick={savePeople}>Save ({sel.length})</Button>
      </Modal>
      <Modal open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete this list?">
        <p className="muted" style={{ marginBottom: 16 }}>Messages already delivered stay in each person’s chat.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteBroadcast(b.id); notify('List deleted'); nav('/broadcasts', { replace: true }); }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Communities ---------- */
const EMOJIS = ['🏡', '💼', '🎓', '🎉', '🏏', '🎮', '🎵', '✈️', '📚', '💪', '🍕', '💙'];
const COLORS = ['#1d5cff', '#ff8a00', '#14c8b0', '#7a5cff', '#ff4d6d', '#2b2418'];
const CommIcon = ({ c, size = 52 }) => <span className="mp-ci" style={{ width: size, height: size, background: c.color, fontSize: size * 0.5 }} aria-hidden>{c.emoji}</span>;

export function Communities() {
  const nav = useNavigate();
  const list = useMenu((s) => s.communities);
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="Communities" />
      <div className="scroll">
        <button className="mp-row-main mp-card" onClick={() => nav('/communities/new')}>
          <span className="mp-ci mp-new" aria-hidden><Plus size={26} /></span>
          <span className="mp-meta"><span className="mp-top"><b>New community</b></span><span className="mp-sub">Bring related groups together</span></span>
        </button>
        {list.length === 0 && <Empty icon={Users} title="No communities yet" text="Create one to organise your groups under one roof." />}
        {list.map((c) => (
          <button key={c.id} className="mp-row-main mp-card" onClick={() => nav(`/communities/${c.id}`)}>
            <CommIcon c={c} />
            <span className="mp-meta"><span className="mp-top"><b>{c.name}</b></span><span className="mp-sub">{c.groups.length} {c.groups.length === 1 ? 'group' : 'groups'}</span></span>
            <ChevronRight size={20} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function CommunityNew() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const addCommunity = useMenu((s) => s.addCommunity);
  const count = useMenu((s) => s.communities.length);
  const chats = useChats();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [sel, setSel] = useState([]);
  const create = () => {
    if (name.trim().length < 2) return notify('Give the community a name');
    const groups = chats.groups.filter((g) => sel.includes(g.id)).map((g) => ({ id: g.id, name: g.name, avatar: g.avatar }));
    const c = addCommunity({ name: name.trim(), about: about.trim(), emoji, color, groups });
    notify('Community created');
    nav(`/communities/${c.id}`, { replace: true });
  };
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="New community" right={count > 0 ? <button className="btn-ghost" onClick={() => nav('/communities')}>My communities</button> : null} />
      <div className="scroll">
        <div className="mp-hero"><CommIcon c={{ emoji, color }} size={84} /></div>
        <div className="mp-picks" role="radiogroup" aria-label="Icon">{EMOJIS.map((e) => <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>)}</div>
        <div className="mp-picks" role="radiogroup" aria-label="Colour">{COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} className={`sw ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
        <TextField placeholder="Community name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field"><label className="input textarea-box"><textarea rows={3} maxLength={200} placeholder="What is this community about?" value={about} onChange={(e) => setAbout(e.target.value)} /></label></div>
        <p className="mp-label">Add your groups · {sel.length} selected</p>
        {chats.loading && <ListSkeleton n={2} />}
        {!chats.loading && <PickList items={chats.groups} selected={sel} onToggle={(g) => setSel((s) => toggleIn(s, g.id))} empty="You are not in any groups yet. You can add them later." />}
      </div>
      <div style={{ padding: '8px 16px calc(14px + var(--safe-bottom))' }}><Button disabled={name.trim().length < 2} onClick={create}>Create community</Button></div>
    </div>
  );
}

export function CommunityView() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const c = useMenu((s) => s.communities.find((x) => x.id === id));
  const updateCommunity = useMenu((s) => s.updateCommunity);
  const deleteCommunity = useMenu((s) => s.deleteCommunity);
  const chats = useChats();
  const [sheet, setSheet] = useState(null); // 'add' | 'delete'
  const [sel, setSel] = useState([]);
  if (!c) return <div className="screen"><AppHeader back fallback="/communities" title="Community" /><Empty icon={Users} title="Community not found" text="It may have been deleted." action={<Button className="btn-sm" onClick={() => nav('/communities', { replace: true })}>Back to communities</Button>} /></div>;
  const free = chats.groups.filter((g) => !c.groups.some((x) => x.id === g.id));
  const addGroups = () => {
    const add = free.filter((g) => sel.includes(g.id)).map((g) => ({ id: g.id, name: g.name, avatar: g.avatar }));
    updateCommunity(c.id, { groups: [...c.groups, ...add] }); setSheet(null); setSel([]);
    if (add.length) notify(`${add.length} ${add.length === 1 ? 'group' : 'groups'} added`);
  };
  return (
    <div className="screen">
      <AppHeader back fallback="/communities" title={c.name} right={<button className="icon-btn" aria-label="Delete community" onClick={() => setSheet('delete')}><Trash2 size={21} /></button>} />
      <div className="scroll">
        <div className="mp-hero"><CommIcon c={c} size={84} /><h2>{c.name}</h2>{c.about && <p className="muted">{c.about}</p>}<small className="muted">Created {dateOnly(c.createdAt)}</small></div>
        <p className="mp-label">Groups · {c.groups.length}</p>
        {c.groups.length === 0 && <p className="muted" style={{ padding: '4px 4px 12px' }}>No groups yet. Add the groups that belong here.</p>}
        {c.groups.map((g) => (
          <div key={g.id} className="mp-row">
            <button className="mp-row-main" onClick={() => nav(`/chats/${g.id}`)}><Avatar src={g.avatar} size={46} /><span className="mp-meta"><span className="mp-top"><b>{g.name}</b></span><span className="mp-sub">Tap to open</span></span></button>
            <button className="icon-btn" aria-label={`Remove ${g.name}`} onClick={() => { updateCommunity(c.id, { groups: c.groups.filter((x) => x.id !== g.id) }); notify('Group removed from community'); }}><X size={20} /></button>
          </div>
        ))}
        <Button variant="outline" style={{ marginTop: 10 }} onClick={() => { setSel([]); setSheet('add'); }}><Plus size={18} /> Add groups</Button>
      </div>
      <Modal open={sheet === 'add'} onClose={() => setSheet(null)} title="Add groups">
        <PickList items={free} selected={sel} onToggle={(g) => setSel((s) => toggleIn(s, g.id))} empty="All your groups are already here." />
        {free.length > 0 && <Button style={{ marginTop: 12 }} disabled={sel.length === 0} onClick={addGroups}>Add ({sel.length})</Button>}
      </Modal>
      <Modal open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete community?">
        <p className="muted" style={{ marginBottom: 16 }}>Your groups and their messages are not affected.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteCommunity(c.id); notify('Community deleted'); nav('/communities', { replace: true }); }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Linked devices ---------- */
function thisDevice() {
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'this device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { name: `${browser} on ${os}`, mobile: /Android|iPhone|iPod|Mobile/i.test(ua) };
}
const KIND_ICON = { phone: Smartphone, tablet: Tablet, computer: Monitor };
const fmtCode = (v) => { const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; };

export function LinkedDevices() {
  const notify = useUI((s) => s.notify);
  const devices = useMenu((s) => s.devices);
  const addDevice = useMenu((s) => s.addDevice);
  const removeDevice = useMenu((s) => s.removeDevice);
  const clearDevices = useMenu((s) => s.clearDevices);
  const [sheet, setSheet] = useState(null); // 'link' | {out: device} | 'all'
  const [kind, setKind] = useState('computer');
  const [dname, setDname] = useState('');
  const [code, setCode] = useState('');
  const me = thisDevice();
  const MeIcon = me.mobile ? Smartphone : Monitor;
  const link = () => {
    if (code.replace('-', '').length < 8) return notify('Enter the 8-character code');
    addDevice({ name: dname.trim() || ({ phone: 'Linked phone', tablet: 'Linked tablet', computer: 'Linked computer' })[kind], kind });
    setSheet(null); setCode(''); setDname(''); notify('Device linked');
  };
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="Linked devices" />
      <div className="scroll">
        <p className="mp-label">This device</p>
        <div className="mp-row-main mp-card" style={{ cursor: 'default' }}>
          <span className="mp-ci mp-dev"><MeIcon size={24} /></span>
          <span className="mp-meta"><span className="mp-top"><b>{me.name}</b></span><span className="mp-sub" style={{ color: '#14a06f' }}>● Active now</span></span>
        </div>
        <Button style={{ margin: '6px 0 4px' }} onClick={() => { setCode(''); setDname(''); setKind('computer'); setSheet('link'); }}><Plus size={18} /> Link a device</Button>
        <p className="mp-label">Linked devices</p>
        {devices.length === 0 && <Empty icon={Monitor} title="No linked devices" text="Use Send ME/U on a tablet or computer too. Link a device with the code it shows." />}
        {devices.map((d) => {
          const I = KIND_ICON[d.kind] || Monitor;
          return (
            <button key={d.id} className="mp-row-main mp-card" onClick={() => setSheet({ out: d })}>
              <span className="mp-ci mp-dev"><I size={24} /></span>
              <span className="mp-meta"><span className="mp-top"><b>{d.name}</b></span><span className="mp-sub">Linked {when(d.linkedAt)}</span></span>
              <LogOut size={18} />
            </button>
          );
        })}
        {devices.length > 1 && <Button variant="outline" style={{ marginTop: 8 }} onClick={() => setSheet('all')}>Log out from all devices</Button>}
        <p className="mp-note"><Info size={14} /> Device links are kept on this device for now. Connect a backend session endpoint to make logging out remote devices real.</p>
      </div>

      <Modal open={sheet === 'link'} onClose={() => setSheet(null)} title="Link a device">
        <p className="muted" style={{ marginBottom: 12 }}>Open Send ME/U on the other device and choose Link this device. Enter the 8-character code it shows.</p>
        <div className="mp-picks" role="radiogroup" aria-label="Device type">
          {[['computer', 'Computer'], ['phone', 'Phone'], ['tablet', 'Tablet']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={`tx ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <TextField placeholder="Device name (optional)" maxLength={30} value={dname} onChange={(e) => setDname(e.target.value)} />
        <TextField placeholder="XXXX-XXXX" autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(fmtCode(e.target.value))} />
        <Button disabled={code.replace('-', '').length < 8} onClick={link}>Link device</Button>
      </Modal>
      <Modal open={!!sheet?.out} onClose={() => setSheet(null)} title={`Log out ${sheet?.out?.name || ''}?`}>
        <p className="muted" style={{ marginBottom: 16 }}>This device will no longer be linked to your account.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { removeDevice(sheet.out.id); setSheet(null); notify('Device logged out'); }}>Log out</Button>
        </div>
      </Modal>
      <Modal open={sheet === 'all'} onClose={() => setSheet(null)} title="Log out all devices?">
        <p className="muted" style={{ marginBottom: 16 }}>Every linked device will be removed. This device stays signed in.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { clearDevices(); setSheet(null); notify('All devices logged out'); }}>Log out all</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Payments ---------- */
function PayForm({ mode, contacts, onClose }) {
  const notify = useUI((s) => s.notify);
  const addPayment = useMenu((s) => s.addPayment);
  const [to, setTo] = useState(contacts[0]?.id || null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = Math.round(Number(amount) * 100) / 100;
  const valid = to && amt > 0 && amt <= 100000;
  const submit = async () => {
    if (!valid || busy) return;
    const c = contacts.find((x) => x.id === to);
    setBusy(true);
    addPayment({ kind: mode, to: c.name, convoId: c.id, avatar: c.avatar, amount: amt, note: note.trim() });
    const line = mode === 'sent' ? `💸 Sent you ${rupee(amt)}` : `💰 Requesting ${rupee(amt)}`;
    try { await api.sendMessage(c.id, { type: 'text', text: note.trim() ? `${line} · ${note.trim()}` : line }); } catch { /* record is saved even if the chat message fails */ }
    setBusy(false); onClose();
    notify(mode === 'sent' ? `${rupee(amt)} recorded for ${c.name}` : `Request for ${rupee(amt)} sent to ${c.name}`);
  };
  return (
    <>
      <p className="mp-label" style={{ marginTop: 0 }}>{mode === 'sent' ? 'Pay to' : 'Request from'}</p>
      {contacts.length === 0 ? <p className="muted" style={{ padding: '8px 0 12px' }}>Start a chat with someone first.</p> : (
        <div className="mp-contacts" role="radiogroup" aria-label="Contact">
          {contacts.map((c) => <button key={c.id} type="button" role="radio" aria-checked={to === c.id} className={to === c.id ? 'on' : ''} onClick={() => setTo(c.id)}><Avatar src={c.avatar} size={52} /><span>{c.name}</span></button>)}
        </div>
      )}
      <label className="input mp-amount"><b>₹</b><input inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*$/, '$1'))} aria-label="Amount" /></label>
      {Number(amount) > 100000 && <p className="err" style={{ marginTop: 6 }}>Limit is ₹1,00,000 per entry.</p>}
      <TextField placeholder="Add a note (optional)" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button loading={busy} disabled={!valid} onClick={submit}>{mode === 'sent' ? 'Send' : 'Request'}{amt > 0 ? ` ${rupee(amt)}` : ''}</Button>
    </>
  );
}

export function Payments() {
  const notify = useUI((s) => s.notify);
  const payments = useMenu((s) => s.payments);
  const clearPayments = useMenu((s) => s.clearPayments);
  const chats = useChats();
  const [sheet, setSheet] = useState(null); // 'sent' | 'request' | 'clear'
  const now = new Date();
  const month = payments.filter((p) => { const d = new Date(p.at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const total = (k) => month.filter((p) => p.kind === k).reduce((a, p) => a + p.amount, 0);
  return (
    <div className="screen">
      <AppHeader back fallback="/home" title="Payments" right={payments.length > 0 ? <button className="icon-btn" aria-label="Clear history" onClick={() => setSheet('clear')}><Trash2 size={21} /></button> : null} />
      <div className="scroll">
        <div className="mp-sum">
          <div><small>Sent this month</small><b>{rupee(total('sent'))}</b></div>
          <div><small>Requested</small><b>{rupee(total('request'))}</b></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '12px 0' }}>
          <Button onClick={() => setSheet('sent')}><ArrowUpRight size={18} /> Send</Button>
          <Button variant="outline" onClick={() => setSheet('request')}><ArrowDownLeft size={18} /> Request</Button>
        </div>
        <p className="mp-note" style={{ marginTop: 0 }}><Info size={14} /> No real money moves yet. Entries here are saved as records and shared in the chat.</p>
        <p className="mp-label">History</p>
        {payments.length === 0 && <Empty icon={ArrowUpRight} title="No payments yet" text="Send or request an amount and it will show up here." />}
        {payments.map((p) => (
          <div key={p.id} className="mp-row">
            <div className="mp-row-main" style={{ cursor: 'default' }}>
              <Avatar src={p.avatar} size={46} />
              <span className="mp-meta"><span className="mp-top"><b>{p.kind === 'sent' ? `Paid to ${p.to}` : `Requested from ${p.to}`}</b></span><span className="mp-sub">{p.note ? `${p.note} · ` : ''}{when(p.at)}</span></span>
              <b className={`mp-amt ${p.kind}`}>{p.kind === 'sent' ? '−' : '+'}{rupee(p.amount)}</b>
            </div>
          </div>
        ))}
      </div>
      <Modal open={sheet === 'sent' || sheet === 'request'} onClose={() => setSheet(null)} title={sheet === 'sent' ? 'Send money' : 'Request money'}>
        {chats.loading ? <ListSkeleton n={1} /> : <PayForm mode={sheet === 'sent' ? 'sent' : 'request'} contacts={chats.direct} onClose={() => setSheet(null)} />}
      </Modal>
      <Modal open={sheet === 'clear'} onClose={() => setSheet(null)} title="Clear payment history?">
        <p className="muted" style={{ marginBottom: 16 }}>This removes the records on this device. Chat messages stay.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { clearPayments(); setSheet(null); notify('History cleared'); }}>Clear</Button>
        </div>
      </Modal>
    </div>
  );
}
