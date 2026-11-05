import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, X, Upload, Download, Share2, Trash2, Check, FolderPlus, Play, Image as Img } from 'lucide-react';
import { useGoBack, Button, Chip, Modal, Empty, ErrorState, Skeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const TABS = [['all', 'All'], ['photo', 'Photos'], ['video', 'Videos'], ['albums', 'Albums']];

export default function Memories() {
  const [params, setParams] = useSearchParams();
  const notify = useUI((s) => s.notify);
  const goBack = useGoBack('/home');
  const [tab, setTab] = useState('all');
  const [album, setAlbum] = useState(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState(null);
  const [select, setSelect] = useState([]);
  const [uploadAlbum, setUploadAlbum] = useState('Trips');
  const [confirm, setConfirm] = useState(null);
  const fileRef = useRef(null);
  const type = tab === 'photo' || tab === 'video' ? tab : undefined;
  const m = useAsync(() => api.media({ type, album, q }), [type, album, q]);
  const items = m.data || [];
  const albums = useAsync(() => api.albums(), []);

  useEffect(() => { if (params.get('upload')) { fileRef.current?.click(); setParams({}, { replace: true }); } }, []); // eslint-disable-line

  const upload = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = ''; if (!files.length) return;
    try { for (const f of files) { const r = await api.uploadMedia(f, album || uploadAlbum); m.setData((d) => [r, ...(d || [])]); } notify(`${files.length} uploaded`); } catch (er) { notify(errMsg(er)); }
  };
  const download = async (x) => {
    try { const blob = await (await fetch(x.src)).blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sendmeu-${x.id}.${blob.type.includes('svg') ? 'svg' : blob.type.split('/')[1] || 'jpg'}`; a.click(); URL.revokeObjectURL(a.href); }
    catch { notify('Download failed'); }
  };
  const share = async (x) => {
    try {
      if (navigator.share) await navigator.share({ title: 'Send ME/U memory', url: x.src.startsWith('http') ? x.src : window.location.origin });
      else { await navigator.clipboard.writeText(x.src.startsWith('http') ? x.src : window.location.href); notify('Link copied'); }
    } catch { /* user cancelled */ }
  };
  const remove = async (ids) => {
    try { await Promise.all(ids.map((id) => api.deleteMedia(id))); m.setData((d) => d.filter((x) => !ids.includes(x.id))); setSelect([]); setPreview(null); setConfirm(null); notify('Deleted'); } catch (e) { notify(errMsg(e)); }
  };
  const tap = (x) => (select.length ? setSelect((s) => (s.includes(x.id) ? s.filter((i) => i !== x.id) : [...s, x.id])) : setPreview(x));
  const hold = useRef();

  const showAlbums = tab === 'albums' && !album;
  return (
    <div className="screen">
      <header className="app-header">
        {searching ? (
          <label className="input" style={{ flex: 1, height: 42, borderRadius: 999 }}><Search size={16} /><input autoFocus placeholder="Search albums" value={q} onChange={(e) => setQ(e.target.value)} /><button aria-label="Close search" onClick={() => { setSearching(false); setQ(''); }}><X size={16} /></button></label>
        ) : select.length ? (
          <><button className="icon-btn" aria-label="Cancel selection" onClick={() => setSelect([])}><X size={22} /></button><div className="title">{select.length} selected</div><button className="icon-btn" aria-label="Delete selected" onClick={() => setConfirm(select)}><Trash2 size={22} color="#ff4d6d" /></button></>
        ) : (
          <><button className="icon-btn" aria-label="Back" onClick={() => (album ? setAlbum(null) : goBack())}><ArrowLeft size={22} /></button>
            <div className="title">{album || 'Memories'}</div>
            <button className="icon-btn" aria-label="Upload" onClick={() => fileRef.current.click()}><Upload size={21} /></button>
            <button className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Search size={22} /></button></>
        )}
      </header>
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={upload} />
      <div style={{ padding: '0 16px 8px' }}>
        <div className="chip-row">{TABS.map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => { setTab(k); setAlbum(null); }}>{l}</Chip>)}</div>
      </div>
      <div className="scroll">
        {showAlbums ? (
          <div className="people-grid">
            {(albums.data || []).map((a) => <button key={a} className="card" style={{ padding: 18, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }} onClick={() => setAlbum(a)}><FolderPlus color="var(--purple)" /><b>{a}</b></button>)}
          </div>
        ) : (
          <>
            {m.loading && <div className="masonry">{[200, 140, 120, 220].map((h, i) => <div key={i} style={{ marginBottom: 8 }}><Skeleton h={h} /></div>)}</div>}
            {m.error && <ErrorState message={m.error} onRetry={m.reload} />}
            {!m.loading && !m.error && items.length === 0 && <Empty icon={Img} title="No memories found" text={q ? 'Try a different search.' : 'Upload your first photo or video.'} action={<Button className="btn-sm" onClick={() => fileRef.current.click()}>Upload</Button>} />}
            <div className="masonry">
              {items.map((x) => (
                <button key={x.id} className="tile" aria-label={`Open ${x.type}`} onClick={() => tap(x)}
                  onPointerDown={() => { hold.current = setTimeout(() => setSelect((s) => (s.includes(x.id) ? s : [...s, x.id])), 500); }}
                  onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}>
                  {x.type === 'video' && x.src.startsWith('blob:') ? <video src={x.src} muted style={{ width: '100%', display: 'block' }} /> : <img src={x.src} alt="" loading="lazy" />}
                  {x.type === 'video' && <span className="play"><span><Play size={20} color="#fff" fill="#fff" /></span></span>}
                  {x.duration && <span className="dur">{x.duration}</span>}
                  {select.includes(x.id) && <span className="sel-mark"><Check size={14} /></span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {preview && (
        <div className="story-view" style={{ background: '#05070f', zIndex: 60 }}>
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', padding: 'calc(12px + var(--safe-top)) 12px' }}>
            <button className="icon-btn" aria-label="Close" style={{ color: '#fff' }} onClick={() => setPreview(null)}><X size={24} /></button>
            <span style={{ opacity: .8, fontSize: 13, alignSelf: 'center' }}>{preview.album} · {preview.date}</span><span style={{ width: 40 }} />
          </div>
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 0, position: 'relative', zIndex: 1 }}>
            {preview.type === 'video' && preview.src.startsWith('blob:') ? <video src={preview.src} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <img src={preview.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
          </div>
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-around', padding: '14px 0 calc(18px + var(--safe-bottom))' }}>
            {[['Download', Download, () => download(preview)], ['Share', Share2, () => share(preview)], ['Delete', Trash2, () => setConfirm([preview.id])]].map(([l, I, fn]) => (
              <button key={l} onClick={fn} style={{ color: l === 'Delete' ? '#ff6b86' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 12 }}><I size={24} />{l}</button>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete memories?">
        <p className="muted" style={{ marginBottom: 16 }}>This will permanently delete {confirm?.length} item{confirm?.length > 1 ? 's' : ''}.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => remove(confirm)}>Delete</Button></div>
      </Modal>
    </div>
  );
}
