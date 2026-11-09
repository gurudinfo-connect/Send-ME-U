import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BadgeCheck, Bookmark, Check, Heart, MessageCircle, Play, Send, UserPlus } from 'lucide-react';
import { Empty, ErrorState, ListSkeleton, Modal, clearAsyncCache, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { followAction, fmtCount, timeAgo } from './relations';
import { postLink, shareLink } from './actions';

export const Verified = ({ size = 18 }) => <BadgeCheck size={size} className="pf-verified" aria-label="Verified" />;

// ---- followers / following ----------------------------------------------------------------------------------------
export function PeopleSheet({ title, userId, kind, onClose, onOpen }) {
  const notify = useUI((s) => s.notify);
  const list = useAsync(() => (kind === 'followers' ? api.userFollowers(userId) : api.userFollowing(userId)), [userId, kind]);
  const busy = useRef(new Set());
  const patch = (id, fn) => list.setData((d) => (d || []).map((x) => (x.id === id ? { ...x, ...fn(x) } : x)));
  const toggle = async (p) => {
    if (busy.current.has(p.id)) return;
    busy.current.add(p.id);
    const act = followAction(p);
    const off = act === 'unfollow' || act === 'cancel';
    patch(p.id, () => (off ? { isFollowing: false, requested: false } : act === 'request' ? { requested: true } : { isFollowing: true }));
    try {
      const r = await (off ? api.unfollow(p.id) : api.follow(p.id));
      patch(p.id, () => ({ isFollowing: r.following, requested: !!r.requested }));
      clearAsyncCache();
    } catch (e) { patch(p.id, () => ({ isFollowing: !!p.isFollowing, requested: !!p.requested })); notify(errMsg(e)); }
    finally { busy.current.delete(p.id); }
  };
  const rows = list.data || [];
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="pf-list" aria-busy={list.loading}>
        {list.loading && !list.data && <ListSkeleton n={4} />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && rows.length === 0 && <Empty icon={UserPlus} title={kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'} text={kind === 'followers' ? 'When people follow this account, they will show up here.' : 'Accounts they follow will show up here.'} />}
        {rows.map((p) => (
          <div key={p.id} className="pf-prow">
            <button className="pf-prow-main" onClick={() => onOpen(p)} aria-label={`Open ${p.name}'s profile`}>
              <span className="avr"><img src={p.avatar} alt="" /></span>
              <span className="meta"><b>{p.name}{p.verified && <Verified size={15} />}</b><small>{p.handle ? (String(p.handle).startsWith('@') ? p.handle : `@${p.handle}`) : ''}</small></span>
            </button>
            {p.isMe ? <span className="pf-you">You</span> : (
              <button className={`fbtn ${p.isFollowing || p.requested ? 'on' : ''}`} aria-pressed={!!p.isFollowing} onClick={() => toggle(p)}>
                {p.isFollowing ? <><Check size={14} />Following</> : p.requested ? 'Requested' : <><UserPlus size={13} />Follow</>}
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---- grids --------------------------------------------------------------------------------------------------------
export function PostGrid({ items, onOpen }) {
  return (
    <div className="pf-grid" role="list">
      {items.map((p) => (
        <button key={p.id} role="listitem" className={`pf-tile ${p.type === 'video' ? 'reel' : ''}`} onClick={() => onOpen(p)}
          aria-label={`${p.type === 'video' ? 'Video' : 'Photo'} by ${p.owner.name}: ${p.caption || 'no caption'}`}>
          <img src={p.type === 'video' ? p.poster : p.src} alt="" loading="lazy" />
          {p.type === 'video' && <span className="pf-badge"><Play size={13} fill="currentColor" />{p.duration}</span>}
          <span className="pf-hover"><i><Heart size={15} fill="currentColor" />{fmtCount(p.likes)}</i><i><MessageCircle size={15} fill="currentColor" />{fmtCount(p.comments)}</i></span>
        </button>
      ))}
    </div>
  );
}

// ---- full post / video viewer --------------------------------------------------------------------------------------
export function PostViewer({ post: initial, onClose, onChange, onOpenOwner }) {
  const notify = useUI((s) => s.notify);
  const [post, setPost] = useState(initial);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const inputRef = useRef(null);
  const comments = useAsync(() => api.postComments(initial.id), [initial.id]);
  const video = post.type === 'video';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (patch) => setPost((p) => ({ ...p, ...patch }));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } onChange?.(post); }, [post]); // eslint-disable-line
  const like = async () => {
    if (busy.current) return; busy.current = true;
    const was = post.liked;
    update({ liked: !was, likes: post.likes + (was ? -1 : 1) });
    try { const r = await (was ? api.unlikePost(post.id) : api.likePost(post.id)); update({ liked: r.liked, likes: r.likes }); }
    catch (e) { update({ liked: was, likes: post.likes }); notify(errMsg(e)); }
    finally { busy.current = false; }
  };
  const save = async () => {
    const was = post.saved; update({ saved: !was });
    try { await (was ? api.unsavePost(post.id) : api.savePost(post.id)); notify(was ? 'Removed from saved' : 'Saved'); }
    catch (e) { update({ saved: was }); notify(errMsg(e)); }
  };
  const share = async () => { const m = await shareLink({ title: `${post.owner.name} on SendMeU`, url: postLink(post.id) }); if (m) notify(m); };
  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    try {
      const c = await api.commentPost(post.id, t);
      comments.setData((d) => [...(d || []), c]); update({ comments: post.comments + 1 }); setText(''); clearAsyncCache();
    } catch (e) { notify(errMsg(e)); } finally { setSending(false); }
  };

  return (
    <div className={`pv ${video ? 'video' : ''}`} role="dialog" aria-modal="true" aria-label={video ? 'Video' : 'Post'}>
      <header className="pv-head">
        <button className="icon-btn" aria-label="Close" onClick={onClose}><ArrowLeft size={22} /></button>
        <b>{video ? 'Video' : 'Post'}</b>
      </header>
      <div className="pv-scroll">
        <button className="pv-owner" onClick={() => onOpenOwner?.(post.owner)} aria-label={`Open ${post.owner.name}'s profile`}>
          <span className="avr"><img src={post.owner.avatar} alt="" /></span>
          <span className="meta"><b>{post.owner.name}{post.owner.verified && <Verified size={15} />}</b><small>{timeAgo(post.createdAt)}</small></span>
        </button>
        <div className="pv-media">
          {video && post.src
            ? <video src={post.src} poster={post.poster} controls playsInline preload="metadata" />
            : <img src={video ? post.poster : post.src} alt={post.caption || `Post by ${post.owner.name}`} />}
          {video && !post.src && <span className="pv-play" aria-hidden><Play size={34} fill="currentColor" /></span>}
          {video && post.duration && <span className="pf-badge"><Play size={13} fill="currentColor" />{post.duration}</span>}
        </div>
        <div className="pv-actions">
          <button className={`like ${post.liked ? 'on' : ''}`} aria-pressed={post.liked} aria-label={post.liked ? 'Unlike' : 'Like'} onClick={like}><Heart size={26} fill={post.liked ? 'currentColor' : 'none'} /></button>
          <button aria-label="Comment" onClick={() => inputRef.current?.focus()}><MessageCircle size={26} /></button>
          <button aria-label="Share" onClick={share}><Send size={25} /></button>
          <button className={`end ${post.saved ? 'on' : ''}`} aria-pressed={post.saved} aria-label={post.saved ? 'Remove from saved' : 'Save'} onClick={save}><Bookmark size={25} fill={post.saved ? 'currentColor' : 'none'} /></button>
        </div>
        <div className="pv-likes">{post.likes === 1 ? '1 like' : `${post.likes.toLocaleString()} likes`}</div>
        {post.caption && <p className="pv-cap"><b>{post.owner.name}</b> {post.caption}</p>}
        <div className="pv-date">{new Date(post.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h4 className="pv-ch">Comments{post.comments > 0 ? ` (${post.comments})` : ''}</h4>
        {comments.loading && !comments.data && <ListSkeleton n={2} />}
        {comments.error && <ErrorState message={comments.error} onRetry={comments.reload} />}
        {!comments.loading && !comments.error && (comments.data || []).length === 0 && <p className="pv-none">No comments yet. Be the first.</p>}
        {(comments.data || []).map((c) => (
          <div key={c.id} className="pv-c">
            <span className="avr"><img src={c.avatar} alt="" /></span>
            <p><b>{c.name}</b> {c.text}<small>{timeAgo(c.at)}</small></p>
          </div>
        ))}
      </div>
      <form className="pv-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={inputRef} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" aria-label="Add a comment" />
        <button type="submit" disabled={!text.trim() || sending}>Post</button>
      </form>
    </div>
  );
}
