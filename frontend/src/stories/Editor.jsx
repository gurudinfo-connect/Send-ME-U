import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, AtSign, Check, ChevronUp, Crop, FlipHorizontal, ImagePlus, Mic, Music, Pause, Pencil, Play, RotateCw, Send, Smile, Sparkles, Square, Trash2, Type, Undo2, Upload, Users, X, Globe2 } from 'lucide-react';
import { Avatar, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { FILTERS, StoryMedia, StrokeCanvas, filterCss, itemClass, itemStyle } from './StoryMedia';
import { TRACKS, renderTrack, startRecording } from './audio';

const COLORS = ['#ffffff', '#000000', '#ff3b5c', '#ff8a00', '#ffd166', '#2ecc71', '#19a8ff', '#7a5af0', '#ff86b8'];
const EMOJI = {
  Smileys: ['😀', '😍', '😂', '🥰', '😎', '🤩', '😭', '😘', '🥳', '😇', '🤔', '😴', '🙌', '👏', '🙏', '💪'],
  Love: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💖', '💕', '💞', '💘', '😻', '💋', '🌹', '💍', '🫶'],
  Fun: ['🔥', '✨', '🎉', '🎶', '🏍️', '🚗', '✈️', '🌅', '🌈', '☀️', '🌙', '⭐', '🍕', '🍔', '☕', '🎂'],
};
const FONTS = ['sans', 'serif', 'mono', 'hand'];
const AUDIENCES = [
  { id: 'contacts', label: 'My contacts', sub: 'Everyone in your contacts', icon: Users },
  { id: 'close', label: 'Close friends', sub: 'Only your close friends', icon: Users },
  { id: 'except', label: 'Only share with…', sub: 'Pick specific people', icon: Users },
  { id: 'public', label: 'Public', sub: 'Anyone on Send ME/U', icon: Globe2 },
];
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function StoryCreate() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const people = useAsync(() => api.people(), []);
  const pick = useRef(null), audioPick = useRef(null), stage = useRef(null);

  const [file, setFile] = useState(null); const [url, setUrl] = useState('');
  const [tool, setTool] = useState(null); // text | sticker | draw | crop | music | filters | mention | audience
  const [caption, setCaption] = useState(''); const [mentions, setMentions] = useState([]);
  const [filter, setFilter] = useState('none');
  const [tr, setTr] = useState({ rot: 0, flip: false, zoom: 1, x: 0, y: 0, fit: 'contain' });
  const [items, setItems] = useState([]); const [strokes, setStrokes] = useState([]);
  const [audio, setAudio] = useState(null); // { src, name, start, blob? }
  const [audience, setAudience] = useState({ id: 'contacts', ids: [] });
  const [busy, setBusy] = useState(false);

  // ---- media ----
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  const choose = (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setFile(f); setUrl(URL.createObjectURL(f)); setFilter('none'); setTr({ rot: 0, flip: false, zoom: 1, x: 0, y: 0, fit: 'contain' });
  };
  const item = useMemo(() => ({ src: url, type: file?.type.startsWith('video') ? 'video' : 'image', filter, transform: tr }), [url, file, filter, tr]);

  // ---- text ----
  const [draft, setDraft] = useState(null); // { id?, text, color, style, font, size }
  const openText = (it) => { setDraft(it ? { ...it } : { text: '', color: '#ffffff', style: 'bg', font: 'sans', size: 8 }); setTool('text'); };
  const saveText = () => {
    if (draft.text.trim()) setItems((l) => (draft.id ? l.map((x) => (x.id === draft.id ? { ...x, ...draft } : x)) : [...l, { id: uid(), kind: 'text', x: .5, y: .45, rot: 0, ...draft }]));
    else if (draft.id) setItems((l) => l.filter((x) => x.id !== draft.id));
    setDraft(null); setTool(null);
  };
  const addSticker = (text) => {
    const emoji = /^\p{Extended_Pictographic}/u.test(text) && text.length <= 4;
    setItems((l) => [...l, emoji ? { id: uid(), kind: 'sticker', text, x: .5, y: .4, size: 22, rot: 0, color: '#fff' } : { id: uid(), kind: 'text', text, x: .5, y: .4, size: 8, rot: 0, color: '#ffffff', style: 'bg', font: 'sans' }]);
    setTool(null);
  };

  // ---- drag / pinch / delete for text + sticker items ----
  const ptrs = useRef(new Map()); const drag = useRef(null); const [dragging, setDragging] = useState(null); const [hot, setHot] = useState(false);
  const itemDown = (e, it) => {
    if (tool) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.current.getBoundingClientRect();
    drag.current = { id: it.id, moved: false, x0: it.x, y0: it.y, px: e.clientX, py: e.clientY, size0: it.size, rot0: it.rot || 0, w: r.width, h: r.height, pin: null };
    setDragging(it.id);
  };
  const itemMove = (e) => {
    const d = drag.current; if (!d || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts, dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      d.pin ||= { dist, ang }; d.moved = true;
      setItems((l) => l.map((x) => (x.id === d.id ? { ...x, size: clamp(d.size0 * dist / d.pin.dist, 3, 60), rot: d.rot0 + ang - d.pin.ang } : x)));
      return;
    }
    const dx = e.clientX - d.px, dy = e.clientY - d.py; if (Math.hypot(dx, dy) > 4) d.moved = true; if (!d.moved) return;
    const nx = clamp(d.x0 + dx / d.w, 0, 1), ny = clamp(d.y0 + dy / d.h, 0, 1);
    setItems((l) => l.map((x) => (x.id === d.id ? { ...x, x: nx, y: ny } : x))); setHot(ny > .86 && Math.abs(nx - .5) < .18);
  };
  const itemUp = (e, it) => {
    ptrs.current.delete(e.pointerId); const d = drag.current; if (!d) return;
    if (ptrs.current.size) { d.pin = null; d.size0 = items.find((x) => x.id === d.id)?.size; d.rot0 = items.find((x) => x.id === d.id)?.rot || 0; return; }
    drag.current = null; setDragging(null);
    const cur = items.find((x) => x.id === d.id);
    if (hot && cur) setItems((l) => l.filter((x) => x.id !== d.id));
    else if (!d.moved && it.kind === 'text') openText(it);
    setHot(false);
  };

  // ---- drawing ----
  const [pen, setPen] = useState({ c: '#ff3b5c', w: .012 }); const cur = useRef(null);
  const norm = (e) => { const r = stage.current.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  const drawDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = { c: pen.c, w: pen.w, pts: [norm(e)] }; setStrokes((s) => [...s, cur.current]); };
  const drawMove = (e) => { if (!cur.current) return; cur.current = { ...cur.current, pts: [...cur.current.pts, norm(e)] }; setStrokes((s) => [...s.slice(0, -1), cur.current]); };
  const drawUp = () => { cur.current = null; };

  // ---- crop pan ----
  const pan = useRef(null);
  const panDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); pan.current = { px: e.clientX, py: e.clientY, x: tr.x, y: tr.y }; };
  const panMove = (e) => {
    if (!pan.current) return; const r = stage.current.getBoundingClientRect(), lim = (tr.zoom - 1) * 50;
    setTr((t) => ({ ...t, x: clamp(pan.current.x + (e.clientX - pan.current.px) / r.width * 100, -lim, lim), y: clamp(pan.current.y + (e.clientY - pan.current.py) / r.height * 100, -lim, lim) }));
  };

  // ---- music ----
  const [mtab, setMtab] = useState('library'); const [preview, setPreview] = useState(null); const [loadingTrack, setLoadingTrack] = useState(null);
  const [rec, setRec] = useState(null); const [recSecs, setRecSecs] = useState(0); const player = useRef(null);
  const stopPreview = () => { player.current?.pause(); player.current = null; setPreview(null); };
  useEffect(() => () => player.current?.pause(), []);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setRecSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [rec]);
  const playUrl = (key, src, start = 0) => {
    if (preview === key) return stopPreview();
    stopPreview(); const a = new Audio(src); a.currentTime = start; a.onended = () => setPreview(null); a.play().catch(() => notify('Tap again to play')); player.current = a; setPreview(key);
  };
  const libPlay = async (t) => { try { setLoadingTrack(t.id); const src = await renderTrack(t.id); playUrl(t.id, src); } catch (e) { notify(errMsg(e)); } finally { setLoadingTrack(null); } };
  const libUse = async (t) => { try { setLoadingTrack(t.id); const src = await renderTrack(t.id); stopPreview(); setAudio({ src, name: t.name, artist: 'Send ME/U Originals', start: 0, blob: await fetch(src).then((r) => r.blob()) }); setTool(null); } catch (e) { notify(errMsg(e)); } finally { setLoadingTrack(null); } };
  const audioChosen = (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const src = URL.createObjectURL(f), a = new Audio(src);
    a.onloadedmetadata = () => { stopPreview(); setAudio({ src, name: f.name.replace(/\.[^.]+$/, ''), artist: 'From your device', start: 0, duration: a.duration, blob: f }); setTool(null); };
    a.onerror = () => notify('That audio file could not be played');
  };
  const recToggle = async () => {
    if (rec) { const blob = await rec.stop(); setRec(null); const src = URL.createObjectURL(blob); stopPreview(); setAudio({ src, name: 'Voice note', artist: 'Recorded now', start: 0, blob }); setTool(null); return; }
    try { stopPreview(); setRecSecs(0); setRec(await startRecording()); } catch { notify('Microphone permission is needed to record'); }
  };

  // ---- people / audience / mentions ----
  const ppl = people.data || [];
  const addMention = (p) => { const tag = `@${p.name.split(' ')[0]}`; setCaption((c) => `${c}${c && !c.endsWith(' ') ? ' ' : ''}${tag} `); setMentions((m) => (m.includes(p.id) ? m : [...m, p.id])); setTool(null); };
  const audLabel = audience.id === 'except' ? `Story (${audience.ids.length} selected)` : { contacts: 'Story (Contacts)', close: 'Story (Close friends)', public: 'Story (Public)' }[audience.id];

  // ---- post ----
  const post = async () => {
    if (!file || busy) return; setBusy(true);
    try {
      await api.createStory({ file, caption, mentions, filter, transform: tr, overlay: { strokes, items }, audio, audience });
      notify('Story posted'); nav('/stories?u=s0&new=1', { replace: true });
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  const close = () => { stopPreview(); if (tool) { setTool(null); setDraft(null); return; } nav(-1); };

  // ---------------- empty state: choose media ----------------
  if (!file) {
    return (
      <div className="screen se-pick">
        <input ref={pick} type="file" accept="image/*,video/*" hidden onChange={choose} />
        <button className="se-x" aria-label="Close" onClick={() => nav(-1)}><X size={22} /></button>
        <div className="se-pick-card">
          <span className="se-pick-ic"><ImagePlus size={40} /></span>
          <h2>Create a story</h2>
          <p>Add a photo or video, then decorate it with music, text, stickers and drawings.</p>
          <button className="se-send wide" onClick={() => pick.current.click()}><Upload size={18} /> Choose photo or video</button>
          <small>Stories disappear after 24 hours</small>
        </div>
      </div>
    );
  }

  const musicOn = tool === 'music', hide = tool === 'text' || tool === 'draw' || tool === 'crop';
  return (
    <div className="screen se">
      <input ref={pick} type="file" accept="image/*,video/*" hidden onChange={choose} />
      <input ref={audioPick} type="file" accept="audio/*" hidden onChange={audioChosen} />

      {/* ============ stage ============ */}
      <div className="se-stage" ref={stage}>
        <StoryMedia item={item} muted={!!audio} />
        <div className="se-shade" />
        <div className="so-wrap">
          <StrokeCanvas strokes={strokes} />
          {items.map((it) => (
            <div key={it.id} className={`${itemClass(it)} ${dragging === it.id ? 'drag' : ''} ${tool === 'text' && draft?.id === it.id ? 'ghost' : ''}`} style={itemStyle(it)}
              onPointerDown={(e) => itemDown(e, it)} onPointerMove={itemMove} onPointerUp={(e) => itemUp(e, it)} onPointerCancel={(e) => itemUp(e, it)}>{it.text}</div>
          ))}
        </div>
        {dragging && <div className={`se-trash ${hot ? 'hot' : ''}`}><Trash2 size={22} /></div>}
        {tool === 'draw' && <div className="se-draw-layer" onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={drawUp} />}
        {tool === 'crop' && <div className="se-draw-layer pan" onPointerDown={panDown} onPointerMove={panMove} onPointerUp={() => { pan.current = null; }} />}
        {audio && !tool && <button className="se-music-chip" onClick={() => setTool('music')}><Music size={14} /> {audio.name}<i role="button" aria-label="Remove music" onClick={(e) => { e.stopPropagation(); setAudio(null); }}><X size={13} /></i></button>}
      </div>

      {/* ============ top bar ============ */}
      {!hide && (
        <div className="se-top">
          <button className="se-ib" aria-label="Close" onClick={close}><X size={22} /></button>
          <div className="se-tools">
            <button className={`se-ib ${audio ? 'on' : ''}`} aria-label="Add music" onClick={() => setTool('music')}><Music size={21} /></button>
            <button className={`se-ib ${tr.rot || tr.flip || tr.zoom > 1 || tr.fit === 'cover' ? 'on' : ''}`} aria-label="Crop and rotate" onClick={() => setTool('crop')}><Crop size={21} /></button>
            <button className="se-ib" aria-label="Add sticker" onClick={() => setTool('sticker')}><Smile size={21} /></button>
            <button className="se-ib" aria-label="Add text" onClick={() => openText()}><Type size={21} /></button>
            <button className={`se-ib ${strokes.length ? 'on' : ''}`} aria-label="Draw" onClick={() => setTool('draw')}><Pencil size={21} /></button>
          </div>
        </div>
      )}

      {/* ============ bottom ============ */}
      {!hide && (
        <div className="se-bottom">
          {tool === 'filters' ? (
            <div className="se-filters">
              {FILTERS.map((f) => (
                <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)} aria-label={`${f.name} filter`}>
                  {item.type === 'video' ? <span className="ph" style={{ filter: f.css }} /> : <img src={url} alt="" style={{ filter: f.css }} />}<small>{f.name}</small>
                </button>
              ))}
              <button className="se-done" onClick={() => setTool(null)} aria-label="Done"><Check size={20} /></button>
            </div>
          ) : (
            <button className="se-restyle" onClick={() => setTool('filters')}><ChevronUp size={16} /><span><Sparkles size={15} /> Restyle{filter !== 'none' ? ` · ${FILTERS.find((f) => f.id === filter).name}` : ''}</span></button>
          )}
          <label className="se-caption">
            <button type="button" aria-label="Change photo or video" onClick={() => pick.current.click()}><ImagePlus size={22} /></button>
            <input placeholder="Add a caption…" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
            <button type="button" aria-label="Mention someone" onClick={() => setTool('mention')}><AtSign size={22} /></button>
          </label>
          <div className="se-foot">
            <button className="se-aud" onClick={() => setTool('audience')}><Users size={16} /> {audLabel}</button>
            <button className="se-send" aria-label="Post story" disabled={busy} onClick={post}>{busy ? <span className="se-spin" /> : <Send size={22} />}</button>
          </div>
        </div>
      )}

      {/* ============ text editor ============ */}
      {tool === 'text' && draft && (
        <div className="se-text">
          <div className="se-text-top">
            <button className="se-ib" aria-label="Cancel" onClick={() => { setDraft(null); setTool(null); }}><X size={22} /></button>
            <div className="se-tools">
              <button className="se-ib" aria-label="Text style" onClick={() => setDraft((d) => ({ ...d, style: { plain: 'bg', bg: 'outline', outline: 'plain' }[d.style] }))}><span className={`se-A ts-${draft.style}`}>A</span></button>
              <button className="se-ib" aria-label="Font" onClick={() => setDraft((d) => ({ ...d, font: FONTS[(FONTS.indexOf(d.font) + 1) % FONTS.length] }))}><span className={`tf-${draft.font}`} style={{ fontSize: 18 }}>Aa</span></button>
            </div>
            <button className="se-done" onClick={saveText}>Done</button>
          </div>
          <div className="se-text-mid">
            <textarea autoFocus rows={3} value={draft.text} placeholder="Type something…" onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              className={`so-item text ts-${draft.style} tf-${draft.font}`} style={{ position: 'static', transform: 'none', fontSize: 30, ...(draft.style === 'bg' ? { background: draft.color, color: draft.color === '#ffffff' ? '#111' : '#fff' } : { color: draft.color }) }} />
          </div>
          <input className="se-range" type="range" min="4" max="16" step=".5" value={draft.size} aria-label="Text size" onChange={(e) => setDraft({ ...draft, size: +e.target.value })} />
          <div className="se-colors">{COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} className={draft.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} />)}</div>
        </div>
      )}

      {/* ============ draw ============ */}
      {tool === 'draw' && (
        <>
          <div className="se-text-top over">
            <button className="se-ib" aria-label="Undo" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}><Undo2 size={21} /></button>
            <button className="se-done" onClick={() => setTool(null)}>Done</button>
          </div>
          <div className="se-draw-bar">
            <input className="se-range" type="range" min="6" max="40" value={pen.w * 1000} aria-label="Brush size" onChange={(e) => setPen({ ...pen, w: e.target.value / 1000 })} />
            <div className="se-colors">{COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} className={pen.c === c ? 'on' : ''} style={{ background: c }} onClick={() => setPen({ ...pen, c })} />)}</div>
          </div>
        </>
      )}

      {/* ============ crop / rotate ============ */}
      {tool === 'crop' && (
        <>
          <div className="se-text-top over"><button className="se-ib" aria-label="Reset" onClick={() => setTr({ rot: 0, flip: false, zoom: 1, x: 0, y: 0, fit: 'contain' })}><Undo2 size={21} /></button><span className="se-hint">Drag to reposition</span><button className="se-done" onClick={() => setTool(null)}>Done</button></div>
          <div className="se-draw-bar">
            <div className="se-crop-row">
              <button className="se-pill" onClick={() => setTr((t) => ({ ...t, rot: (t.rot + 90) % 360 }))}><RotateCw size={18} /> Rotate</button>
              <button className="se-pill" onClick={() => setTr((t) => ({ ...t, flip: !t.flip }))}><FlipHorizontal size={18} /> Flip</button>
              <button className="se-pill" onClick={() => setTr((t) => ({ ...t, fit: t.fit === 'cover' ? 'contain' : 'cover', x: 0, y: 0 }))}>{tr.fit === 'cover' ? <Minimize2 size={18} /> : <Maximize2 size={18} />} {tr.fit === 'cover' ? 'Fit' : 'Fill'}</button>
            </div>
            <input className="se-range" type="range" min="1" max="3" step=".01" value={tr.zoom} aria-label="Zoom" onChange={(e) => { const z = +e.target.value, lim = (z - 1) * 50; setTr((t) => ({ ...t, zoom: z, x: clamp(t.x, -lim, lim), y: clamp(t.y, -lim, lim) })); }} />
          </div>
        </>
      )}

      {/* ============ sheets ============ */}
      {['sticker', 'music', 'mention', 'audience'].includes(tool) && (
        <div className="se-scrim" onClick={() => { stopPreview(); setTool(null); }}>
          <div className="se-sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sv-grab" />
            {tool === 'sticker' && (
              <>
                <div className="se-sheet-h"><b>Stickers</b><button className="icon-btn" aria-label="Close" onClick={() => setTool(null)}><X size={20} /></button></div>
                <div className="se-chips">
                  <button onClick={() => addSticker(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}>🕒 Time</button>
                  <button onClick={() => addSticker(new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}>📅 Date</button>
                  <button onClick={() => addSticker('📍 Bengaluru')}>📍 Location</button>
                  <button onClick={() => addSticker('#vibes')}># Hashtag</button>
                </div>
                <div className="se-emoji">{Object.entries(EMOJI).map(([k, l]) => <div key={k}><small>{k}</small><div>{l.map((e) => <button key={e} aria-label={e} onClick={() => addSticker(e)}>{e}</button>)}</div></div>)}</div>
              </>
            )}
            {tool === 'music' && (
              <>
                <div className="se-sheet-h"><b>Add music</b><button className="icon-btn" aria-label="Close" onClick={() => { stopPreview(); setTool(null); }}><X size={20} /></button></div>
                <div className="sv-tabs" role="tablist">
                  {[['library', 'Library'], ['upload', 'My audio'], ['voice', 'Voice']].map(([k, l]) => <button key={k} role="tab" aria-selected={mtab === k} className={mtab === k ? 'on' : ''} onClick={() => { stopPreview(); setMtab(k); }}>{l}</button>)}
                </div>
                {audio && (
                  <div className="se-now">
                    <Music size={18} /><div><b>{audio.name}</b><small>{audio.artist}</small></div>
                    <button className="se-pill" onClick={() => playUrl('now', audio.src, audio.start)}>{preview === 'now' ? <Pause size={16} /> : <Play size={16} />}</button>
                    <button className="se-pill" aria-label="Remove music" onClick={() => { stopPreview(); setAudio(null); }}><Trash2 size={16} /></button>
                    {audio.duration > 16 && <label className="se-trim">Start at {fmt(audio.start)}<input type="range" min="0" max={Math.floor(audio.duration - 15)} value={audio.start} onChange={(e) => setAudio({ ...audio, start: +e.target.value })} /></label>}
                  </div>
                )}
                {mtab === 'library' && (
                  <div className="se-tracks">
                    {TRACKS.map((t) => (
                      <div key={t.id} className={`se-track ${audio?.name === t.name ? 'sel' : ''}`}>
                        <button className="se-play" aria-label={`Preview ${t.name}`} onClick={() => libPlay(t)}>{loadingTrack === t.id ? <span className="se-spin dark" /> : preview === t.id ? <Pause size={18} /> : <Play size={18} />}</button>
                        <div><b>{t.name}</b><small>{t.mood} · {t.bpm} BPM · 15s</small></div>
                        <button className="se-use" onClick={() => libUse(t)}>Use</button>
                      </div>
                    ))}
                  </div>
                )}
                {mtab === 'upload' && (
                  <div className="se-empty"><Upload size={30} /><p>Pick an audio file from your phone (MP3, M4A, WAV…). You can choose where the clip starts.</p><button className="se-send wide" onClick={() => audioPick.current.click()}>Choose audio file</button></div>
                )}
                {mtab === 'voice' && (
                  <div className="se-empty">
                    <button className={`se-rec ${rec ? 'on' : ''}`} aria-label={rec ? 'Stop recording' : 'Start recording'} onClick={recToggle}>{rec ? <Square size={26} fill="#fff" /> : <Mic size={30} />}</button>
                    <p>{rec ? `Recording… ${fmt(recSecs)} — tap to stop and use` : 'Tap to record a voice note for your story'}</p>
                  </div>
                )}
              </>
            )}
            {tool === 'mention' && (
              <>
                <div className="se-sheet-h"><b>Mention someone</b><button className="icon-btn" aria-label="Close" onClick={() => setTool(null)}><X size={20} /></button></div>
                <div className="se-people">{ppl.map((p) => <button key={p.id} onClick={() => addMention(p)}><Avatar src={p.avatar} size={42} /><span><b>{p.name}</b><small>{p.handle}</small></span></button>)}</div>
              </>
            )}
            {tool === 'audience' && (
              <>
                <div className="se-sheet-h"><b>Who can see your story?</b><button className="icon-btn" aria-label="Close" onClick={() => setTool(null)}><X size={20} /></button></div>
                <div className="se-aud-list">
                  {AUDIENCES.map((a) => (
                    <button key={a.id} className={audience.id === a.id ? 'on' : ''} onClick={() => { setAudience((x) => ({ ...x, id: a.id })); if (a.id !== 'except') setTool(null); }}>
                      <span className="se-radio">{audience.id === a.id && <Check size={14} />}</span><span><b>{a.label}</b><small>{a.sub}</small></span>
                    </button>
                  ))}
                </div>
                {audience.id === 'except' && (
                  <div className="se-people pick">
                    {ppl.map((p) => { const on = audience.ids.includes(p.id); return (
                      <button key={p.id} className={on ? 'on' : ''} onClick={() => setAudience((a) => ({ ...a, ids: on ? a.ids.filter((x) => x !== p.id) : [...a.ids, p.id] }))}>
                        <Avatar src={p.avatar} size={40} /><span><b>{p.name}</b></span><span className="se-radio sq">{on && <Check size={14} />}</span>
                      </button>); })}
                    <button className="se-send wide" onClick={() => setTool(null)}>Done ({audience.ids.length})</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
