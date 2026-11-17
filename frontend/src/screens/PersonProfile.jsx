import { useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, UserPlus, MessageCircle, MoreHorizontal, MapPin, Link2, Briefcase, Sparkles, Lock, Ban, Share2, Images, Clapperboard, Tag, Users } from 'lucide-react';
import { AppHeader, Button, Empty, ErrorState, Modal, Skeleton, useAsync, clearAsyncCache } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useAuth, useUI } from '../store';
import { canViewContent, followAction, fmtCount } from '../profile/relations';
import { blockPerson, unblockPerson, profileLink, safeUrl, shareLink } from '../profile/actions';
import { PeopleSheet, PostGrid, PostViewer, Verified } from '../profile/ProfileParts';

const TABS = [['posts', 'Posts', Images], ['reels', 'Reels', Clapperboard], ['tagged', 'Tagged', Tag]];
const EMPTY = {
  posts: ['No posts yet', 'Photos they share will show up here.'],
  reels: ['No videos yet', 'Videos they share will show up here.'],
  tagged: ['No tagged posts', 'Posts they are tagged in will show up here.'],
};
// the server sends exact numbers, the demo sends strings like "1.2K"
const cnt = (v) => (typeof v === 'number' ? fmtCount(v) : v ?? '0');

// Another person's profile, loaded by their id from the URL (/people/:id)
export default function PersonProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const me = useAuth((s) => s.user);
  const busy = useRef(false);
  const [tab, setTab] = useState('posts');
  const [sheet, setSheet] = useState(null);   // 'followers' | 'following'
  const [viewing, setViewing] = useState(null); // post open in the viewer
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const prof = useAsync(() => api.userProfile(id), [id]);
  const p = prof.data;
  const locked = !!p && !p.blocked && !canViewContent({ isPrivate: p.isPrivate, isFollowing: p.isFollowing });
  const content = useAsync(() => (p && !p.blocked ? api.userPosts(id, tab) : Promise.resolve({ locked: false, items: [] })), [id, tab, !!p, !!p?.isFollowing, !!p?.blocked]);
  if (me && String(me.id) === String(id)) return <Navigate to="/profile" replace />;

  const act = p && followAction(p);
  const toggle = async () => {
    if (!p || busy.current) return;
    busy.current = true;
    const before = { isFollowing: !!p.isFollowing, requested: !!p.requested };
    const off = act === 'unfollow' || act === 'cancel';
    prof.setData((d) => ({ ...d, ...(off ? { isFollowing: false, requested: false } : act === 'request' ? { requested: true } : { isFollowing: true }) }));
    try {
      const r = await (off ? api.unfollow(id) : api.follow(id));
      prof.setData((d) => ({ ...d, isFollowing: r.following, requested: !!r.requested, ...(r.followers != null ? { followers: r.followers } : {}) }));
      clearAsyncCache();
      if (r.requested) notify(`Follow request sent to ${p.name}`);
    } catch (e) { prof.setData((d) => ({ ...d, ...before })); notify(errMsg(e)); }
    finally { busy.current = false; }
  };
  const message = async () => { try { const c = await api.directChat(id); nav(`/chats/${c.id}`); } catch (e) { notify(errMsg(e)); } };
  const share = async () => { const m = await shareLink({ title: `${p.name} on SendMeU`, url: profileLink(p.handle) }); if (m) notify(m); };
  const block = async () => {
    if (working) return; setWorking(true);
    try { await blockPerson(id); prof.setData({ id: p.id, name: p.name, handle: p.handle, avatar: p.avatar, blocked: true }); setConfirm(false); setViewing(null); notify(`${p.name} blocked`); }
    catch (e) { notify(errMsg(e)); } finally { setWorking(false); }
  };
  const unblock = async () => {
    if (working) return; setWorking(true);
    try { await unblockPerson(id); notify(`${p.name} unblocked`); prof.reload(); }
    catch (e) { notify(errMsg(e)); } finally { setWorking(false); }
  };
  const openList = (kind) => { if (locked) return notify('This account is private'); setSheet(kind); };
  const openPerson = (x) => { setSheet(null); setViewing(null); nav(x.isMe ? '/profile' : `/people/${x.id}`); };
  const patchPost = (n) => content.setData((d) => d && ({ ...d, items: d.items.map((x) => (x.id === n.id ? { ...x, ...n } : x)) }));
  const site = safeUrl(p?.website);

  return (
    <div className="screen">
      <AppHeader back fallback="/timeline" title={p && !p.blocked ? p.handle?.replace(/^@/, '') : 'Profile'} />
      <div className="scroll ci-scroll" style={{ paddingBottom: 40 }}>
        {prof.loading && !p && (
          <div className="pf-skel" aria-busy="true" aria-label="Loading profile">
            <div className="row"><Skeleton h={92} w={92} r={46} /><div style={{ flex: 1, display: 'grid', gap: 10 }}><Skeleton h={20} /><Skeleton h={14} w="70%" /></div></div>
            <Skeleton h={18} w="45%" /><Skeleton h={14} w="80%" /><Skeleton h={40} r={20} />
            <div className="pf-grid">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h="100%" r={4} />)}</div>
          </div>
        )}
        {!prof.loading && !p && <ErrorState message={prof.error || 'This profile could not be loaded'} onRetry={prof.reload} />}

        {p?.blocked && (
          <section className="ci-hero">
            <span className="avr" style={{ width: 110, height: 110, padding: 4 }}><img src={p.avatar} alt={p.name} /></span>
            <h1>{p.name}</h1><div className="ci-sub">{p.handle}</div>
            <div className="pf-private"><Ban size={30} /><b>You blocked this account</b><span>They can’t follow you or message you, and you can’t see each other’s posts.</span></div>
            <Button variant="outline" loading={working} onClick={unblock}>Unblock</Button>
          </section>
        )}

        {p && !p.blocked && (
          <>
            <section className="pf-head">
              <div className="pf-top">
                <span className="avr pf-avatar"><img src={p.avatar} alt={p.name} />{p.online && <i className="on" style={{ width: 16, height: 16 }} />}</span>
                <div className="pf-stats">
                  <div><b>{cnt(p.posts)}</b><span>Posts</span></div>
                  <button onClick={() => openList('followers')} aria-label={`${cnt(p.followers)} followers`}><b>{cnt(p.followers)}</b><span>Followers</span></button>
                  <button onClick={() => openList('following')} aria-label={`${cnt(p.following)} following`}><b>{cnt(p.following)}</b><span>Following</span></button>
                </div>
              </div>
              <h1 className="pf-name">{p.name}{p.verified && <Verified />}</h1>
              {p.title && <div className="pf-title"><Briefcase size={14} />{p.title}</div>}
              {p.bio && <p className="pf-bio">{p.bio}</p>}
              <div className="pf-meta">
                {p.location && <span><MapPin size={14} />{p.location}</span>}
                {site && <a href={site.href} target="_blank" rel="noopener noreferrer"><Link2 size={14} />{site.label}</a>}
                {p.mutual > 0 && <span><Users size={14} />{p.mutual} mutual friends</span>}
              </div>
              {(p.skills?.length > 0 || p.interests?.length > 0) && (
                <div className="pf-chips" aria-label="Skills and interests">
                  {(p.skills || []).map((x) => <span key={`s-${x}`} className="pf-chip"><Sparkles size={12} />{x}</span>)}
                  {(p.interests || []).filter((x) => !(p.skills || []).includes(x)).map((x) => <span key={`i-${x}`} className="pf-chip alt">{x}</span>)}
                </div>
              )}
              <div className="pf-actions">
                <button className={`pf-btn ${p.isFollowing || p.requested ? 'ghost' : 'primary'}`} onClick={toggle} aria-pressed={!!p.isFollowing}>
                  {p.isFollowing ? <><Check size={16} />Following</> : p.requested ? 'Requested' : p.isPrivate ? <><UserPlus size={16} />Follow request</> : <><UserPlus size={16} />Follow</>}
                </button>
                <button className="pf-btn ghost" onClick={message}><MessageCircle size={16} />Message</button>
                <ProfileMore onShare={share} onBlock={() => setConfirm(true)} />
              </div>
            </section>

            <div className="pf-tabs" role="tablist" aria-label="Profile content">
              {TABS.map(([k, label, Icon]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon size={20} /><span>{label}</span></button>
              ))}
            </div>

            <div role="tabpanel" aria-label={TABS.find((t) => t[0] === tab)[1]}>
              {locked
                ? <div className="pf-private"><Lock size={30} /><b>This account is private</b><span>{p.requested ? 'Your follow request is waiting for approval.' : `Follow ${p.name.split(' ')[0]} to see their posts, reels and tags.`}</span></div>
                : <>
                  {content.loading && !content.data && <div className="pf-grid">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h="100%" r={4} />)}</div>}
                  {content.error && <ErrorState message={content.error} onRetry={content.reload} />}
                  {content.data && !content.data.locked && content.data.items.length === 0 && <Empty icon={TABS.find((t) => t[0] === tab)[2]} title={EMPTY[tab][0]} text={EMPTY[tab][1]} />}
                  {content.data && !content.data.locked && content.data.items.length > 0 && <PostGrid items={content.data.items} onOpen={setViewing} />}
                </>}
            </div>
          </>
        )}
      </div>

      {sheet && <PeopleSheet title={sheet === 'followers' ? 'Followers' : 'Following'} userId={id} kind={sheet} onClose={() => setSheet(null)} onOpen={openPerson} />}
      {viewing && <PostViewer post={viewing} onClose={() => setViewing(null)} onChange={patchPost} onOpenOwner={(o) => (o.id === id ? setViewing(null) : openPerson(o))} />}
      <Modal open={confirm} onClose={() => !working && setConfirm(false)} title={`Block ${p?.name || ''}?`}>
        <p className="muted" style={{ marginBottom: 14 }}>They won’t be able to find your profile, follow you or message you. You can unblock them later from their profile.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setConfirm(false)} disabled={working}>Cancel</Button>
          <Button variant="danger" onClick={block} loading={working}>Block</Button>
        </div>
      </Modal>
    </div>
  );
}

// the "..." button next to Follow / Message: share the profile or block the person
function ProfileMore({ onShare, onBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="more-wrap pf-more">
      <button className="pf-btn ghost icon" aria-label="More options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={20} /></button>
      {open && (
        <>
          <button className="dm-backdrop" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="dm pf-dm" role="menu" aria-label="Profile options">
            <button role="menuitem" className="dm-item" onClick={() => { setOpen(false); onShare(); }}><span>Share profile</span><Share2 size={18} aria-hidden /></button>
            <button role="menuitem" className="dm-item danger" onClick={() => { setOpen(false); onBlock(); }}><span>Block</span><Ban size={18} aria-hidden /></button>
          </div>
        </>
      )}
    </span>
  );
}
