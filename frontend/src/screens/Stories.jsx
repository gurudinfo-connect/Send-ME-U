import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, ChevronUp, Eye, Heart, Music, Send, Volume2, VolumeX, X } from 'lucide-react';
import { Avatar, AppHeader, Button, ErrorState, ListSkeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { StoryMedia, StoryOverlay } from '../stories/StoryMedia';

const DURATION = 5000;
const HEART_COLORS = ['#ff3b5c', '#ff8a00', '#ff86b8', '#ff5d8f', '#ffd166', '#ffffff'];
const HEART_PATH = 'M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2 0 3.5 1 5.4 3 1.9-2 3.4-3 5.4-3 3.6 0 5.7 3.7 4.2 7.2C19.500 16.400 12 21 12 21z';

// Floating hearts that rise from the like button; each one removes itself when its animation ends.
function HeartBurst({ bursts, onDone }) {
  return (
    <div className="love-burst" aria-hidden>
      {bursts.map((b) => (
        <span key={b.id} className={b.big ? 'lh big' : 'lh'} onAnimationEnd={() => onDone(b.id)}
          style={{ '--x': `${b.x}px`, '--s': `${b.size}px`, '--d': `${b.dur}ms`, '--r': `${b.rot}deg`, '--sway': `${b.sway}px`, animationDelay: `${b.delay}ms` }}>
          <svg viewBox="0 0 24 24" width="100%" height="100%"><path d={HEART_PATH} fill={b.color} /></svg>
        </span>
      ))}
    </div>
  );
}
const rnd = (a, b) => a + Math.random() * (b - a);
const makeBurst = (n = 16) => [
  { id: `${Date.now()}-big`, big: true, x: 0, size: 120, dur: 900, rot: 0, sway: 0, delay: 0, color: '#ff3b5c' },
  ...Array.from({ length: n }, (_, k) => ({ id: `${Date.now()}-${k}-${Math.random()}`, x: rnd(-70, 20), size: rnd(18, 42), dur: rnd(1500, 2600), rot: rnd(-35, 35), sway: rnd(-60, 60), delay: k * 55, color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)] })),
];

// Bottom sheet for my own story: who saw it, who liked it, who replied
function ViewersSheet({ item, onClose }) {
  const viewers = useAsync(() => api.storyViewers(item.id), [item.id]);
  const nav = useNavigate();
  const [tab, setTab] = useState('likes');
  const all = viewers.data || [];
  const likes = all.filter((v) => v.liked);
  const rows = tab === 'likes' ? likes : tab === 'replies' ? all.filter((v) => v.reply) : all;
  return (
    <div className="sv-scrim" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="sv-sheet" role="dialog" aria-label="Story viewers" onClick={(e) => e.stopPropagation()}>
        <div className="sv-grab" />
        <div className="sv-head">
          <b>Story activity</b>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="sv-tabs" role="tablist">
          {[['likes', `Likes ${likes.length}`], ['replies', `Replies ${all.filter((v) => v.reply).length}`], ['views', `Views ${all.length}`]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="sv-list">
          {viewers.loading && <ListSkeleton n={3} />}
          {!viewers.loading && !rows.length && <p className="muted center" style={{ padding: 24 }}>{tab === 'likes' ? 'No likes yet' : tab === 'replies' ? 'No replies yet' : 'No views yet'}</p>}
          {rows.map((v) => (
            <div key={v.userId} className="sv-row">
              <Avatar src={v.avatar} size={44} />
              <div className="sv-who">
                <b>{v.name}</b>
                <small>{tab === 'replies' && v.reply ? v.reply : v.ago}</small>
              </div>
              {v.liked && <span className="sv-heart" aria-label="Liked"><Heart size={18} fill="#ff3b5c" color="#ff3b5c" /></span>}
              {v.reaction && !v.liked && <span>{v.reaction}</span>}
              {(v.reply || v.liked) && v.chatId && <button className="sv-msg" aria-label={`Open chat with ${v.name}`} onClick={() => nav(`/chats/${v.chatId}`)}><Send size={16} /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Stories() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const notify = useUI((s) => s.notify);
  const stories = useAsync(() => api.stories(), []);
  const [si, setSi] = useState(0);
  const [ii, setIi] = useState(0);
  const [liked, setLiked] = useState({});
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [muted, setMuted] = useState(false);
  const [bursts, setBursts] = useState([]);
  const [viewersOpen, setViewersOpen] = useState(false);
  const swipe = useRef(null);
  const audioEl = useRef(null);
  const initial = useRef(false);

  const list = stories.data || [];
  useEffect(() => {
    if (initial.current || !list.length) return;
    const i = list.findIndex((s) => s.id === params.get('u')); if (i >= 0) { setSi(i); if (params.get('new')) setIi(list[i].items.length - 1); } initial.current = true;
  }, [list, params]);

  const story = list[si]; const item = story?.items[ii];
  const [viewerCount, setViewerCount] = useState({});
  useEffect(() => {
    if (!story?.mine || !item) return;
    let on = true; api.storyViewers(item.id).then((v) => on && setViewerCount((c) => ({ ...c, [item.id]: v.length }))).catch(() => {});
    return () => { on = false; };
  }, [story?.mine, item?.id, viewersOpen]); // eslint-disable-line
  // music attached to the story plays while it is on screen
  useEffect(() => {
    const au = item?.audio; if (!au) return;
    const a = new Audio(au.src); a.loop = true; a.currentTime = au.start || 0; a.muted = muted;
    a.play().catch(() => {}); audioEl.current = a;
    return () => { a.pause(); audioEl.current = null; };
  }, [item?.id]); // eslint-disable-line
  useEffect(() => { const a = audioEl.current; if (!a) return; a.muted = muted; if (paused || replying || viewersOpen) a.pause(); else a.play().catch(() => {}); }, [muted, paused, replying, viewersOpen]);
  const next = () => {
    if (!story) return;
    if (ii < story.items.length - 1) { setIi(ii + 1); setTick((t) => t + 1); }
    else if (si < list.length - 1) { setSi(si + 1); setIi(0); setTick((t) => t + 1); }
    else nav(-1);
  };
  const prev = () => { if (ii > 0) setIi(ii - 1); else if (si > 0) { setSi(si - 1); setIi(0); } setTick((t) => t + 1); };
  const jump = (k) => { setSi(k); setIi(0); setTick((t) => t + 1); setReplying(false); setViewersOpen(false); };
  useEffect(() => {
    if (!item || paused || replying || viewersOpen) return;
    const t = setTimeout(next, DURATION); return () => clearTimeout(t);
  }, [si, ii, paused, replying, viewersOpen, tick, item]); // eslint-disable-line

  const header = (
    <AppHeader back title="Stories" right={<button className="icon-btn" aria-label="New story" onClick={() => nav('/stories/new')}><Camera size={22} /></button>} />
  );
  if (stories.loading) return <div className="screen">{header}<div className="scroll"><ListSkeleton /></div></div>;
  if (stories.error) return <div className="screen">{header}<ErrorState message={stories.error} onRetry={stories.reload} /></div>;
  if (!story) return <div className="screen">{header}</div>;

  const like = async () => {
    const on = !liked[item.id];
    setLiked((l) => ({ ...l, [item.id]: on }));
    if (!on) { try { await api.unreactStory(item.id); } catch (e) { notify(errMsg(e)); } return; }
    setBursts((b) => [...b, ...makeBurst()]);
    try { await api.reactStory(item.id, '❤️'); } catch (e) { notify(errMsg(e)); }
  };
  const doneBurst = (id) => setBursts((b) => b.filter((x) => x.id !== id));
  // swipe up on my own story = see who viewed / liked it
  const onDown = (e) => { setPaused(true); swipe.current = { y: e.clientY, x: e.clientX }; };
  const onUp = (e) => {
    setPaused(false);
    const st = swipe.current; swipe.current = null;
    if (story.mine && st && st.y - e.clientY > 50 && Math.abs(e.clientX - st.x) < 80) setViewersOpen(true);
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    try { await api.replyStory(item.id, reply); setReply(''); setReplying(false); notify('Reply sent'); } catch (e) { notify(errMsg(e)); }
  };

  return (
    <div className="screen">
      {header}
      <div style={{ padding: '0 16px' }}>
        <div className="story-row" aria-label="Stories">
          {list.map((s, k) => (
            <button key={s.id} className="story-item" onClick={() => jump(k)} aria-label={`Open ${s.name}'s story`} style={{ opacity: k === si ? 1 : .75 }}>
              <Avatar src={s.avatar} size={54} ring />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="story-card" onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => { setPaused(false); swipe.current = null; }}>
        <StoryMedia item={item} muted={!!item.audio || muted} alt={`${story.name}'s story`} />
        <StoryOverlay overlay={item.overlay} />
        <div className="shade" />
        <div className="story-bars" aria-hidden>
          {story.items.map((m, k) => <i key={m.id} className={k < ii ? 'done' : k === ii ? 'run' : ''}><b key={`${si}-${ii}-${tick}`} style={k === ii && (paused || replying || viewersOpen) ? { animationPlayState: 'paused' } : undefined} /></i>)}
        </div>
        {liked[item.id] && <span className="story-love" aria-hidden><Heart size={24} color="#fff" fill="#fff" /></span>}
        <HeartBurst bursts={bursts} onDone={doneBurst} />
        {item.audio && (
          <button className="story-music" onPointerDown={(e) => e.stopPropagation()} onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute music' : 'Mute music'}>
            <Music size={13} /> <span>{item.audio.name}</span> {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        )}
        {item.caption && <p className="story-caption">{item.caption}</p>}
        <button className="story-tap" style={{ left: 0 }} aria-label="Previous" onClick={prev} />
        <button className="story-tap" style={{ right: 0 }} aria-label="Next" onClick={next} />

        {replying && (
          <div className="story-reply-bar" onPointerDown={(e) => e.stopPropagation()}>
            <label className="input"><input autoFocus placeholder={`Reply to ${story.name}…`} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendReply()} /></label>
            <button className="icon-btn" aria-label="Send reply" onClick={sendReply} style={{ color: '#fff' }}><Send size={22} /></button>
          </div>
        )}

        <div className="story-foot" onPointerDown={(e) => e.stopPropagation()}>
          <div className="story-who">
            <Avatar src={story.avatar} size={40} ring />
            <div><b style={{ fontSize: 15 }}>{story.name}{story.heart && <span style={{ color: '#ff8a00' }}> ❤</span>}</b><small>{item.ago}</small></div>
          </div>
          {story.mine ? (
            <button className="story-seen" aria-label="See who viewed your story" onClick={() => setViewersOpen(true)}>
              <ChevronUp size={18} /><Eye size={18} /> Seen by {(viewerCount[item.id] ?? '')}
            </button>
          ) : (
            <div className="story-acts">
              <button aria-label="Reply to story" onClick={() => setReplying(!replying)} style={{ color: '#fff' }}><Send size={24} /></button>
              <button aria-label="Like story" className={liked[item.id] ? 'like-on' : ''} onClick={like} style={{ color: liked[item.id] ? '#ff8a00' : '#fff' }}><Heart size={26} fill={liked[item.id] ? '#ff8a00' : 'none'} /></button>
            </div>
          )}
        </div>
        {viewersOpen && story.mine && <ViewersSheet item={item} onClose={() => setViewersOpen(false)} />}
      </div>
    </div>
  );
}

export { StoryCreate } from '../stories/Editor';
