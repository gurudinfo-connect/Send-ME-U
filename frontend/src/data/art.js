// Self-contained SVG art (no external image hosts needed).
const enc = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const PALETTES = [
  ['#7c3aed', '#c084fc'], ['#2563eb', '#22d3ee'], ['#ec4899', '#f9a8d4'],
  ['#0ea5e9', '#6366f1'], ['#f97316', '#fbbf24'], ['#14b8a6', '#4ade80'],
];

export function avatarArt(name = '?', i = 0, skin = '#f1c9a5') {
  const [a, b] = PALETTES[(name.charCodeAt(0) + i) % PALETTES.length];
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="40" r="19" fill="${skin}"/><path d="M28 36c2-16 42-18 44 0-8-8-34-8-44 0z" fill="#1f1b3a"/><path d="M14 100c2-26 20-36 36-36s34 10 36 36z" fill="#fff" opacity=".92"/></svg>`);
}

export function sceneArt(kind = 'sunset', w = 400, h = 500) {
  const scenes = {
    sunset: ['#2b1055', '#ff7a45', '#ffd166'],
    mountain: ['#1e3a8a', '#7dd3fc', '#e0f2fe'],
    flower: ['#bbf7d0', '#fef9c3', '#ffffff'],
    city: ['#312e81', '#f59e0b', '#fde68a'],
    couple: ['#7c3aed', '#fb7185', '#fde68a'],
    lake: ['#0f766e', '#67e8f9', '#ecfeff'],
  };
  const [c1, c2, c3] = scenes[kind] || scenes.sunset;
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".6" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${w * 0.55}" cy="${h * 0.5}" r="${w * 0.1}" fill="${c3}" opacity=".9"/><path d="M0 ${h * 0.75} L${w * 0.25} ${h * 0.5} L${w * 0.45} ${h * 0.72} L${w * 0.7} ${h * 0.42} L${w} ${h * 0.7} V${h} H0Z" fill="#0b1030" opacity=".78"/><path d="M0 ${h * 0.88} Q${w * 0.5} ${h * 0.78} ${w} ${h * 0.9} V${h} H0Z" fill="#050816" opacity=".85"/></svg>`);
}

export const logo = '/logo.png?v=2';
export const logoIcon = '/logo-icon.png?v=2';
