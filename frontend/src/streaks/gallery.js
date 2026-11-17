// Snap gallery: photos you save from the camera are kept on this device (IndexedDB), newest first.
// Falls back to in-memory storage when IndexedDB is blocked (private mode), so the UI keeps working for the session.
const DB = 'smu_snap_gallery'; const STORE = 'snaps';
const mem = []; let dbp = null;
const bus = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
export const galleryBus = bus;
const changed = () => bus?.dispatchEvent(new Event('change'));

const open = () => {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
};
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode); let out;
  t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  out = fn(t.objectStore(STORE));
});
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const gallery = {
  async add(blob, meta = {}) {
    const item = { id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, blob, createdAt: Date.now(), filter: meta.filter || 'normal', size: blob.size };
    const db = await open();
    if (db) { try { await tx(db, 'readwrite', (s) => s.put(item)); changed(); return item; } catch { /* fall through to memory */ } }
    mem.unshift(item); changed(); return item;
  },
  async list() {
    const db = await open(); let rows = [];
    if (db) { try { rows = await tx(db, 'readonly', (s) => req(s.getAll())).then((p) => p); } catch { rows = []; } }
    return [...rows, ...mem].sort((a, b) => b.createdAt - a.createdAt);
  },
  async remove(ids) {
    const set = new Set(ids); const db = await open();
    if (db) { try { await tx(db, 'readwrite', (s) => { set.forEach((id) => s.delete(id)); }); } catch { /* ignore */ } }
    for (let i = mem.length - 1; i >= 0; i--) if (set.has(mem[i].id)) mem.splice(i, 1);
    changed();
  },
};

export const asFile = (item) => new File([item.blob], `snap-${item.createdAt}.jpg`, { type: item.blob.type || 'image/jpeg' });
export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
