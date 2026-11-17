// Web-Mercator maths for the dependency-free map (OpenStreetMap raster tiles).
export const TILE = 256;
export const MIN_Z = 3, MAX_Z = 18;
export const clampLat = (lat) => Math.max(-85.0511, Math.min(85.0511, lat));
export const worldSize = (z) => TILE * 2 ** z;

export function project(lat, lng, z) {
  const s = worldSize(z), sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}
export function unproject(x, y, z) {
  const s = worldSize(z), n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / s) * 360 - 180 };
}

// Visible tiles for a viewport centred on (lat,lng). x wraps around the world; y is clipped.
export function visibleTiles({ lat, lng, z, width, height }) {
  const c = project(lat, lng, z), n = 2 ** z, out = [];
  const x0 = Math.floor((c.x - width / 2) / TILE), x1 = Math.floor((c.x + width / 2) / TILE);
  const y0 = Math.max(0, Math.floor((c.y - height / 2) / TILE)), y1 = Math.min(n - 1, Math.floor((c.y + height / 2) / TILE));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    out.push({ key: `${z}/${tx}/${ty}`, z, x: ((tx % n) + n) % n, y: ty, left: tx * TILE - c.x + width / 2, top: ty * TILE - c.y + height / 2 });
  }
  return out;
}

export function pointOnScreen({ lat, lng, centre, z, width, height }) {
  const p = project(lat, lng, z), c = project(centre.lat, centre.lng, z);
  return { x: p.x - c.x + width / 2, y: p.y - c.y + height / 2 };
}
export function panBy({ lat, lng }, z, dx, dy) {
  const c = project(lat, lng, z); const r = unproject(c.x - dx, c.y - dy, z);
  return { lat: clampLat(r.lat), lng: ((r.lng + 540) % 360) - 180 };
}

// Centre + zoom that fit all points with padding (a single point gets a street-level zoom).
export function fitPoints(points, width, height, pad = 56) {
  if (!points.length) return { lat: 12.9716, lng: 77.5946, z: 12 };
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng, z: 15 };
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const box = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lngs), w: Math.min(...lngs) };
  for (let z = MAX_Z - 2; z >= MIN_Z; z--) {
    const a = project(box.n, box.w, z), b = project(box.s, box.e, z);
    if (Math.abs(b.x - a.x) <= width - pad * 2 && Math.abs(b.y - a.y) <= height - pad * 2) {
      const m = unproject((a.x + b.x) / 2, (a.y + b.y) / 2, z);
      return { lat: m.lat, lng: m.lng, z };
    }
  }
  return { lat: (box.n + box.s) / 2, lng: (box.e + box.w) / 2, z: MIN_Z };
}
