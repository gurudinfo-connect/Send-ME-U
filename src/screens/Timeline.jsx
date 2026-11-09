import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, ChevronRight, SlidersHorizontal, UserPlus, Check, Users, User, EyeOff, Ban } from 'lucide-react';
import { BrandBar, GlassTabs, PageTitle, ListSkeleton, Empty, ErrorState, Modal, Button, useAsync, clearAsyncCache } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI, useChatPrefs } from '../store';

const FILTERS = [['all', 'All'], ['friends', 'Friends'], ['followers', 'Followers'], ['following', 'Following'], ['groups', 'Groups']];

const Ring = ({ src, online, size }) => (
  <span className="avr" style={size ? { width: size, height: size } : undefined}>
    <img src={src} alt="" />{online && <i className="on" />}
  </span>
);

// Dropdown for one card's three-dot button. Rendered in a portal with fixed positioning so no card can clip it,
// placed beside the button and kept inside the screen (flips above the button when there is no room below).
function PersonMenu({ anchor, items, label, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(null);
  const close = useCallback(() => {
    if (closeRef.current) return;
    setClosing(true);
    closeRef.current = setTimeout(onClose, 130);
  }, [onClose]);
  useEffect(() => () => clearTimeout(closeRef.current), []);

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, M = 8;
    const left = Math.max(M, Math.min(anchor.right - w, window.innerWidth - w - M));
    let top = anchor.bottom + 4, up = false;
    if (top + h > window.innerHeight - M) { top = Math.max(M, anchor.top - h - 4); up = true; }
    setPos({ left, top, up });
    el.querySelector('button')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); };
  }, [close]);

  return createPortal(
    <>
      <button className="pm-backdrop" aria-label="Close menu" tabIndex={-1} onClick={(e) => { e.stopPropagation(); close(); }} />
      <div ref={ref} role="menu" aria-label={label} className={`pm ${pos?.up ? 'up' : ''} ${closing ? 'out' : ''}`}
        style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        {items.map(({ key, label: l, icon: I, danger, onSelect }) => (
          <button key={key} role="menuitem" className={`dm-item ${danger ? 'danger' : ''}`} onClick={(e) => { e.stopPropagation(); onSelect(); close(); }}>
            <I size={18} aria-hidden /><span>{l}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

function PersonCard({ p, onOpen, onMenu, onToggle }) {
  const following = !!p.isFollowing;
  // the button and the three dots never trigger the card's own navigation
  const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };
  return (
    <article className="pcard glass" role="link" tabIndex={0} aria-label={`Open ${p.name}'s profile`}
      onClick={() => onOpen(p)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(p); } }}>
      <div className="top">
        <Ring src={p.avatar} online={p.online} />
        <div style={{ minWidth: 0, paddingRight: 14 }}>
          <div className="nm">{p.name}</div>
          <div className="hd">{p.handle}</div>
        </div>
        <button className="more" aria-label={`More about ${p.name}`} aria-haspopup="menu" onClick={stop((e) => onMenu(p, e.currentTarget.getBoundingClientRect()))}><MoreVertical size={18} /></button>
      </div>
      <p className="bio">{p.bio}</p>
      <div className="mut"><Users size={14} />{p.mutual} mutual friends</div>
      <div className="foot">
        <div className="st">
          <div><b>{p.followers}</b><span>Followers</span></div><i />
          <div><b>{p.following}</b><span>Following</span></div>
        </div>
        <button className={`fbtn ${following ? 'on' : ''}`} onClick={stop(() => onToggle(p))} aria-pressed={following}>
          {following ? <><Check size={15} />Following</> : <><UserPlus size={14} />Follow</>}
        </button>
      </div>
    </article>
  );
}

// Timeline tab — people you know
export default function Timeline() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(null); // { id, rect }
  const [confirm, setConfirm] = useState(null); // person about to be blocked
  const [blocking, setBlocking] = useState(false);
  const busy = useRef(new Set()); // people with a request in flight (no duplicate follow requests)
  const people = useAsync(() => api.people({ suggestions: true }), []);
  const patch = (id, fn) => people.setData((d) => (d || []).map((x) => (x.id === id ? { ...x, ...fn(x) } : x)));

  const open = (p) => nav(`/people/${p.id}`);
  const toggle = async (p) => {
    if (busy.current.has(p.id)) return;
    busy.current.add(p.id);
    const was = !!p.isFollowing;
    patch(p.id, () => ({ isFollowing: !was }));
    try {
      const r = await (was ? api.unfollow(p.id) : api.follow(p.id));
      patch(p.id, () => ({ isFollowing: r.following, ...(r.followers != null ? { followers: r.followers } : {}) }));
      clearAsyncCache();
      if (!was) notify(`Following ${p.name}`);
    } catch (e) { patch(p.id, () => ({ isFollowing: was })); notify(errMsg(e)); }
    finally { busy.current.delete(p.id); }
  };
  const remove = async (p) => {
    const before = people.data;
    people.setData((d) => (d || []).filter((x) => x.id !== p.id));
    try { await api.dismissSuggestion(p.id); clearAsyncCache(); notify(`${p.name} removed from suggestions`); }
    catch (e) { people.setData(before); notify(errMsg(e)); }
  };
  const block = async () => {
    const p = confirm; if (!p || blocking) return;
    setBlocking(true);
    try {
      await api.blockUser(p.id);
      // the existing chat block (ContactInfo) is keyed by conversation id, so apply it to this person's direct chat too
      try { const c = (await api.conversations({})).find((x) => x.friendId === p.id); if (c) useChatPrefs.getState().setPref(c.id, { blocked: true }); } catch { /* chat may not exist */ }
      people.setData((d) => (d || []).filter((x) => x.id !== p.id));
      clearAsyncCache(); setConfirm(null); notify(`${p.name} blocked`);
    } catch (e) { notify(errMsg(e)); } finally { setBlocking(false); }
  };

  const menuPerson = menu && (people.data || []).find((x) => x.id === menu.id);
  const menuItems = menuPerson ? [
    { key: 'open', label: 'Open', icon: User, onSelect: () => open(menuPerson) },
    menuPerson.isFollowing
      ? { key: 'follow', label: 'Following', icon: Check, onSelect: () => notify(`You already follow ${menuPerson.name}`) }
      : { key: 'follow', label: 'Follow', icon: UserPlus, onSelect: () => toggle(menuPerson) },
    { key: 'remove', label: 'Remove', icon: EyeOff, onSelect: () => remove(menuPerson) },
    { key: 'block', label: 'Block', icon: Ban, danger: true, onSelect: () => setConfirm(menuPerson) },
  ] : [];

  const match = (p) => filter === 'all' || (filter === 'friends' && p.friend) || (filter === 'followers' && p.follower) || (filter === 'following' && p.isFollowing);
  const list = (people.data || []).filter(match);
  const shown = all ? list : list.slice(0, 6);

  return (
    <div className="screen">
      <BrandBar bell onSearch={() => nav('/discover')} onMore={() => nav('/private')} />
      <div className="scroll" style={{ padding: '0 0 120px' }}>
        <PageTitle title="Timeline" sub="Your people, their moments" />
        <div className="filter-row" style={{ marginTop: 14 }}>
          <GlassTabs label="Filter people" items={FILTERS} value={filter} onChange={setFilter} />
          <button className="fchip round" aria-label="Filter options" onClick={() => nav('/discover')}><SlidersHorizontal size={20} /></button>
        </div>

        <div className="sec-head" style={{ margin: '16px 0 8px' }}>
          <h2 style={{ fontSize: 19 }}>People you know</h2>
          <button className="link-blue" onClick={() => setAll(!all)}>{all ? 'Show less' : 'See All'} <ChevronRight size={16} /></button>
        </div>
        {people.loading && <div style={{ padding: '0 14px' }}><ListSkeleton n={3} /></div>}
        {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
        {!people.loading && !people.error && list.length === 0 && <Empty icon={Users} title="No one here yet" text="People who match this filter will show up here." />}
        <div className="pgrid" key={filter}>{shown.map((p) => <PersonCard key={p.id} p={p} onOpen={open} onMenu={(person, rect) => setMenu({ id: person.id, rect })} onToggle={toggle} />)}</div>
      </div>
      {menuPerson && <PersonMenu anchor={menu.rect} items={menuItems} label={`Options for ${menuPerson.name}`} onClose={() => setMenu(null)} />}
      <Modal open={!!confirm} onClose={() => !blocking && setConfirm(null)} title={`Block ${confirm?.name || ''}?`}>
        <p className="muted" style={{ marginBottom: 14 }}>They won’t appear in People you know, and you won’t be able to open their profile or message them.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setConfirm(null)} disabled={blocking}>Cancel</Button>
          <Button variant="danger" onClick={block} loading={blocking}>Block</Button>
        </div>
      </Modal>
    </div>
  );
}
