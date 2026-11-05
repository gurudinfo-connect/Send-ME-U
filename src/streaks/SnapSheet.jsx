import { useEffect, useRef, useState } from 'react';
import { X, Camera, Image as Img, Check, SwitchCamera, Send, RotateCcw, Download, Images, Sparkles } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { StreakBadge } from './components';
import { FILTERS, getFilter, paintOverlay, drawFiltered, canvasToBlob, renderFiltered, coverCrop } from './filters';
import { gallery } from './gallery';
import SnapGallery, { useGallery } from './SnapGallery';

// "Streak snap": take a photo (or upload / reuse one from your gallery), pick a filter, pick who gets it, send.
// A photo counts as today's contribution for every streak you send it to; the server (or demo service)
// decides the actual streak changes. Photos can also be saved to the on-device Gallery.

// One filter bubble: a tiny gradient swatch run through the same CSS filter the camera uses
function FilterStrip({ value, onChange, label = 'Filters' }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [value]);
  return (
    <div className="snap-filters" ref={ref} role="radiogroup" aria-label={label}>
      {FILTERS.map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={value === f.id} className={`snap-f ${value === f.id ? 'on' : ''}`} onClick={() => onChange(f.id)}>
          <span className="snap-f-sw" style={{ background: `linear-gradient(135deg, #ffd27a, #ff7a8a 45%, #6a7cff)`, filter: f.css === 'none' ? undefined : f.css }}><i style={{ background: f.swatch }} /></span>
          <small>{f.name}</small>
        </button>
      ))}
    </div>
  );
}

export default function SnapSheet({ open, onClose, chats, streaks, onSent }) {
  const notify = useUI((s) => s.notify);
  const [step, setStep] = useState('capture'); // capture | pick | gallery
  const [raw, setRaw] = useState(null);         // unfiltered photo (Blob/File). Filters are applied on top, so they can still be changed after shooting
  const [filterId, setFilterId] = useState('normal');
  const [out, setOut] = useState(null);         // { blob, url } = raw with the chosen filter applied
  const [live, setLive] = useState(false);
  const [facing, setFacing] = useState('environment');
  const [sel, setSel] = useState({});
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [flash, setFlash] = useState('');       // filter name pop-up while swiping
  const video = useRef(null); const view = useRef(null); const ov = useRef(null); const stream = useRef(null);
  const upload = useRef(null); const native = useRef(null); const touch = useRef(null); const flashT = useRef(0);
  const shots = useGallery();

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setLive(false); };
  const start = async (mode = facing) => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) return native.current?.click(); // no live camera: use the phone's camera app
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
      stream.current = st; setLive(true);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = st; video.current.play?.().catch(() => {}); } });
    } catch { notify('Camera not available. Pick a photo instead'); native.current?.click(); }
  };
  useEffect(() => { if (open) { setStep('capture'); setRaw(null); setFilterId('normal'); setSaved(false); setSel({}); start(); } else stop(); return stop; }, [open]); // eslint-disable-line

  // Filtered version of the photo for the "pick" step. `alive` drops stale results when the filter changes quickly.
  useEffect(() => {
    if (!raw) { setOut(null); return undefined; }
    let alive = true; let url = '';
    renderFiltered(raw, filterId).then((blob) => { if (!alive) return; url = URL.createObjectURL(blob); setOut({ blob, url }); })
      .catch(() => { if (alive) { notify('Could not apply that filter'); setFilterId('normal'); } });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [raw, filterId]); // eslint-disable-line

  // Live overlay (vignette, tint, grain, frame...) drawn over the viewfinder with the same code used when the photo is taken
  useEffect(() => {
    const c = ov.current; const v = view.current; if (!c || !v || step !== 'capture') return;
    const w = Math.max(2, Math.round(v.clientWidth)); const h = Math.max(2, Math.round(v.clientHeight));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    paintOverlay(c.getContext('2d'), w, h, filterId);
  }, [filterId, step, live, open]);

  if (!open) return null;

  const pickFilter = (id, announce) => { setFilterId(id); setSaved(false); if (announce) { setFlash(getFilter(id).name); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(''), 900); } };
  const step1 = (dir) => { const i = FILTERS.findIndex((f) => f.id === filterId); pickFilter(FILTERS[(i + dir + FILTERS.length) % FILTERS.length].id, true); };
  const onTouchStart = (e) => { const t = e.touches?.[0] || e; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null; if (!s) return;
    const t = e.changedTouches?.[0] || e; const dx = t.clientX - s.x; const dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step1(dx < 0 ? 1 : -1);
  };

  const shoot = async () => {
    const v = video.current; const box = view.current; if (!v?.videoWidth || !box) return;
    try {
      // Save exactly what the viewfinder shows (cover-crop) and mirror selfies like the preview. Filter is applied later so it stays changeable.
      const crop = coverCrop(v.videoWidth, v.videoHeight, box.clientWidth, box.clientHeight);
      const c = drawFiltered(v, v.videoWidth, v.videoHeight, 'normal', { mirror: facing === 'user', crop });
      const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
      setRaw(new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' })); setSaved(false); stop(); setStep('pick');
    } catch { notify('Could not take the photo. Try again'); }
  };
  const chosen = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; stop(); setRaw(f); setSaved(false); setStep('pick'); };
  const retake = () => { setRaw(null); setSaved(false); setStep('capture'); start(); };
  const flip = () => { const m = facing === 'user' ? 'environment' : 'user'; setFacing(m); start(m); };
  const close = () => { stop(); onClose(); };
  const openGallery = () => { stop(); setStep('gallery'); };
  const fromGallery = (item) => { setRaw(item.blob); setFilterId('normal'); setSaved(true); setStep('pick'); }; // already in the gallery: no need to save again

  const save = async () => {
    if (!out || saved) return;
    try { await gallery.add(out.blob, { filter: filterId }); setSaved(true); notify('Saved to your gallery'); } catch { notify('Could not save. Storage may be full'); }
  };

  // streak friends first (owing today before done), then the rest, A-Z
  const rank = (c) => { const s = streaks[c.id]; return s?.count > 0 ? (s.doneToday || s.me ? 1 : 0) : 2; };
  const list = chats.filter((c) => c.type === 'direct').sort((a, b) => rank(a) - rank(b) || (streaks[b.id]?.count || 0) - (streaks[a.id]?.count || 0) || a.name.localeCompare(b.name));
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const allStreaks = () => { const n = {}; list.forEach((c) => { if (streaks[c.id]?.count > 0) n[c.id] = true; }); setSel(n); };

  const send = async () => {
    if (!out || !ids.length || sending) return;
    setSending(true);
    const file = new File([out.blob], `snap-${Date.now()}.jpg`, { type: out.blob.type || 'image/jpeg' });
    const res = await Promise.allSettled(ids.map((id) => api.sendMedia(id, file, 'image')));
    const ok = ids.filter((_, i) => res[i].status === 'fulfilled');
    setSending(false);
    if (!ok.length) return notify(errMsg(res[0].reason));
    let line = `Sent to ${ok.length} ${ok.length === 1 ? 'friend' : 'friends'}`;
    try {
      const after = await Promise.all(ok.map((id) => api.streak(id).catch(() => null)));
      const up = after.filter((s) => s?.count > 0 && s.doneToday).map((s) => `${s.friend.name} 🔥${s.count}`);
      if (up.length) line += `. Streak ${up.join(', ')}`;
    } catch { /* streak info is optional */ }
    notify(line); onSent?.(); close();
  };

  if (step === 'gallery') return <SnapGallery onBack={() => { setStep('capture'); start(); }} onClose={close} onUse={fromGallery} />;

  const last = shots[0];
  return (
    <div className="snap" role="dialog" aria-modal="true" aria-label="Send a streak photo">
      <input ref={upload} type="file" accept="image/*" hidden onChange={chosen} />
      <input ref={native} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
      <header className="snap-top">
        <button className="icon-btn" aria-label="Close" onClick={close}><X size={24} /></button>
        <b>{step === 'capture' ? 'Streak snap' : 'Send to'}</b>
        {step === 'capture' ? <button className="icon-btn" aria-label="Flip camera" onClick={flip} disabled={!live}><SwitchCamera size={22} /></button> : <button className="icon-btn" aria-label="Retake" onClick={retake}><RotateCcw size={21} /></button>}
      </header>

      {step === 'capture' && (
        <div className="snap-cam">
          <div className="snap-view" ref={view} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onMouseDown={onTouchStart} onMouseUp={onTouchEnd}>
            {live
              ? <video ref={video} playsInline muted style={{ filter: getFilter(filterId).css === 'none' ? undefined : getFilter(filterId).css, transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />
              : <div className="snap-off"><Camera size={40} /><p>Take a photo, or upload one, to send to friends and keep your streaks going.</p></div>}
            <canvas ref={ov} className="snap-ov" aria-hidden />
            {flash && <div className="snap-flash" aria-live="polite">{flash}</div>}
          </div>
          <FilterStrip value={filterId} onChange={(id) => pickFilter(id, false)} />
          <div className="snap-ctrl">
            <button className="snap-side" onClick={() => upload.current?.click()} aria-label="Upload a photo"><Img size={24} /><small>Upload</small></button>
            {live ? <button className="snap-shutter" onClick={shoot} aria-label="Take photo"><i /></button> : <button className="snap-shutter off" onClick={() => start()} aria-label="Open camera"><Camera size={28} /></button>}
            <button className="snap-side snap-gal" onClick={openGallery} aria-label={`Open gallery${shots.length ? `, ${shots.length} photos` : ''}`}>
              {last ? <GalThumb item={last} /> : <Images size={24} />}
              <small>Gallery{shots.length ? ` (${shots.length})` : ''}</small>
            </button>
          </div>
        </div>
      )}

      {step === 'pick' && (
        <div className="snap-pick">
          <div className="snap-prev">{out ? <img src={out.url} alt="Your photo" /> : <div className="snap-wait"><Sparkles size={22} /></div>}</div>
          <FilterStrip value={filterId} onChange={(id) => pickFilter(id, false)} label="Photo filters" />
          <div className="snap-quick">
            <span>{ids.length ? `${ids.length} selected` : 'Choose who gets it'}</span>
            <span className="snap-qa">
              <button onClick={save} disabled={!out || saved} aria-label="Save to gallery">{saved ? <><Check size={14} /> Saved</> : <><Download size={14} /> Save</>}</button>
              <button onClick={allStreaks}>All streak friends</button>
            </span>
          </div>
          <div className="snap-list" role="group" aria-label="Recipients">
            {list.length === 0 && <p className="st-empty">No friends to send to yet.</p>}
            {list.map((c) => {
              const s = streaks[c.id]; const on = !!sel[c.id];
              return (
                <button key={c.id} className={`snap-row ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} onClick={() => toggle(c.id)}>
                  <img src={c.avatar} alt="" />
                  <span className="grow"><b>{c.name}</b><small>{s?.count > 0 ? (s.doneToday || s.me ? 'Streak safe for today' : s.status === 'at_risk' ? 'Streak at risk. A photo keeps it going' : 'Waiting for you today') : 'No streak yet'}</small></span>
                  <StreakBadge s={s} />
                  <span className="snap-check">{on && <Check size={14} strokeWidth={3} />}</span>
                </button>
              );
            })}
          </div>
          <button className="snap-send" disabled={!out || !ids.length || sending} onClick={send}><Send size={18} />{sending ? 'Sending…' : ids.length ? `Send to ${ids.length}` : 'Select friends'}</button>
        </div>
      )}
    </div>
  );
}

// Small round preview of the newest saved photo (object URL is revoked when it changes)
function GalThumb({ item }) {
  const [u, setU] = useState('');
  useEffect(() => { const x = URL.createObjectURL(item.blob); setU(x); return () => URL.revokeObjectURL(x); }, [item.id]); // eslint-disable-line
  return <span className="snap-gt">{u && <img src={u} alt="" />}</span>;
}
