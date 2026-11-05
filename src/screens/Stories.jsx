import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Heart, Send, Upload } from 'lucide-react';
import { Avatar, AppHeader, Button, ErrorState, ListSkeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const DURATION = 5000;

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
  const initial = useRef(false);

  const list = stories.data || [];
  useEffect(() => {
    if (initial.current || !list.length) return;
    const i = list.findIndex((s) => s.id === params.get('u')); if (i >= 0) setSi(i); initial.current = true;
  }, [list, params]);

  const story = list[si]; const item = story?.items[ii];
  const next = () => {
    if (!story) return;
    if (ii < story.items.length - 1) { setIi(ii + 1); setTick((t) => t + 1); }
    else if (si < list.length - 1) { setSi(si + 1); setIi(0); setTick((t) => t + 1); }
    else nav(-1);
  };
  const prev = () => { if (ii > 0) setIi(ii - 1); else if (si > 0) { setSi(si - 1); setIi(0); } setTick((t) => t + 1); };
  const jump = (k) => { setSi(k); setIi(0); setTick((t) => t + 1); setReplying(false); };
  useEffect(() => {
    if (!item || paused || replying) return;
    const t = setTimeout(next, DURATION); return () => clearTimeout(t);
  }, [si, ii, paused, replying, tick, item]); // eslint-disable-line

  const header = (
    <AppHeader back title="Stories" right={<button className="icon-btn" aria-label="New story" onClick={() => nav('/stories/new')}><Camera size={22} /></button>} />
  );
  if (stories.loading) return <div className="screen">{header}<div className="scroll"><ListSkeleton /></div></div>;
  if (stories.error) return <div className="screen">{header}<ErrorState message={stories.error} onRetry={stories.reload} /></div>;
  if (!story) return <div className="screen">{header}</div>;

  const like = async () => { setLiked((l) => ({ ...l, [item.id]: !l[item.id] })); try { await api.reactStory(item.id, '❤️'); } catch (e) { notify(errMsg(e)); } };
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
              <span style={{ fontWeight: k === si ? 600 : 400 }}>{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="story-card" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
        <img className="media" src={item.src} alt={`${story.name}'s story`} />
        <div className="shade" />
        <div className="story-bars" aria-hidden>
          {story.items.map((m, k) => <i key={m.id} className={k < ii ? 'done' : k === ii ? 'run' : ''}><b key={`${si}-${ii}-${tick}`} style={k === ii && (paused || replying) ? { animationPlayState: 'paused' } : undefined} /></i>)}
        </div>
        {liked[item.id] && <span className="story-love" aria-hidden><Heart size={24} color="#fff" fill="#fff" /></span>}
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
          <div className="story-acts">
            <button aria-label="Reply to story" onClick={() => setReplying(!replying)} style={{ color: '#fff' }}><Send size={24} /></button>
            <button aria-label="Like story" onClick={like} style={{ color: liked[item.id] ? '#ff8a00' : '#fff' }}><Heart size={26} fill={liked[item.id] ? '#ff8a00' : 'none'} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StoryCreate() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  const choose = (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setUrl(URL.createObjectURL(f)); };
  const post = async () => {
    setBusy(true);
    try { await api.createStory(file, caption); notify('Story posted'); nav('/home', { replace: true }); } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <AppHeader back title="New story" />
      <div className="scroll">
        <input ref={input} type="file" accept="image/*,video/*" hidden onChange={choose} />
        {url ? (
          <div style={{ borderRadius: 24, overflow: 'hidden', background: '#000', aspectRatio: '9/14', position: 'relative' }}>
            {file.type.startsWith('video') ? <video src={url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={url} alt="Story preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        ) : (
          <button className="card" onClick={() => input.current.click()} style={{ width: '100%', aspectRatio: '9/12', display: 'grid', placeItems: 'center', border: '2px dashed var(--line)' }}>
            <span className="center"><Camera size={44} color="var(--purple)" /><br /><b>Choose a photo or video</b><br /><span className="muted">Stories disappear after 24 hours</span></span>
          </button>
        )}
        <label className="input" style={{ margin: '14px 0' }}><input placeholder="Add a caption…" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={120} /></label>
        <div style={{ display: 'grid', gap: 10 }}>
          <Button variant="outline" onClick={() => input.current.click()}><Upload size={18} /> {url ? 'Change media' : 'Upload media'}</Button>
          <Button disabled={!file} loading={busy} onClick={post}>Share to story</Button>
        </div>
      </div>
    </div>
  );
}
