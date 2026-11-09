import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Video, Phone, MoreVertical, Smile, Paperclip, Mic, Send, Play, Pause, Check, CheckCheck, Image as Img, Camera, MapPin, Trash2, X, Users, Search, Forward, Lock, ArrowLeft, Heart, Star, BellOff, ChevronUp, ChevronDown, Check as Tick } from 'lucide-react';
import { AppHeader, Avatar, Modal, Button, ErrorState, Empty, ListSkeleton, fmtTime, useAsync, TextField, DropMenu, GlassTabs, ProfilePreview } from '../components/ui';
import { api, errMsg } from '../services/api';
import { getSocket, emitTyping, joinRoom, leaveRoom } from '../services/socket';
import { useUI, useMenu, useChatPrefs, isMuted } from '../store';
import { useStreak, useStreakEvents } from '../streaks/hooks';
import { StreakBar, Celebration, shareMilestoneCard } from '../streaks/components';

const EMOJI = ['😀', '😍', '😂', '😊', '😢', '😮', '👍', '🙏', '🎉', '🔥', '❤️', '💜'];
const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const BARS = [8, 16, 11, 20, 14, 22, 10, 18, 12, 20, 9, 15, 21, 11, 17, 8, 14, 19, 10, 13];

export const WALLS = [
  { k: 'default', l: 'Default' },
  { k: 'sky', l: 'Sky', light: '#e8f2ff', dark: '#08121f' }, { k: 'blush', l: 'Blush', light: '#fdeef2', dark: '#1d0b11' },
  { k: 'mint', l: 'Mint', light: '#e6f7ef', dark: '#071a12' }, { k: 'sand', l: 'Sand', light: '#f6efe0', dark: '#1a1508' },
  { k: 'lilac', l: 'Lilac', light: '#f0eafd', dark: '#120c20' },
];
export const MUTES = [['8 hours', 8 * 3600e3], ['1 week', 7 * 86400e3], ['Always', -1]];
export const REASONS = ['Spam', 'Harassment or bullying', 'Inappropriate content', 'Fake account or scam', 'Something else'];
const URL_RE = /https?:\/\/[^\s]+/gi;

const Ticks = ({ status }) => status === 'read' || status === 'delivered' ? <CheckCheck size={17} /> : <Check size={16} />;

function VoiceNote({ m, mine }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef(null);
  const toggle = () => {
    if (m.src) { const a = (ref.current ||= new Audio(m.src)); playing ? a.pause() : a.play(); a.onended = () => setPlaying(false); }
    else setTimeout(() => setPlaying(false), 3000);
    setPlaying(!playing);
  };
  return (
    <div className="voice">
      <button className="play" aria-label={playing ? 'Pause' : 'Play voice message'} onClick={toggle}>{playing ? <Pause size={14} /> : <Play size={14} fill="#fff" />}</button>
      <div className="wave">{BARS.map((h, i) => <i key={i} style={{ height: h, background: mine ? '#fff' : '#1236c9', opacity: playing && i % 2 ? 0.6 : 1 }} />)}</div>
      <span style={{ fontSize: 12 }}>{m.duration}</span>
    </div>
  );
}

// A reaction / reply to a story, shown in the chat with that person
function StoryRef({ m }) {
  const reaction = m.kind === 'reaction';
  const head = m.story?.owner === 'mine' ? (reaction ? 'Reacted to your story' : 'Replied to your story') : (reaction ? 'You reacted to their story' : 'You replied to their story');
  return (
    <div className="story-ref" aria-label={head}>
      <div className="story-ref-top">
        {m.story?.src && <img src={m.story.src} alt="Story" />}
        <span><Heart size={13} fill="currentColor" /> {head}</span>
      </div>
      {reaction ? <span className="story-ref-emoji">{m.emoji || '❤️'}</span> : <span>{m.text}</span>}
    </div>
  );
}

function Bubble({ m, avatar, starred, mark, onLongPress, onOpen }) {
  const mine = m.from === 'me';
  const timer = useRef();
  const down = () => { timer.current = setTimeout(() => onLongPress(m), 450); };
  const up = () => clearTimeout(timer.current);
  const isMedia = m.type === 'video' || m.type === 'image';
  const short = m.type === 'text' && m.text.length < 34;
  const cls = `bubble ${mine ? 'out' : 'in'} ${isMedia ? 'media-card' : ''} ${short ? 'inline-time' : ''}`;
  return (
    <div className={`mrow ${mine ? 'me' : ''} ${mark ? `mk-${mark}` : ''}`} data-mid={m.id} style={m.reaction ? { marginBottom: 10 } : undefined}>
      {!mine && <img className="mav" src={avatar} alt="" />}
      <div className={cls} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onContextMenu={(e) => { e.preventDefault(); onLongPress(m); }}>
        {m.type === 'text' && <span>{m.text}</span>}
        {m.type === 'story' && <StoryRef m={m} />}
        {m.type === 'voice' && <VoiceNote m={m} mine={mine} />}
        {m.type === 'image' && <img className="media" src={m.src} alt="Shared" onClick={() => onOpen(m)} />}
        {m.type === 'video' && (
          <div style={{ position: 'relative' }} onClick={() => onOpen(m)}>
            {m.src?.startsWith('blob:') ? <video className="media" src={m.src} /> : <img className="media" src={m.src} alt="Video" />}
            {!m.hasPlay && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(255,255,255,.25)', display: 'grid', placeItems: 'center', border: '3px solid #fff' }}><Play size={26} color="#fff" fill="#fff" /></span></span>}
            <span className="media-meta"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Video size={18} fill="#fff" />{m.duration}</span><span>{fmtTime(m.at)}</span></span>
          </div>
        )}
        {!isMedia && <div className="time">{starred && <Star size={12} fill="currentColor" aria-label="Starred" />}{fmtTime(m.at)}{mine && <Ticks status={m.status} />}</div>}
        {m.reaction && <span className="react">{m.reaction}</span>}
      </div>
      {isMedia && !mine && <button className="fwd" aria-label="Forward" onClick={() => onOpen(m)}><Forward size={20} /></button>}
    </div>
  );
}

export function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const readReceipts = useUI((s) => s.settings.readReceipts);
  const convo = useAsync(() => api.conversation(id), [id]);
  const streak = useStreak(id);
  const [cel, setCel] = useState(null);
  const inputRef = useRef(null);
  useStreakEvents((d) => { // real-time: both friends see counts, ticks and celebrations as they happen
    const ev = d.events || [];
    const m = ev.find((e) => e.type === 'milestone');
    const n = ev.find((e) => e.type === 'started' || e.type === 'incremented');
    if (m) setCel({ count: m.days, milestone: true }); else if (n) setCel({ count: n.count });
  }, id);
  const [msgs, setMsgs] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [typing, setTyping] = useState(false);
  const [rec, setRec] = useState(null); // {secs}
  const [react, setReact] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dd, setDd] = useState(false);
  const [pv, setPv] = useState(null); // rect of the tapped header avatar while the photo viewer is open
  const [sub, setSub] = useState('main');
  const [sp, setSp] = useSearchParams();
  const [sheet, setSheet] = useState(sp.get('media') === '1' ? 'media' : null); // contact | report | block | mute | theme | media | clear
  const [searching, setSearching] = useState(sp.get('search') === '1');
  const [sq, setSq] = useState('');
  const [hit, setHit] = useState(0);
  const [mtab, setMtab] = useState('media');
  const [cName, setCName] = useState(''); const [cPhone, setCPhone] = useState('');
  const [reason, setReason] = useState(REASONS[0]); const [alsoBlock, setAlsoBlock] = useState(false);
  const theme = useUI((s) => s.theme);
  const pref = useChatPrefs((s) => s.prefs[id]) || {};
  const setPref = useChatPrefs((s) => s.setPref);
  const closeMenu = useCallback(() => { setDd(false); setSub('main'); }, []);
  const starred = useMenu((s) => s.starred);
  const toggleStar = useMenu((s) => s.toggleStar);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const fileKind = useRef('image');
  const typingTimer = useRef();
  const mediaRec = useRef(null);
  const chunks = useRef([]);
  const stick = useRef(true);

  const load = useCallback(async (p) => {
    try {
      const r = await api.messages(id, p);
      const items = r.items || r;
      setMsgs((cur) => (p === 1 ? items : [...items, ...cur]));
      setHasMore(!!r.hasMore); setPage(p); setError('');
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setLoading(true); load(1); }, [load]);

  // real-time
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    joinRoom(id);
    const onNew = (m) => { if (m.conversationId === id || !m.conversationId) { setMsgs((c) => [...c, m]); stick.current = true; } };
    const onStatus = ({ id: mid, status }) => setMsgs((c) => c.map((m) => (m.id === mid ? { ...m, status } : m)));
    const onTyping = ({ conversationId, on }) => conversationId === id && setTyping(on);
    const onReact = ({ messageId, emoji: e }) => setMsgs((c) => c.map((m) => (m.id === messageId ? { ...m, reaction: e } : m)));
    s.on('message:new', onNew); s.on('message:status', onStatus); s.on('typing', onTyping); s.on('message:reaction', onReact);
    return () => { leaveRoom(id); s.off('message:new', onNew); s.off('message:status', onStatus); s.off('typing', onTyping); s.off('message:reaction', onReact); };
  }, [id]);

  useEffect(() => { if (stick.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, typing]);
  const onScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && hasMore && !loading) { setLoading(true); load(page + 1); }
  };

  const send = async () => {
    const t = text.trim(); if (!t) return;
    setText(''); setEmoji(false); emitTyping(id, false); stick.current = true;
    try { const m = await api.sendMessage(id, { type: 'text', text: t }); setMsgs((c) => [...c, m]); simulateReply(); }
    catch (e) { setText(t); notify(errMsg(e)); }
  };
  // demo-mode nicety so typing/real-time UI is visible without a backend
  const simulateReply = () => {
    if (getSocket()) return;
    setTimeout(() => setTyping(true), 600);
    setTimeout(() => { setTyping(false); const rid = Math.random().toString(36).slice(2); setMsgs((c) => [...c.map((m) => ({ ...m, status: m.from === 'me' ? 'read' : m.status })), { id: rid, from: 'them', type: 'text', text: 'Love that! 💜', at: new Date().toISOString() }]); if (convo.data?.friendId) api.recordStreakActivity(id, { id: rid, userId: convo.data.friendId, kind: 'text', text: 'Love that! 💜' }).catch(() => {}); }, 2400);
  };
  const onType = (v) => {
    setText(v); emitTyping(id, true);
    clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => emitTyping(id, false), 1500);
  };

  const pick = (kind) => { fileKind.current = kind; setMenu(false); fileRef.current.accept = kind === 'video' ? 'video/*' : 'image/*'; if (kind === 'camera') fileRef.current.setAttribute('capture', 'environment'); else fileRef.current.removeAttribute('capture'); fileRef.current.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const type = f.type.startsWith('video') ? 'video' : 'image';
    try { const m = await api.sendMedia(id, f, type); setMsgs((c) => [...c, m]); stick.current = true; } catch (er) { notify(errMsg(er)); }
  };

  // voice recording
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec((r) => r && { ...r, secs: r.secs + 1 }), 1000);
    return () => clearInterval(t);
  }, [rec ? 1 : 0]); // eslint-disable-line
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.start(); mediaRec.current = mr; setRec({ secs: 0 });
    } catch { notify('Microphone permission is needed to record'); }
  };
  const stopRec = (cancel) => {
    const mr = mediaRec.current; const secs = rec?.secs || 0; setRec(null);
    if (!mr) return;
    mr.onstop = async () => {
      mr.stream.getTracks().forEach((t) => t.stop());
      if (cancel || secs < 1) return;
      const file = new File(chunks.current, 'voice.webm', { type: 'audio/webm' });
      try { const m = await api.sendMedia(id, file, 'voice'); m.duration = `0:${String(secs).padStart(2, '0')}`; setMsgs((c) => [...c, m]); } catch (er) { notify(errMsg(er)); }
    };
    mr.stop();
  };

  const doReact = async (emo) => {
    const m = react; setReact(null);
    setMsgs((c) => c.map((x) => (x.id === m.id ? { ...x, reaction: emo } : x)));
    try { await api.react(id, m.id, emo); } catch (e) { notify(errMsg(e)); }
  };

  const c = convo.data;
  const direct = c && c.type !== 'group' && c.type !== 'couple';
  const muted = isMuted(pref);
  const blocked = !!pref.blocked;
  const wall = WALLS.find((w) => w.k === pref.wall && w.light);
  const needle = sq.trim().toLowerCase();
  const matches = needle ? msgs.filter((m) => m.type === 'text' && m.text.toLowerCase().includes(needle)).map((m) => m.id) : [];
  useEffect(() => { setHit(Math.max(0, matches.length - 1)); }, [needle, matches.length]); // eslint-disable-line
  useEffect(() => {
    if (!searching || !matches.length) return;
    stick.current = false;
    listRef.current?.querySelector(`[data-mid="${matches[hit]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hit, searching, matches.length]); // eslint-disable-line
  const step = (d) => matches.length && setHit((h) => (h + d + matches.length) % matches.length);
  useEffect(() => { if (sp.get('search') === '1' || sp.get('media') === '1') setSp({}, { replace: true }); }, []); // eslint-disable-line
  const closeSearch = () => { setSearching(false); setSq(''); };

  const openContact = () => { setCName(pref.contact?.name || c?.name || ''); setCPhone(pref.contact?.phone || ''); setSheet('contact'); };
  const saveContact = () => { if (!cName.trim()) return; setPref(id, { contact: { name: cName.trim(), phone: cPhone.trim() } }); setSheet(null); notify('Saved to contacts'); };
  const sendReport = () => { setPref(id, { reported: true, ...(alsoBlock ? { blocked: true } : {}) }); setSheet(null); notify(alsoBlock ? 'Reported and blocked' : 'Report sent'); };
  const exportChat = () => {
    if (!msgs.length) return notify('Nothing to export');
    const body = (m) => (m.type === 'text' ? m.text : m.type === 'image' ? '<Photo omitted>' : m.type === 'video' ? '<Video omitted>' : '<Voice message omitted>');
    const lines = msgs.map((m) => { const d = new Date(m.at); return `${isNaN(d) ? '' : `${d.toLocaleDateString()}, ${fmtTime(m.at)} - `}${m.from === 'me' ? 'You' : c?.name || 'Them'}: ${body(m)}`; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = `SendMeU chat with ${c?.name || 'chat'}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); notify('Chat exported');
  };
  const addShortcut = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/chats/${id}`); notify('Chat link copied. Add it to your home screen from your browser menu'); } catch { notify('Could not copy the chat link'); }
  };

  const mainItems = [
    ...(direct ? [{ key: 'contact', label: pref.contact ? 'Edit contact' : 'Add to contacts', onSelect: openContact }] : []),
    { key: 'search', label: 'Search', onSelect: () => { setSearching(true); setSq(''); } },
    { key: 'report', label: 'Report', onSelect: () => { setReason(REASONS[0]); setAlsoBlock(false); setSheet('report'); } },
    ...(direct ? [{ key: 'block', label: blocked ? 'Unblock' : 'Block', onSelect: () => (blocked ? (setPref(id, { blocked: false }), notify('Contact unblocked')) : setSheet('block')) }] : []),
    { key: 'mute', label: muted ? 'Unmute notifications' : 'Mute notifications', onSelect: () => (muted ? (setPref(id, { mutedUntil: null }), notify('Notifications on')) : setSheet('mute')) },
    { key: 'theme', label: 'Chat theme', onSelect: () => setSheet('theme') },
    { key: 'lock', label: 'Lock chat', onSelect: async () => { try { await api.lockChat(id, true); notify('Chat moved to Private Space'); nav('/home', { replace: true }); } catch (e) { notify(errMsg(e)); } } },
    { key: 'more', label: 'More', keepOpen: true, arrow: true, onSelect: () => setSub('more') },
  ];
  const moreItems = [
    { key: 'media', label: 'Media, links, and docs', onSelect: () => { setMtab('media'); setSheet('media'); } },
    { key: 'clear', label: 'Clear chat', onSelect: () => setSheet('clear') },
    { key: 'export', label: 'Export chat', onSelect: exportChat },
    { key: 'shortcut', label: 'Add shortcut', onSelect: addShortcut },
    { key: 'settings', label: 'Chat settings', onSelect: () => nav('/you/chats') },
  ];
  const mediaMsgs = msgs.filter((m) => (m.type === 'image' || m.type === 'video') && m.src);
  const linkMsgs = msgs.filter((m) => m.type === 'text' && (m.text.match(URL_RE) || []).length);
  return (
    <div className="screen chat-bg" style={wall ? { background: theme === 'dark' ? wall.dark : wall.light } : undefined}>
      {c && pv && <ProfilePreview contact={{ id, name: c.name, avatar: c.avatar }} from={pv} onClose={() => setPv(null)} />}
      <header className="chat-head">
        <button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={26} /></button>
        <div className="head-open" role="group" aria-label={`${c?.name || 'contact'} header`}>
          {c && <button className="head-av" aria-label={`View ${c.name} profile picture`} onClick={(e) => setPv(e.currentTarget.querySelector('img').getBoundingClientRect())}><span style={{ position: 'relative', display: 'inline-flex' }}><img src={c.avatar} alt="" style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover' }} />{c.online && <i className="dot-online" style={{ width: 14, height: 14, right: 0, bottom: 2 }} />}</span></button>}
          <button className="head-name" aria-label={`Open ${c?.name || 'contact'} info`} onClick={() => c && nav(`/chats/${id}/info`)}>
            <div className="who">
              <b>{c?.name}{c?.heart && ' ❤️'}{muted && <BellOff size={14} aria-label="Muted" style={{ marginLeft: 6, opacity: .7 }} />}</b>
              <small style={typing ? { color: '#1236c9' } : undefined}>{typing ? 'typing…' : c?.type === 'group' ? 'Group · tap for info' : c?.online ? 'Online' : 'Last seen recently'}</small>
            </div>
          </button>
        </div>
        <button className="icon-btn" aria-label="Voice call" onClick={() => notify('Calling…')}><Phone size={26} /></button>
        <button className="icon-btn" aria-label="Video call" onClick={() => notify('Video calling…')}><Video size={28} /></button>
        <span className="more-wrap">
          <button className="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={dd} onClick={() => { setSub('main'); setDd((v) => !v); }}><MoreVertical size={26} /></button>
          <DropMenu open={dd} onClose={closeMenu} items={sub === 'more' ? moreItems : mainItems} label="Chat menu" />
        </span>
      </header>
      {direct && !blocked && <StreakBar s={streak.data} onMessage={() => inputRef.current?.focus()} onPhoto={() => pick('image')} />}
      {cel && <Celebration event={cel} friendName={c?.name || 'your friend'} onClose={() => setCel(null)} onShare={() => shareMilestoneCard({ days: cel.count, friendName: c?.name || 'a friend' }).then((r) => r === 'saved' && notify('Card saved'))} />}
      {searching && (
        <div className="chat-search">
          <label className="input"><Search size={16} /><input autoFocus placeholder="Search in chat" value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && step(e.shiftKey ? -1 : 1)} /></label>
          <small aria-live="polite">{needle ? `${matches.length ? hit + 1 : 0}/${matches.length}` : ''}</small>
          <button className="icon-btn" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={22} /></button>
          <button className="icon-btn" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={22} /></button>
          <button className="icon-btn" aria-label="Close search" onClick={closeSearch}><X size={22} /></button>
        </div>
      )}

      <div className="msgs" ref={listRef} onScroll={onScroll}>
        {loading && msgs.length === 0 && <ListSkeleton n={3} />}
        {error && <ErrorState message={error} onRetry={() => load(1)} />}
        {hasMore && <button className="btn-ghost" onClick={() => load(page + 1)}>Load earlier messages</button>}
        {!loading && !error && msgs.length === 0 && <Empty title="No messages yet" text="Say hello 👋" />}
        {needle && matches.length === 0 && <span className="day-chip">No messages found</span>}
        {msgs.length > 0 && <span className="day-chip">Today</span>}
        {msgs.map((m) => <Bubble key={m.id} m={m} avatar={c?.avatar} starred={starred.some((x) => x.id === m.id)} mark={matches.includes(m.id) ? (m.id === matches[hit] ? 'cur' : 'hit') : undefined} onLongPress={setReact} onOpen={setPreview} />)}
        {typing && <div className="mrow"><img className="mav" src={c?.avatar} alt="" /><div className="typing" aria-label="Typing" style={{ alignSelf: 'auto' }}><i /><i /><i /></div></div>}
      </div>

      {menu && (
        <div className="attach-menu">
          {[['Gallery', Img, '#1236c9', 'image'], ['Camera', Camera, '#ff8a00', 'camera'], ['Video', Video, '#2f6bff', 'video'], ['Location', MapPin, '#14c8b0', 'loc']].map(([l, I, bg, k]) => (
            <button key={l} onClick={() => (k === 'loc' ? (setMenu(false), navigator.geolocation?.getCurrentPosition(async (p) => { const m = await api.sendMessage(id, { type: 'text', text: `📍 https://maps.google.com/?q=${p.coords.latitude},${p.coords.longitude}` }); setMsgs((c2) => [...c2, m]); }, () => notify('Location unavailable'))) : pick(k))}>
              <span className="ic" style={{ background: bg }}><I size={20} /></span>{l}
            </button>
          ))}
        </div>
      )}
      {emoji && <div className="emoji-bar" role="list">{EMOJI.map((e) => <button key={e} role="listitem" onClick={() => setText((t) => t + e)}>{e}</button>)}</div>}
      <input ref={fileRef} type="file" hidden onChange={onFile} />

      {blocked ? (
        <div className="block-bar"><span>You blocked {c?.name}. Unblock to send messages.</span><Button className="btn-sm" onClick={() => { setPref(id, { blocked: false }); notify('Contact unblocked'); }}>Unblock</Button></div>
      ) : rec ? (
        <div className="composer">
          <button className="icon-btn" aria-label="Cancel recording" onClick={() => stopRec(true)}><Trash2 size={22} color="#ff3b5c" /></button>
          <div className="input" style={{ justifyContent: 'center', color: '#ff3b5c' }}>● Recording 0:{String(rec.secs).padStart(2, '0')}</div>
          <button className="mic rec" aria-label="Send voice message" onClick={() => stopRec(false)}><Send size={20} /></button>
        </div>
      ) : (
        <div className="composer">
          <label className="input">
            <button type="button" aria-label="Emoji" onClick={() => { setEmoji(!emoji); setMenu(false); }}><Smile size={30} /></button>
            <i className="caret" aria-hidden />
            <input ref={inputRef} placeholder="Type a message..." value={text} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button type="button" aria-label="Attach" onClick={() => { setMenu(!menu); setEmoji(false); }}><Paperclip size={26} /></button>
            <button type="button" aria-label="Camera" onClick={() => pick('camera')}><Camera size={28} /></button>
          </label>
          {text.trim() ? <button className="mic" aria-label="Send" onClick={send}><Send size={24} /></button> : <button className="mic" aria-label="Record voice message" onClick={startRec}><Mic size={26} /></button>}
        </div>
      )}

      <Modal open={!!react} onClose={() => setReact(null)} title="React">
        <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 30 }}>{REACTIONS.map((e) => <button key={e} onClick={() => doReact(e)} aria-label={`React ${e}`}>{e}</button>)}</div>
        {react && (() => {
          const isStar = starred.some((x) => x.id === react.id);
          return <Button variant="outline" style={{ marginTop: 16 }} onClick={() => {
            toggleStar({ id: react.id, convoId: id, convoName: c?.name, avatar: c?.avatar, from: react.from, type: react.type, text: react.text, src: react.src && !react.src.startsWith('blob:') ? react.src : undefined, at: react.at });
            setReact(null); notify(isStar ? 'Removed from starred' : 'Message starred');
          }}><Star size={16} fill={isStar ? 'currentColor' : 'none'} style={{ marginRight: 8 }} />{isStar ? 'Unstar message' : 'Star message'}</Button>;
        })()}
        {react?.type === 'text' && <Button variant="outline" style={{ marginTop: 10 }} onClick={() => { navigator.clipboard?.writeText(react.text); setReact(null); notify('Copied'); }}>Copy text</Button>}
      </Modal>
      <Modal open={sheet === 'contact'} onClose={() => setSheet(null)} title={pref.contact ? 'Edit contact' : 'Add to contacts'}>
        <TextField placeholder="Name" maxLength={40} value={cName} onChange={(e) => setCName(e.target.value)} />
        <TextField placeholder="Phone number (optional)" inputMode="tel" maxLength={20} value={cPhone} onChange={(e) => setCPhone(e.target.value.replace(/[^0-9+\- ]/g, ''))} />
        <Button disabled={!cName.trim()} onClick={saveContact}>Save</Button>
        {pref.contact && <Button variant="outline" style={{ marginTop: 10 }} onClick={() => { setPref(id, { contact: null }); setSheet(null); notify('Removed from contacts'); }}>Remove from contacts</Button>}
      </Modal>
      <Modal open={sheet === 'report'} onClose={() => setSheet(null)} title={`Report ${c?.name || ''}`}>
        <div className="mp-pick" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={reason === r} className={`mp-pick-row ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}><span className="grow">{r}</span><span className="mp-check">{reason === r && <Tick size={16} strokeWidth={3} />}</span></button>)}
        </div>
        {direct && !blocked && <label className="check" style={{ margin: '12px 4px' }}><input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} /> Also block this contact</label>}
        <Button style={{ marginTop: 8 }} onClick={sendReport}>Send report</Button>
      </Modal>
      <Modal open={sheet === 'block'} onClose={() => setSheet(null)} title={`Block ${c?.name || ''}?`}>
        <p className="muted" style={{ marginBottom: 16 }}>You will not be able to send messages in this chat until you unblock.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setPref(id, { blocked: true }); setSheet(null); notify('Contact blocked'); }}>Block</Button>
        </div>
      </Modal>
      <Modal open={sheet === 'mute'} onClose={() => setSheet(null)} title="Mute notifications">
        <div className="mp-pick" role="radiogroup" aria-label="Duration">
          {MUTES.map(([l, ms]) => <button key={l} type="button" role="radio" aria-checked="false" className="mp-pick-row" onClick={() => { setPref(id, { mutedUntil: ms === -1 ? -1 : Date.now() + ms }); setSheet(null); notify(`Muted for ${l.toLowerCase()}`.replace('for always', 'always')); }}><span className="grow">{l}</span></button>)}
        </div>
      </Modal>
      <Modal open={sheet === 'theme'} onClose={() => setSheet(null)} title="Chat theme">
        <div className="wall-grid" role="radiogroup" aria-label="Wallpaper">
          {WALLS.map((w) => {
            const on = (pref.wall || 'default') === w.k;
            return <button key={w.k} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => { setPref(id, { wall: w.k }); notify(w.k === 'default' ? 'Default theme' : `${w.l} theme`); }}><i style={{ background: w.light ? (theme === 'dark' ? w.dark : w.light) : 'var(--bg)' }}>{on && <Tick size={18} strokeWidth={3} />}</i><span>{w.l}</span></button>;
          })}
        </div>
      </Modal>
      <Modal open={sheet === 'media'} onClose={() => setSheet(null)} title="Media, links, and docs">
        <GlassTabs label="Shared items" items={[['media', 'Media', mediaMsgs.length], ['links', 'Links', linkMsgs.length], ['docs', 'Docs']]} value={mtab} onChange={setMtab} />
        <div style={{ marginTop: 12, minHeight: 120 }}>
          {mtab === 'media' && (mediaMsgs.length ? <div className="media-grid">{mediaMsgs.map((m) => <button key={m.id} aria-label={`Open ${m.type}`} onClick={() => { setSheet(null); setPreview(m); }}>{m.src.startsWith('blob:') && m.type === 'video' ? <video src={m.src} /> : <img src={m.src} alt="" />}</button>)}</div> : <Empty icon={Img} title="No media" text="Photos and videos you share will appear here." />)}
          {mtab === 'links' && (linkMsgs.length ? linkMsgs.map((m) => (m.text.match(URL_RE) || []).map((u, i) => <a key={`${m.id}${i}`} className="menu-row" href={u} target="_blank" rel="noreferrer noopener" style={{ wordBreak: 'break-all' }}>{u}</a>)) : <Empty title="No links" text="Links shared in this chat will appear here." />)}
          {mtab === 'docs' && <Empty title="No documents" text="Documents shared in this chat will appear here." />}
        </div>
      </Modal>
      <Modal open={sheet === 'clear'} onClose={() => setSheet(null)} title="Clear this chat?">
        <p className="muted" style={{ marginBottom: 16 }}>Messages are removed from this device only.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setMsgs([]); setSheet(null); notify('Chat cleared on this device'); }}>Clear</Button>
        </div>
      </Modal>
      {preview && (
        <div className="story-view" onClick={() => setPreview(null)} style={{ zIndex: 60 }}>
          <button className="icon-btn" style={{ position: 'absolute', top: 16, right: 12, color: '#fff', zIndex: 3 }} aria-label="Close preview"><X size={26} /></button>
          {preview.type === 'video' && preview.src?.startsWith('blob:') ? <video className="media" src={preview.src} controls autoPlay style={{ objectFit: 'contain' }} /> : <img className="media" src={preview.src} alt="" style={{ objectFit: 'contain' }} />}
        </div>
      )}
    </div>
  );
}

export function NewChat() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [q, setQ] = useState('');
  const [sp] = useSearchParams();
  const [group, setGroup] = useState(sp.get('group') === '1');
  const [sel, setSel] = useState([]);
  const [gname, setGname] = useState('');
  const people = useAsync(() => api.people({}), []);
  const list = (people.data || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (p) => setSel((s) => (s.find((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));
  const open = async (p) => {
    if (group) return toggle(p);
    try { const c = await api.createConversation({ name: p.name, avatar: p.avatar, userId: p.id }); nav(`/chats/${c.id}`, { replace: true }); } catch (e) { notify(errMsg(e)); }
  };
  const makeGroup = async () => {
    if (!gname.trim() || sel.length < 2) return notify('Add a name and at least 2 people');
    try { const c = await api.createConversation({ group: true, name: gname, avatar: sel[0].avatar, userIds: sel.map((s) => s.id) }); nav(`/chats/${c.id}`, { replace: true }); } catch (e) { notify(errMsg(e)); }
  };
  return (
    <div className="screen">
      <AppHeader back title={group ? 'New group' : 'New chat'} right={<button className="icon-btn" aria-label="Toggle group" onClick={() => { setGroup(!group); setSel([]); }}><Users size={22} color={group ? 'var(--blue)' : undefined} /></button>} />
      <div style={{ padding: '0 16px' }}>
        {group && <TextField placeholder="Group name" value={gname} onChange={(e) => setGname(e.target.value)} />}
        <label className="input" style={{ borderRadius: 999, height: 44, marginBottom: 10 }}><Search size={16} /><input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="scroll">
        {people.loading && <ListSkeleton />}
        {list.map((p) => (
          <button key={p.id} className="convo" onClick={() => open(p)}>
            <Avatar src={p.avatar} size={46} /><span className="meta"><span className="name">{p.name}</span><span className="last" style={{ display: 'block' }}>{p.distance}</span></span>
            {group && <span className={`chip ${sel.find((x) => x.id === p.id) ? 'active' : ''}`}>{sel.find((x) => x.id === p.id) ? 'Added' : 'Add'}</span>}
          </button>
        ))}
      </div>
      {group && <div style={{ padding: '10px 16px calc(14px + var(--safe-bottom))' }}><Button onClick={makeGroup}>Create group ({sel.length})</Button></div>}
    </div>
  );
}

export function Notifications() {
  const nav = useNavigate(); const notify = useUI((s) => s.notify);
  const n = useAsync(() => api.notifications(), []);
  const respond = async (x, status) => {
    try { await api.ceRespond(x.event_id, status); n.setData((d) => d.map((r) => (r.id === x.id ? { ...r, actionable: false, text: `${r.text} · ${status === 'accepted' ? 'Going' : 'Declined'}` } : r))); notify(status === 'accepted' ? 'You are going' : 'Declined'); }
    catch (e) { notify(errMsg(e)); n.reload(); }
  };
  return (
    <div className="screen">
      <AppHeader back title="Notifications" />
      <div className="scroll">
        {n.loading && <ListSkeleton n={3} />}
        {n.error && <ErrorState message={n.error} onRetry={n.reload} />}
        {n.data?.length === 0 && <Empty title="All caught up" text="No new notifications." />}
        {(n.data || []).map((x) => (
          <div key={x.id} className="menu-row" style={x.event_id ? { cursor: 'pointer', flexWrap: 'wrap' } : undefined} onClick={x.event_id ? () => nav(`/calls/events/${x.event_id}`) : undefined}>
            <span className="grow">{x.text}</span><span className="muted">{x.ago}</span>
            {x.actionable && <span style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              <Button variant="outline" className="btn-sm" onClick={() => respond(x, 'declined')}>Decline</Button>
              <Button className="btn-sm" onClick={() => respond(x, 'accepted')}>Accept</Button>
            </span>}
          </div>
        ))}
      </div>
    </div>
  );
}
