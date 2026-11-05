import { useEffect, useState } from 'react';
import { ArrowLeft, X, Trash2, Send, Download, Check, Images, FolderUp } from 'lucide-react';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { gallery, galleryBus, asFile, downloadBlob } from './gallery';

// Newest-first list of saved snaps; refreshes whenever the gallery changes.
export function useGallery() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true; const load = () => gallery.list().then((r) => { if (alive) setItems(r); }).catch(() => {});
    load(); galleryBus?.addEventListener('change', load);
    return () => { alive = false; galleryBus?.removeEventListener('change', load); };
  }, []);
  return items;
}

// Object URLs for every photo, revoked when the list changes
function useUrls(items) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    const m = {}; items.forEach((i) => { m[i.id] = URL.createObjectURL(i.blob); }); setUrls(m);
    return () => Object.values(m).forEach((u) => URL.revokeObjectURL(u));
  }, [items]);
  return urls;
}

const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function SnapGallery({ onBack, onClose, onUse }) {
  const notify = useUI((s) => s.notify);
  const items = useGallery();
  const urls = useUrls(items);
  const [view, setView] = useState(null);       // item open full-screen
  const [select, setSelect] = useState(null);   // null = normal, array = multi-select mode
  const [confirm, setConfirm] = useState(null); // ids waiting for delete confirmation
  const [busy, setBusy] = useState(false);

  // if the open photo was deleted elsewhere, close the viewer
  useEffect(() => { if (view && !items.some((i) => i.id === view.id)) setView(null); }, [items, view]);

  const tap = (it) => (select ? setSelect((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id])) : setView(it));
  const del = async (ids) => { await gallery.remove(ids); setConfirm(null); setSelect(null); setView(null); notify(ids.length === 1 ? 'Photo deleted' : `${ids.length} photos deleted`); };
  const toDevice = (it) => { downloadBlob(it.blob, `sendmeu-snap-${it.createdAt}.jpg`); notify('Saved to your device'); };
  const toMemories = async (it) => {
    if (busy) return; setBusy(true);
    try { await api.uploadMedia(asFile(it), 'Snaps'); notify('Added to Memories'); } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="snap" role="dialog" aria-modal="true" aria-label="Snap gallery">
      <header className="snap-top">
        {select ? <button className="icon-btn" aria-label="Cancel selection" onClick={() => setSelect(null)}><X size={24} /></button>
          : <button className="icon-btn" aria-label="Back to camera" onClick={onBack}><ArrowLeft size={24} /></button>}
        <b>{select ? `${select.length} selected` : 'Gallery'}</b>
        {select ? <button className="icon-btn" aria-label="Delete selected" disabled={!select.length} onClick={() => setConfirm(select)}><Trash2 size={22} color={select.length ? '#ff6b86' : undefined} /></button>
          : <button className="snap-textbtn" disabled={!items.length} onClick={() => setSelect([])}>Select</button>}
      </header>

      {items.length === 0 ? (
        <div className="snap-gempty">
          <Images size={44} />
          <b>No saved snaps yet</b>
          <p>Take a photo, pick a filter and tap Save. It will show up here.</p>
          <button className="snap-send" style={{ margin: '8px 0 0', padding: '0 28px' }} onClick={onBack}>Open camera</button>
        </div>
      ) : (
        <div className="snap-ggrid" role="list">
          {items.map((it) => {
            const on = !!select?.includes(it.id);
            return (
              <button key={it.id} role="listitem" className={`snap-gcell ${on ? 'on' : ''}`} aria-label={`Snap from ${when(it.createdAt)}`} onClick={() => tap(it)}>
                {urls[it.id] && <img src={urls[it.id]} alt="" loading="lazy" />}
                {select && <span className="snap-check">{on && <Check size={14} strokeWidth={3} />}</span>}
              </button>
            );
          })}
        </div>
      )}

      {view && (
        <div className="snap-gview" role="dialog" aria-modal="true" aria-label="Photo">
          <header className="snap-top">
            <button className="icon-btn" aria-label="Close photo" onClick={() => setView(null)}><X size={24} /></button>
            <b>{when(view.createdAt)}</b>
            <button className="icon-btn" aria-label="Delete photo" onClick={() => setConfirm([view.id])}><Trash2 size={22} /></button>
          </header>
          <div className="snap-gbig">{urls[view.id] && <img src={urls[view.id]} alt="Saved snap" />}</div>
          <div className="snap-gact">
            <button onClick={() => toDevice(view)}><Download size={20} /><small>To device</small></button>
            <button onClick={() => toMemories(view)} disabled={busy}><FolderUp size={20} /><small>Memories</small></button>
            <button className="primary" onClick={() => onUse(view)}><Send size={20} /><small>Send</small></button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="snap-confirm" role="alertdialog" aria-modal="true" aria-label="Delete photos">
          <div>
            <b>Delete {confirm.length === 1 ? 'this photo' : `${confirm.length} photos`}?</b>
            <p>This removes {confirm.length === 1 ? 'it' : 'them'} from your gallery. Photos you already sent are not affected.</p>
            <span><button onClick={() => setConfirm(null)}>Cancel</button><button className="danger" onClick={() => del(confirm)}>Delete</button></span>
          </div>
        </div>
      )}
    </div>
  );
}
