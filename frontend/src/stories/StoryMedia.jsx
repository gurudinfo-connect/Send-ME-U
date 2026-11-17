import { useEffect, useRef } from 'react';

// Shared by the story editor and the story viewer so a story looks identical while editing and while watching.
export const FILTERS = [
  { id: 'none', name: 'Original', css: 'none' },
  { id: 'warm', name: 'Warm', css: 'sepia(.25) saturate(1.3) hue-rotate(-8deg) brightness(1.04)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.02) contrast(1.05)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.65) contrast(1.12)' },
  { id: 'golden', name: 'Golden', css: 'sepia(.4) saturate(1.6) hue-rotate(-15deg)' },
  { id: 'fade', name: 'Fade', css: 'contrast(.85) brightness(1.12) saturate(.8)' },
  { id: 'cine', name: 'Cinematic', css: 'contrast(1.2) saturate(.9) sepia(.15) brightness(.92)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.15)' },
];
export const filterCss = (id) => FILTERS.find((f) => f.id === id)?.css || 'none';

// media (photo or video) with filter + rotate / flip / zoom / pan applied
export function StoryMedia({ item, muted = true, alt = '' }) {
  const t = item.transform || {}; const odd = (t.rot || 0) % 180 !== 0;
  // 'contain' shows the WHOLE picture (any aspect ratio) over a blurred copy; 'cover' fills the screen and crops. Older items default to cover.
  const fit = t.fit || 'cover';
  const style = {
    filter: filterCss(item.filter), position: 'absolute', left: '50%', top: '50%', objectFit: fit, maxWidth: 'none',
    width: odd ? '100cqh' : '100cqw', height: odd ? '100cqw' : '100cqh',
    transform: `translate(-50%,-50%) translate(${t.x || 0}%,${t.y || 0}%) rotate(${t.rot || 0}deg) scale(${t.flip ? -1 : 1},1) scale(${t.zoom || 1})`,
  };
  const bg = { filter: `${filterCss(item.filter) === 'none' ? '' : `${filterCss(item.filter)} `}blur(28px) brightness(.62)`, transform: 'scale(1.25)' };
  const video = item.type === 'video';
  return (
    <div className="sm-wrap">
      {fit === 'contain' && (video
        ? <video className="sm-bg" src={item.src} style={bg} autoPlay loop playsInline muted />
        : <img className="sm-bg" src={item.src} alt="" style={bg} draggable={false} />)}
      {video
        ? <video src={item.src} style={style} autoPlay loop playsInline muted={muted} />
        : <img src={item.src} alt={alt} style={style} draggable={false} />}
    </div>
  );
}

export function drawStrokes(ctx, strokes, w, h) {
  ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.c; ctx.lineWidth = s.w * w; ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * w + .01, s.pts[0][1] * h);
    ctx.stroke();
  }
}
export function StrokeCanvas({ strokes }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const paint = () => {
      const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
      drawStrokes(c.getContext('2d'), strokes, c.width, c.height);
    };
    paint(); const ro = new ResizeObserver(paint); ro.observe(c); return () => ro.disconnect();
  }, [strokes]);
  return <canvas ref={ref} className="so-canvas" />;
}

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
export const itemClass = (it) => `so-item ${it.kind} ${it.kind === 'text' ? `ts-${it.style || 'plain'} tf-${it.font || 'sans'}` : ''}`;
export const itemStyle = (it) => {
  const st = { left: `${it.x * 100}%`, top: `${it.y * 100}%`, fontSize: `${it.size}cqw`, transform: `translate(-50%,-50%) rotate(${it.rot || 0}deg)` };
  if (it.kind === 'text') {
    if (it.style === 'bg') { st.background = it.color; st.color = lum(it.color) > .6 ? '#111' : '#fff'; } else st.color = it.color;
  }
  return st;
};

// read-only drawing + text + stickers layer (the editor draws the same thing with interactive items)
export function StoryOverlay({ overlay }) {
  if (!overlay || (!overlay.strokes?.length && !overlay.items?.length)) return null;
  return (
    <div className="so-wrap" aria-hidden>
      <StrokeCanvas strokes={overlay.strokes || []} />
      {(overlay.items || []).map((it) => <div key={it.id} className={itemClass(it)} style={itemStyle(it)}>{it.text}</div>)}
    </div>
  );
}
