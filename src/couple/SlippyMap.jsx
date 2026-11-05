import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Minus, LocateFixed } from 'lucide-react';
import { visibleTiles, pointOnScreen, panBy, fitPoints, MIN_Z, MAX_Z } from './geo';

// Small interactive map on OpenStreetMap raster tiles, no map library needed.
// markers: [{ id, lat, lng, avatar, name, accuracy, live, dim }]
export default function SlippyMap({ markers, selectedId, onMarker, height = 320 }) {
  const box = useRef(null);
  const drag = useRef(null);
  const touched = useRef(false);
  const [size, setSize] = useState({ w: 0, h: height });
  const [view, setView] = useState(null);
  const [tileErrors, setTileErrors] = useState(0);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = markers.map((m) => ({ lat: m.lat, lng: m.lng }));
  const ptsKey = pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => { if (size.w && (!view || !touched.current)) setView(fitPoints(pts, size.w, size.h)); }, [size.w, size.h, ptsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setTileErrors(0), [view?.z]);

  const zoom = useCallback((d) => setView((v) => v && { ...v, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z + d)) }), []);
  const move = (dx, dy) => { touched.current = true; setView((v) => v && { ...v, ...panBy(v, v.z, dx, dy) }); };
  const recentre = () => { touched.current = false; setView(fitPoints(pts, size.w, size.h)); };

  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; move(dx, dy); };
  const onUp = () => { drag.current = null; };
  const onKey = (e) => {
    const k = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
    if (k) { e.preventDefault(); move(...k); } else if (e.key === '+' || e.key === '=') zoom(1); else if (e.key === '-') zoom(-1);
  };

  const tiles = view && size.w ? visibleTiles({ ...view, width: size.w, height: size.h }) : [];
  const mpp = view ? (156543.03392 * Math.cos((view.lat * Math.PI) / 180)) / 2 ** view.z : 1;

  return (
    <div className="ll-map" style={{ height }} ref={box} tabIndex={0} role="application" aria-label="Map showing you and your partner. Use arrow keys to pan, plus and minus to zoom."
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => zoom(1)} onKeyDown={onKey}>
      {tiles.map((t) => (
        <img key={t.key} className="ll-tile" alt="" draggable={false} src={`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`}
          style={{ left: t.left, top: t.top }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; setTileErrors((n) => n + 1); }} />
      ))}
      {tileErrors > 3 && <div className="ll-offline" role="status">Map tiles could not load. Check your connection. Locations are still accurate.</div>}

      {view && size.w > 0 && markers.map((m) => {
        const p = pointOnScreen({ lat: m.lat, lng: m.lng, centre: view, z: view.z, width: size.w, height: size.h });
        const r = Math.min(120, (m.accuracy || 0) / mpp);
        return (
          <span key={m.id} className="ll-mk-wrap" style={{ left: p.x, top: p.y }}>
            {r > 16 && <i className={`ll-acc ${m.dim ? 'dim' : ''}`} style={{ width: r * 2, height: r * 2 }} aria-hidden />}
            <button className={`ll-mk ${m.live ? 'live' : ''} ${m.dim ? 'dim' : ''} ${selectedId === m.id ? 'sel' : ''}`} aria-label={`${m.name}${m.dim ? ', last known location' : ''}. Show details`}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => onMarker?.(m.id)}>
              <img src={m.avatar} alt="" draggable={false} />
            </button>
          </span>
        );
      })}

      <div className="ll-zoom">
        <button aria-label="Zoom in" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoom(1)}><Plus size={18} /></button>
        <button aria-label="Zoom out" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoom(-1)}><Minus size={18} /></button>
        <button aria-label="Fit both of us on the map" onPointerDown={(e) => e.stopPropagation()} onClick={recentre}><LocateFixed size={18} /></button>
      </div>
      <a className="ll-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>© OpenStreetMap contributors</a>
    </div>
  );
}
