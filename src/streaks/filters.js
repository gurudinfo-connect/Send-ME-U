// Camera filters for streak snaps.
// Each filter = a CSS/canvas `filter` string (colour grading) + an optional overlay painted with normal
// compositing (vignette, tint, grain, frame, stamp). Because the overlay never uses blend modes, the live
// preview (video + CSS filter + overlay canvas) matches the captured photo (canvas ctx.filter + same overlay).
// This file has no DOM access at import time so it can be unit tested in Node.

const grad = (c, w, h, stops, dir = 'v') => {
  const g = dir === 'v' ? c.createLinearGradient(0, 0, 0, h) : c.createLinearGradient(0, 0, w, h);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
};
const vignette = (strength = 0.55) => (c, w, h) => {
  const r = Math.hypot(w, h) / 2; const g = c.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`); c.fillStyle = g; c.fillRect(0, 0, w, h);
};
// deterministic grain so preview and capture look the same
const grain = (amount = 0.14) => (c, w, h) => {
  const s = 3; const gw = Math.ceil(w / s); const gh = Math.ceil(h / s);
  const t = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(gw, gh) : Object.assign(document.createElement('canvas'), { width: gw, height: gh });
  const tc = t.getContext('2d'); const img = tc.createImageData(gw, gh); let seed = 1337;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647; const v = (seed & 255) > 127 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = ((seed >> 8) & 255) * amount;
  }
  tc.putImageData(img, 0, 0); c.imageSmoothingEnabled = false; c.drawImage(t, 0, 0, w, h);
};
const stamp = (text = () => new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()) => (c, w, h) => {
  const px = Math.round(Math.min(w, h) * 0.045);
  c.font = `700 ${px}px "Courier New", monospace`; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(255,120,0,.8)'; c.shadowBlur = px * 0.5; c.fillStyle = '#ffb347';
  c.fillText(text(), w - px, h - px); c.shadowBlur = 0;
};
const frame = (color = '#fff', side = 0.045, bottom = 0.16) => (c, w, h) => {
  const s = Math.round(w * side); const b = Math.round(h * bottom); c.fillStyle = color;
  c.fillRect(0, 0, w, s); c.fillRect(0, 0, s, h); c.fillRect(w - s, 0, s, h); c.fillRect(0, h - b, w, b);
};
const stack = (...fns) => (c, w, h) => fns.forEach((f) => f(c, w, h));

export const FILTERS = [
  { id: 'normal', name: 'Original', css: 'none', swatch: '#c9c4e6' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.55) contrast(1.12) brightness(1.04)', swatch: '#ff4d9d' },
  { id: 'warm', name: 'Golden', css: 'sepia(.28) saturate(1.3) brightness(1.06) hue-rotate(-8deg)', overlay: (c, w, h) => grad(c, w, h, [[0, 'rgba(255,170,60,.16)'], [1, 'rgba(255,90,60,.10)']]), swatch: '#ffb347' },
  { id: 'cool', name: 'Frost', css: 'saturate(1.1) contrast(1.05) hue-rotate(12deg) brightness(1.05)', overlay: (c, w, h) => grad(c, w, h, [[0, 'rgba(60,140,255,.18)'], [1, 'rgba(120,80,255,.10)']]), swatch: '#5aa9ff' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.28) brightness(.96)', overlay: vignette(0.6), swatch: '#222' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(.55) contrast(.92) saturate(1.2) brightness(1.05)', overlay: stack(vignette(0.5), grain(0.16)), swatch: '#b88b5a' },
  { id: 'fade', name: 'Faded', css: 'contrast(.82) brightness(1.12) saturate(.78)', overlay: (c, w, h) => { c.fillStyle = 'rgba(255,240,230,.14)'; c.fillRect(0, 0, w, h); }, swatch: '#e8dccf' },
  { id: 'dream', name: 'Dreamy', css: 'blur(1.2px) brightness(1.12) saturate(1.3) contrast(.94)', overlay: (c, w, h) => grad(c, w, h, [[0, 'rgba(255,150,220,.22)'], [1, 'rgba(160,140,255,.18)']]), swatch: '#f4a8ff' },
  { id: 'sunset', name: 'Sunset', css: 'saturate(1.35) contrast(1.06)', overlay: (c, w, h) => grad(c, w, h, [[0, 'rgba(255,90,60,.34)'], [0.55, 'rgba(255,140,60,.12)'], [1, 'rgba(110,40,170,.34)']]), swatch: '#ff6a3d' },
  { id: 'neon', name: 'Neon', css: 'saturate(2.1) contrast(1.2) hue-rotate(-20deg) brightness(.98)', overlay: (c, w, h) => grad(c, w, h, [[0, 'rgba(0,255,220,.20)'], [1, 'rgba(255,0,170,.26)']], 'd'), swatch: '#10e8c8' },
  { id: 'retro', name: 'Retro cam', css: 'sepia(.25) saturate(1.35) contrast(1.1) hue-rotate(-6deg)', overlay: stack(vignette(0.35), grain(0.1), stamp()), swatch: '#ff9d2e' },
  { id: 'polaroid', name: 'Polaroid', css: 'contrast(1.05) saturate(1.12) brightness(1.04) sepia(.1)', overlay: frame('#fdfcf7'), swatch: '#fdfcf7' },
];
export const getFilter = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];

const MAX_SIDE = 1440;
// Fit inside MAX_SIDE keeping the aspect ratio (keeps uploads small enough for chat media)
export function fitSize(w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// Paints a filter's overlay onto an already-sized 2D context (also used for the live preview layer)
export function paintOverlay(ctx, w, h, filterId) {
  ctx.clearRect(0, 0, w, h); const f = getFilter(filterId);
  if (f.overlay) { ctx.save(); f.overlay(ctx, w, h); ctx.restore(); }
}

// Draws `source` (video, image, bitmap or canvas) with a filter into a new canvas.
export function drawFiltered(source, sw, sh, filterId, { mirror = false, crop = null } = {}) {
  const [w, h] = fitSize(crop ? crop.sw : sw, crop ? crop.sh : sh);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); const f = getFilter(filterId);
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (f.css !== 'none' && 'filter' in ctx) ctx.filter = f.css;
  if (crop) ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h); else ctx.drawImage(source, 0, 0, w, h);
  ctx.restore(); ctx.filter = 'none';
  if (f.overlay) { ctx.save(); f.overlay(ctx, w, h); ctx.restore(); }
  return c;
}
export const canvasToBlob = (c, type = 'image/jpeg', q = 0.92) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create image'))), type, q));

// Applies a filter to a stored/uploaded image blob and returns a JPEG blob
export async function renderFiltered(blob, filterId) {
  if (filterId === 'normal') return blob;
  const bmp = await createImageBitmap(blob); // honours EXIF orientation in current browsers
  try { return await canvasToBlob(drawFiltered(bmp, bmp.width, bmp.height, filterId)); } finally { bmp.close?.(); }
}

// Region of a video frame that the object-fit:cover viewfinder actually shows, so the saved photo matches the preview
export function coverCrop(vw, vh, boxW, boxH) {
  const va = vw / vh; const ba = boxW / boxH;
  if (va > ba) { const sw = Math.round(vh * ba); return { sx: Math.round((vw - sw) / 2), sy: 0, sw, sh: vh }; }
  const sh = Math.round(vw / ba); return { sx: 0, sy: Math.round((vh - sh) / 2), sw: vw, sh };
}
