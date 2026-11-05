import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Plus, ChevronRight, MessageSquareLock, BellOff, Camera } from 'lucide-react';
import { BrandBar, DropMenu, GlassTabs, ListSkeleton, Empty, ErrorState, useAsync, BrandLogo } from '../components/ui';
import { api, USE_MOCK } from '../services/api';
import { useUI, usePrivate, useChatPrefs, isMuted } from '../store';
import { useStreaks } from '../streaks/hooks';
import { StreakBadge } from '../streaks/components';
import { streakService } from '../services/streakService';
import SnapSheet from '../streaks/SnapSheet';

function ChatRow({ c, onClick, streak }) {
  const recent = /^\d/.test(c.time);
  const muted = isMuted(useChatPrefs((s) => s.prefs[c.id]));
  return (
    <button className="chat-row" onClick={onClick}>
      <img className="av" src={c.avatar} alt="" decoding="async" />
      <span className="meta">
        <span className="nm">{c.name}{c.heart && <span aria-label="heart">❤️</span>}{muted && <BellOff size={15} aria-label="Muted" style={{ opacity: .6 }} />}<StreakBadge s={streak} /></span>
        <span className="ls" style={{ display: 'block' }}>{c.last}</span>
      </span>
      <span className={`rt ${recent ? '' : 'old'}`}>
        <span>{c.time}</span>
        {c.unread > 0 && <span className="ub">{c.unread}</span>}
      </span>
    </button>
  );
}

// Chats tab — conversation list (locked chats live in Private Space)
export default function Home() {
  const nav = useNavigate();
  useEffect(() => { usePrivate.getState().lock(); }, []); // Private Space asks for the password again next time
  const setUnread = useUI((s) => s.setUnread);
  const notify = useUI((s) => s.notify);
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const convos = useAsync(() => api.conversations({ q }), [q]);
  const streaks = useStreaks();
  const [snap, setSnap] = useState(false);
  const streakCount = streaks.items.filter((s) => s.count > 0).length;
  useEffect(() => { // in-app reminders (a real server sends these as pushes/socket events)
    if (!USE_MOCK) return undefined;
    const tick = () => streakService.dueReminders().forEach((s) => notify(`${s.friend.name}: a quick hello keeps your ${s.count}-day streak going`));
    tick(); const t = setInterval(tick, 60000); return () => clearInterval(t);
  }, [notify]);
  const all = (convos.data || []).filter((c) => !c.locked && c.type !== 'couple'); // Our Couple Space lives in Private Space
  const unread = all.reduce((a, c) => a + (c.unread || 0), 0);
  const groups = all.filter((c) => c.kind === 'groups').length;
  useEffect(() => { if (convos.data && !q) setUnread(unread); }, [convos.data, unread, q, setUnread]);

  const readAll = async () => {
    if (unread === 0) return notify('No unread chats');
    try { await api.markAllRead(); } catch (e) { /* server may not support it yet: still clear locally */ }
    convos.setData((d) => (d || []).map((c) => (c.locked || c.type === 'couple' ? c : { ...c, unread: 0 })));
    setUnread(0);
    notify('All chats marked as read');
  };
  const menuItems = [
    { key: 'group', label: 'New group', onSelect: () => nav('/chats/new?group=1') },
    { key: 'community', label: 'New community', onSelect: () => nav('/communities/new') },
    { key: 'broadcast', label: 'Broadcast lists', onSelect: () => nav('/broadcasts') },
    { key: 'devices', label: 'Linked devices', onSelect: () => nav('/devices') },
    { key: 'streaks', label: 'Streaks', onSelect: () => nav('/streaks') },
    { key: 'starred', label: 'Starred', onSelect: () => nav('/starred') },
    { key: 'payments', label: 'Payments', onSelect: () => nav('/payments') },
    { key: 'readall', label: 'Read all', onSelect: readAll },
  ];

  const list = all.filter((c) => (filter === 'unread' ? c.unread > 0 : filter === 'favorites' ? c.favorite : filter === 'groups' ? c.kind === 'groups' : filter === 'streaks' ? (streaks.byId[c.id]?.count > 0) : true))
    .sort((a, b) => (filter === 'streaks' ? (streaks.byId[b.id]?.count || 0) - (streaks.byId[a.id]?.count || 0) : 0));
  const chips = [['all', 'All'], ['unread', 'Unread', unread], ['favorites', 'Favorites'], ['groups', 'Groups', groups], ['streaks', '🔥 Streaks', streakCount]];

  return (
    <div className="screen">
      <div className="home-hero">
      {!searching && <BrandLogo className="hero-logo" />}
      {searching ? (
        <div className="brand-bar">
          <label className="input" style={{ flex: 1, height: 46, borderRadius: 999, background: 'var(--glass)' }}>
            <Search size={18} />
            <input autoFocus placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
            <button aria-label="Close search" onClick={() => { setSearching(false); setQ(''); }}><X size={18} /></button>
          </label>
        </div>
      ) : (
        <BrandBar bell logo={false} onSearch={() => setSearching(true)} onMore={() => setMenu((m) => !m)} moreOpen={menu} moreMenu={<DropMenu open={menu} onClose={() => setMenu(false)} items={menuItems} label="Chats menu" />} />
      )}

      <button className="private-row glass" onClick={() => nav('/private')}>
        <span className="pr-ic"><MessageSquareLock size={30} strokeWidth={1.8} /></span>
        <span className="grow">Private Space</span>
        <ChevronRight size={28} />
      </button>
      </div>
      <hr className="hr-soft" />

      <div className="filter-row">
        <GlassTabs label="Filter chats" items={chips} value={filter} onChange={setFilter} />
        <button className="fchip round" aria-label="New chat" onClick={() => nav('/chats/new')}><Plus size={22} strokeWidth={2.6} /></button>
      </div>

      <div className="label-line">Chats</div>
      <div className="scroll" style={{ padding: 0 }}>
        {convos.loading && <div style={{ padding: '0 18px' }}><ListSkeleton /></div>}
        {convos.error && <ErrorState message={convos.error} onRetry={convos.reload} />}
        {!convos.loading && !convos.error && list.length === 0 && <Empty title="Nothing here yet" text={q ? 'No results for your search.' : 'Start a conversation to see it here.'} />}
        <div key={filter} className="swap">
        {filter === 'streaks' && <button className="st-item" style={{ margin: '4px 18px 8px', width: 'calc(100% - 36px)' }} onClick={() => nav('/streaks')}><span className="grow"><b>Streak dashboard</b><small>Pending today, badges and recovery</small></span><ChevronRight size={18} /></button>}
        {list.map((c) => <ChatRow key={c.id} c={c} streak={streaks.byId[c.id]} onClick={() => nav(c.type === 'couple' ? '/private/couple' : `/chats/${c.id}`)} />)}
        </div>
      </div>
      <button className="snap-fab" aria-label="Send a streak photo" onClick={() => setSnap(true)}><Camera size={26} /></button>
      <SnapSheet open={snap} onClose={() => setSnap(false)} chats={all} streaks={streaks.byId} onSent={() => { streaks.reload(); convos.reload(); }} />
    </div>
  );
}
