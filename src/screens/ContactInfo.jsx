import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MoreVertical, Phone, Video, Search, MessageCircle, Share2, Bell, Image as Img, Lock, Palette, Star, Ban, ThumbsDown, AtSign, MapPin, Info, Users, UserPlus, Heart, Calendar, ChevronRight, X, Check as Tick } from 'lucide-react';
import { Modal, Button, TextField, DropMenu, ErrorState, ListSkeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useAuth, useUI, useMenu, useChatPrefs, isMuted } from '../store';
import { WALLS, MUTES, REASONS } from './Chat';

const Row = ({ icon: I, label, value, onClick, right, danger, sub }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`ci-row ${danger ? 'danger' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <I size={22} />
      <span className="grow"><span className="ci-label">{label}</span>{value && <small>{value}</small>}{sub && <small>{sub}</small>}</span>
      {right}
    </Tag>
  );
};

export default function ContactInfo() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const me = useAuth((s) => s.user);
  const theme = useUI((s) => s.theme);
  const convo = useAsync(() => api.conversation(id), [id]);
  const people = useAsync(() => api.people({}), []);
  const msgs = useAsync(() => api.messages(id, 1), [id]);
  const starred = useMenu((s) => s.starred);
  const pref = useChatPrefs((s) => s.prefs[id]) || {};
  const setPref = useChatPrefs((s) => s.setPref);
  const [dd, setDd] = useState(false);
  const [sheet, setSheet] = useState(null); // contact | mute | theme | block | report
  const [cName, setCName] = useState(''); const [cPhone, setCPhone] = useState('');
  const [reason, setReason] = useState(REASONS[0]); const [alsoBlock, setAlsoBlock] = useState(false);
  const [preview, setPreview] = useState(null);

  const c = convo.data;
  if (convo.loading) return <div className="screen"><header className="app-header"><button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={22} /></button></header><ListSkeleton n={3} /></div>;
  if (!c) return <div className="screen"><header className="app-header"><button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={22} /></button></header><ErrorState message={convo.error || 'Chat not found'} onRetry={convo.reload} /></div>;

  const isGroup = c.type === 'group';
  const isCouple = c.type === 'couple';
  const direct = !isGroup && !isCouple;
  const muted = isMuted(pref);
  const blocked = !!pref.blocked;
  const list = people.data || [];
  const person = direct ? list.find((p) => p.name.split(' ')[0].toLowerCase() === c.name.split(' ')[0].toLowerCase()) : null;
  const members = isGroup ? (c.memberIds || []).map((m) => (m === 'u0' ? { id: 'u0', name: 'You', avatar: me?.avatar } : list.find((p) => p.id === m))).filter(Boolean) : [];
  const items = (msgs.data?.items || msgs.data || []);
  const media = items.filter((m) => (m.type === 'image' || m.type === 'video') && m.src);
  const links = items.filter((m) => m.type === 'text' && /https?:\/\//i.test(m.text));
  const starCount = starred.filter((s) => s.convoId === id).length;
  const title = pref.contact?.name || c.fullName || c.name;
  const phone = pref.contact?.phone || c.phone;
  const handle = c.handle || person?.handle;
  const about = c.about || person?.bio;
  const wallName = (WALLS.find((w) => w.k === (pref.wall || 'default')) || WALLS[0]).l;

  const openContact = () => { setCName(pref.contact?.name || c.name || ''); setCPhone(pref.contact?.phone || c.phone || ''); setSheet('contact'); };
  const saveContact = () => { if (!cName.trim()) return; setPref(id, { contact: { name: cName.trim(), phone: cPhone.trim() } }); setSheet(null); notify('Saved to contacts'); };
  const share = async () => {
    const url = `${window.location.origin}/chats/${id}`;
    try { if (navigator.share) await navigator.share({ title: title, url }); else { await navigator.clipboard.writeText(url); notify('Link copied'); } } catch { /* cancelled */ }
  };
  const sendReport = () => { setPref(id, { reported: true, ...(alsoBlock ? { blocked: true } : {}) }); setSheet(null); notify(alsoBlock ? 'Reported and blocked' : 'Report sent'); };
  const lockChat = async () => { try { await api.lockChat(id, true); notify('Chat moved to Private Space'); nav('/home', { replace: true }); } catch (e) { notify(errMsg(e)); } };

  const menuItems = [
    { key: 'share', label: 'Share', onSelect: share },
    ...(direct ? [{ key: 'contact', label: pref.contact ? 'Edit contact' : 'Add to contacts', onSelect: openContact }] : []),
  ];

  return (
    <div className="screen ci">
      <header className="ci-top">
        <button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={26} /></button>
        <span className="more-wrap">
          <button className="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={dd} onClick={() => setDd((v) => !v)}><MoreVertical size={24} /></button>
          <DropMenu open={dd} onClose={() => setDd(false)} items={menuItems} label="Contact menu" />
        </span>
      </header>

      <div className="scroll ci-scroll">
        <section className="ci-hero">
          <button className="ci-photo" aria-label="View profile photo" onClick={() => setPreview(c.avatar)}><img src={c.avatar} alt="" />{c.online && direct && <i className="dot-online" />}</button>
          <h1>{title}{c.heart && ' ❤️'}</h1>
          {phone && <p className="ci-sub">{phone}</p>}
          {!phone && handle && <p className="ci-sub">{handle}</p>}
          {isGroup && <p className="ci-sub">Group · {members.length} members</p>}
          {direct && <p className="ci-sub small">{c.online ? 'Online' : 'Last seen recently'}</p>}
          <div className="ci-actions">
            <button onClick={() => nav(-1)}><span><MessageCircle size={22} /></span>Message</button>
            <button onClick={() => notify('Calling…')}><span><Phone size={22} /></span>Audio</button>
            <button onClick={() => notify('Video calling…')}><span><Video size={22} /></span>Video</button>
            <button onClick={() => nav(`/chats/${id}?search=1`)}><span><Search size={22} /></span>Search</button>
          </div>
        </section>

        <section className="ci-card">
          {about && <Row icon={Info} label="About" value={about} />}
          {handle && <Row icon={AtSign} label="Username" value={handle} />}
          {phone && <Row icon={Phone} label="Mobile" value={phone} right={<button className="ci-mini" aria-label="Call" onClick={() => notify('Calling…')}><Phone size={18} /></button>} />}
          {(c.location || person?.distance) && <Row icon={MapPin} label={c.location || 'Nearby'} value={person?.distance} />}
          {c.joined && <Row icon={Calendar} label="On Send ME U since" value={c.joined} />}
          {isGroup && c.created && <Row icon={Calendar} label="Group created" value={c.created} />}
          {isCouple && <Row icon={Heart} label="Couple space" value="Private to the two of you" />}
          {!direct ? null : pref.contact ? <Row icon={UserPlus} label="Edit contact" onClick={openContact} /> : <Row icon={UserPlus} label="Add to contacts" onClick={openContact} />}
        </section>

        <section className="ci-card">
          <button className="ci-media-head" onClick={() => nav(`/chats/${id}?media=1`)} aria-label="Media, links, and docs">
            <span className="grow">Media, links and docs</span><small>{media.length + links.length}</small><ChevronRight size={18} />
          </button>
          {media.length > 0 && (
            <div className="ci-thumbs">{media.slice(0, 4).map((m) => <button key={m.id} aria-label={`Open ${m.type}`} onClick={() => setPreview(m.src)}><img src={m.src} alt="" /></button>)}</div>
          )}
          <Row icon={Star} label="Starred messages" value={starCount ? `${starCount}` : 'None'} onClick={() => nav('/starred')} right={<ChevronRight size={18} />} />
        </section>

        <section className="ci-card">
          <Row icon={Bell} label="Notifications" value={muted ? 'Muted' : 'On'} onClick={() => (muted ? (setPref(id, { mutedUntil: null }), notify('Notifications on')) : setSheet('mute'))}
            right={<span className={`toggle ${muted ? '' : 'on'}`} aria-hidden />} />
          <Row icon={Palette} label="Chat theme" value={wallName} onClick={() => setSheet('theme')} right={<ChevronRight size={18} />} />
          <Row icon={Lock} label="Lock chat" value="Move this chat to Private Space" onClick={lockChat} right={<ChevronRight size={18} />} />
        </section>

        {isGroup && (
          <section className="ci-card">
            <div className="ci-sec">{members.length} members</div>
            {members.map((m) => (
              <div key={m.id} className="ci-member"><img src={m.avatar} alt="" /><span className="grow"><b>{m.name}</b>{m.bio && <small>{m.bio}</small>}</span>{m.id === 'u0' && <span className="chip">Admin</span>}</div>
            ))}
          </section>
        )}

        {direct && (
          <section className="ci-card">
            <div className="ci-sec">{person?.mutual ? `${person.mutual} mutual friends` : 'No groups in common'}</div>
            <Row icon={Users} label={`Create group with ${c.name}`} onClick={() => nav('/chats/new?group=1')} />
          </section>
        )}

        <section className="ci-card">
          {direct && <Row icon={Ban} label={blocked ? `Unblock ${c.name}` : `Block ${c.name}`} danger onClick={() => (blocked ? (setPref(id, { blocked: false }), notify('Contact unblocked')) : setSheet('block'))} />}
          <Row icon={ThumbsDown} label={`Report ${c.name}`} danger onClick={() => { setReason(REASONS[0]); setAlsoBlock(false); setSheet('report'); }} />
        </section>
      </div>

      <Modal open={sheet === 'contact'} onClose={() => setSheet(null)} title={pref.contact ? 'Edit contact' : 'Add to contacts'}>
        <TextField placeholder="Name" maxLength={40} value={cName} onChange={(e) => setCName(e.target.value)} />
        <TextField placeholder="Phone number (optional)" inputMode="tel" maxLength={20} value={cPhone} onChange={(e) => setCPhone(e.target.value.replace(/[^0-9+\- ]/g, ''))} />
        <Button disabled={!cName.trim()} onClick={saveContact}>Save</Button>
        {pref.contact && <Button variant="outline" style={{ marginTop: 10 }} onClick={() => { setPref(id, { contact: null }); setSheet(null); notify('Removed from contacts'); }}>Remove from contacts</Button>}
      </Modal>
      <Modal open={sheet === 'mute'} onClose={() => setSheet(null)} title="Mute notifications">
        <div className="mp-pick" role="radiogroup" aria-label="Duration">
          {MUTES.map(([l, ms]) => <button key={l} type="button" role="radio" aria-checked="false" className="mp-pick-row" onClick={() => { setPref(id, { mutedUntil: ms === -1 ? -1 : Date.now() + ms }); setSheet(null); notify(l === 'Always' ? 'Muted always' : `Muted for ${l.toLowerCase()}`); }}><span className="grow">{l}</span></button>)}
        </div>
      </Modal>
      <Modal open={sheet === 'theme'} onClose={() => setSheet(null)} title="Chat theme">
        <div className="wall-grid" role="radiogroup" aria-label="Wallpaper">
          {WALLS.map((w) => {
            const on = (pref.wall || 'default') === w.k;
            return <button key={w.k} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => { setPref(id, { wall: w.k }); notify(w.k === 'default' ? 'Default theme' : `${w.l} theme`); }}><i style={{ background: w.light ? (theme === 'dark' ? w.dark : w.light) : 'var(--bg)' }}>{on && <Tick size={18} strokeWidth={3} />}</i><span>{w.l}</span></button>;
          })}
        </div>
      </Modal>
      <Modal open={sheet === 'block'} onClose={() => setSheet(null)} title={`Block ${c.name}?`}>
        <p className="muted" style={{ marginBottom: 16 }}>You will not be able to send messages in this chat until you unblock.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setSheet(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setPref(id, { blocked: true }); setSheet(null); notify('Contact blocked'); }}>Block</Button>
        </div>
      </Modal>
      <Modal open={sheet === 'report'} onClose={() => setSheet(null)} title={`Report ${c.name}`}>
        <div className="mp-pick" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={reason === r} className={`mp-pick-row ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}><span className="grow">{r}</span><span className="mp-check">{reason === r && <Tick size={16} strokeWidth={3} />}</span></button>)}
        </div>
        {direct && !blocked && <label className="check" style={{ margin: '12px 4px' }}><input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} /> Also block this contact</label>}
        <Button style={{ marginTop: 8 }} onClick={sendReport}>Send report</Button>
      </Modal>
      {preview && (
        <div className="story-view" onClick={() => setPreview(null)} style={{ zIndex: 60 }}>
          <button className="icon-btn" style={{ position: 'absolute', top: 16, right: 12, color: '#fff', zIndex: 3 }} aria-label="Close preview"><X size={26} /></button>
          <img className="media" src={preview} alt="" style={{ objectFit: 'contain' }} />
        </div>
      )}
    </div>
  );
}
