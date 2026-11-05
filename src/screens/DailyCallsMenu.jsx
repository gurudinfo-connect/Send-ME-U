import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Phone, Video, Trash2, Check, CalendarClock, Megaphone } from 'lucide-react';
import { AppHeader, Avatar, Button, TextField, Modal, Toggle, Empty, ErrorState, ListSkeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const ICONS = ['ch-freshers', 'ch-google', 'ch-hire', 'ch-nooneCares', 'ch-nxt'];
const CATS = ['News', 'Jobs', 'Entertainment', 'Travel', 'Tech', 'Other'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------------- Create channel (Daily menu) ---------------- */
export function CreateChannel() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [f, setF] = useState({ name: '', about: '', category: 'News', logo: `/assets/${ICONS[0]}.png`, isPublic: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (f.name.trim().length < 3) return setErr('Give your channel a name (at least 3 characters)');
    setBusy(true); setErr('');
    try { await api.createChannel({ name: f.name.trim(), about: f.about.trim(), category: f.category, logo: f.logo, isPublic: f.isPublic, last: f.about.trim() || 'Channel created' }); notify('Channel created'); nav('/daily', { replace: true }); }
    catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <AppHeader back fallback="/daily" title="Create channel" />
      <form className="scroll mx-form" onSubmit={submit}>
        <div className="mx-icons" role="radiogroup" aria-label="Channel icon">
          {ICONS.map((n) => <button type="button" key={n} role="radio" aria-checked={f.logo.includes(n)} className={f.logo.includes(n) ? 'on' : ''} onClick={() => setF({ ...f, logo: `/assets/${n}.png` })}><img src={`/assets/${n}.png`} alt="" /></button>)}
        </div>
        <TextField icon={Megaphone} placeholder="Channel name" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Channel name" />
        <div className="field"><label className="input textarea-box"><textarea rows={3} maxLength={200} placeholder="What is this channel about? (optional)" value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} aria-label="Description" /></label></div>
        <h4 className="mx-h">Category</h4>
        <div className="chip-row" style={{ flexWrap: 'wrap' }}>{CATS.map((c) => <button type="button" key={c} className={`chip ${f.category === c ? 'active' : ''}`} onClick={() => setF({ ...f, category: c })}>{c}</button>)}</div>
        <div className="mx-switch"><span className="grow"><b>Public channel</b><small>{f.isPublic ? 'Anyone can find and follow it' : 'Only people with the link can follow'}</small></span><Toggle on={f.isPublic} onChange={(v) => setF({ ...f, isPublic: v })} label="Public channel" /></div>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" loading={busy}>Create channel</Button>
      </form>
    </div>
  );
}

/* ---------------- Status privacy (Daily menu) ---------------- */
const AUDIENCES = [
  ['contacts', 'My contacts', 'Everyone you chat with can see your status'],
  ['except', 'My contacts except…', 'Hide your status from the people you pick'],
  ['only', 'Only share with…', 'Only the people you pick can see your status'],
];
export function StatusPrivacy() {
  const settings = useUI((s) => s.settings);
  const setSetting = useUI((s) => s.setSetting);
  const notify = useUI((s) => s.notify);
  const people = useAsync(() => api.people({}), []);
  const aud = settings.statusAudience || 'contacts';
  const list = settings.statusList || [];
  const toggle = (id) => setSetting('statusList', list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="screen">
      <AppHeader back fallback="/daily" title="Status privacy" />
      <div className="scroll">
        <h4 className="mx-h">Who can see my status updates</h4>
        <div role="radiogroup" aria-label="Status audience">
          {AUDIENCES.map(([k, l, d]) => (
            <button key={k} role="radio" aria-checked={aud === k} className={`mx-radio ${aud === k ? 'on' : ''}`} onClick={() => { setSetting('statusAudience', k); setSetting('statusList', []); }}>
              <span className="dot" aria-hidden>{aud === k && <i />}</span><span className="grow"><b>{l}</b><small>{d}</small></span>
            </button>
          ))}
        </div>
        {aud !== 'contacts' && (<>
          <h4 className="mx-h">{aud === 'except' ? 'Hide from' : 'Share only with'}</h4>
          {people.loading && <ListSkeleton n={3} />}
          {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
          <div className="mp-pick" role="group">
            {(people.data || []).map((p) => {
              const on = list.includes(p.id);
              return (
                <button key={p.id} type="button" className={`mp-pick-row ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                  <Avatar src={p.avatar} size={44} /><span className="grow">{p.name}</span><span className="mp-check">{on && <Check size={16} strokeWidth={3} />}</span>
                </button>
              );
            })}
          </div>
          {aud === 'only' && list.length === 0 && <p className="mx-warn" role="status">Nobody can see your status until you pick at least one person.</p>}
        </>)}
        <h4 className="mx-h">More</h4>
        <div className="mx-switch"><span className="grow"><b>Allow replies</b><small>People can reply to your status in chat</small></span><Toggle on={settings.statusReplies ?? true} onChange={(v) => setSetting('statusReplies', v)} label="Allow replies" /></div>
        <div className="mx-switch"><span className="grow"><b>Show who viewed</b><small>Turn off to stop seeing and sending status views</small></span><Toggle on={settings.statusReceipts ?? true} onChange={(v) => setSetting('statusReceipts', v)} label="Show who viewed" /></div>
        <Button variant="outline" style={{ marginTop: 14 }} onClick={() => notify('Status privacy saved')}>Done</Button>
      </div>
    </div>
  );
}

/* ---------------- Ad preferences (Daily menu) ---------------- */
export function AdPreferences() {
  const settings = useUI((s) => s.settings);
  const setSetting = useUI((s) => s.setSetting);
  const notify = useUI((s) => s.notify);
  const on = settings.adsPersonal ?? true;
  return (
    <div className="screen">
      <AppHeader back fallback="/daily" title="Ad preferences" />
      <div className="scroll">
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, margin: '4px 0 12px' }}>These choices apply to sponsored channel updates shown in Daily. Your chats, calls and Private Space are never used to choose ads.</p>
        <div className="mx-switch"><span className="grow"><b>Personalised ads</b><small>{on ? 'Sponsored updates can match your interests' : 'You will only see general sponsored updates'}</small></span><Toggle on={on} onChange={(v) => setSetting('adsPersonal', v)} label="Personalised ads" /></div>
        <div className={`mx-switch ${on ? '' : 'off'}`}><span className="grow"><b>Use channels I follow</b><small>Match sponsored updates to channels you follow</small></span><Toggle on={on && (settings.adsChannels ?? true)} onChange={(v) => on && setSetting('adsChannels', v)} label="Use channels I follow" /></div>
        <div className={`mx-switch ${on ? '' : 'off'}`}><span className="grow"><b>Use approximate location</b><small>City-level only, never your live location</small></span><Toggle on={on && (settings.adsLocation ?? false)} onChange={(v) => on && setSetting('adsLocation', v)} label="Use approximate location" /></div>
        <Button variant="outline" style={{ marginTop: 14 }} onClick={() => { setSetting('adsChannels', true); setSetting('adsLocation', false); setSetting('adsPersonal', true); setSetting('adsReset', Date.now()); notify('Ad preferences reset'); }}>Reset ad preferences</Button>
      </div>
    </div>
  );
}

/* ---------------- Scheduled calls (Calls menu) ---------------- */
const dayHead = (d) => {
  const t = new Date(); const k = iso(d);
  const tm = new Date(); tm.setDate(t.getDate() + 1);
  return k === iso(t) ? 'Today' : k === iso(tm) ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};
const timeOf = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function ScheduledCalls() {
  const [params, setParams] = useSearchParams();
  const notify = useUI((s) => s.notify);
  const list = useAsync(() => api.scheduledCalls(), []);
  const calls = useAsync(() => api.calls(), []);
  const people = useAsync(() => api.people({}), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const contacts = useMemo(() => {
    const m = new Map();
    [...(people.data || []), ...(calls.data || [])].forEach((c) => !m.has(c.name) && m.set(c.name, { name: c.name, avatar: c.avatar }));
    return [...m.values()];
  }, [people.data, calls.data]);
  const blank = () => { const d = new Date(Date.now() + 36e5); return { name: '', avatar: '', date: iso(d), time: `${String(d.getHours()).padStart(2, '0')}:00`, video: false, note: '' }; };
  useEffect(() => { if (params.get('new')) { setForm(blank()); setParams({}, { replace: true }); } }, []); // eslint-disable-line

  const groups = useMemo(() => (list.data || []).reduce((m, c) => { const k = iso(new Date(c.at)); (m[k] ||= []).push(c); return m; }, {}), [list.data]);
  const save = async () => {
    if (!form.name) return setErr('Choose who to call');
    const at = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(+at) || at <= new Date()) return setErr('Pick a time in the future');
    setBusy(true); setErr('');
    try { const c = await api.scheduleCall({ name: form.name, avatar: form.avatar, video: form.video, note: form.note.trim(), at: at.toISOString() }); list.setData((d) => [...(d || []), c].sort((a, b) => new Date(a.at) - new Date(b.at))); setForm(null); notify('Call scheduled'); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const cancel = async (c) => { try { await api.cancelScheduledCall(c.id); list.setData((d) => d.filter((x) => x.id !== c.id)); notify('Scheduled call cancelled'); } catch (e) { notify(errMsg(e)); } };
  const callNow = async (c) => { try { await api.placeCall({ name: c.name, avatar: c.avatar, fav: false, video: c.video }); notify(`${c.video ? 'Video calling' : 'Calling'} ${c.name}…`); } catch (e) { notify(errMsg(e)); } };

  return (
    <div className="screen">
      <AppHeader back fallback="/calls" title="Scheduled calls" right={<button className="icon-btn" aria-label="Schedule a call" onClick={() => { setErr(''); setForm(blank()); }}><Plus size={24} /></button>} />
      <div className="scroll">
        {list.loading && <ListSkeleton n={3} />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && (list.data || []).length === 0 && <Empty icon={CalendarClock} title="No scheduled calls" text="Plan a call for later and it will show up here." action={<Button className="btn-sm" onClick={() => { setErr(''); setForm(blank()); }}>Schedule a call</Button>} />}
        {Object.entries(groups).map(([k, items]) => (
          <section key={k} aria-label={dayHead(new Date(`${k}T00:00`))}>
            <h4 className="mx-h">{dayHead(new Date(`${k}T00:00`))}</h4>
            {items.map((c) => (
              <div key={c.id} className="call-row mx-sc">
                <span className="avr"><img src={c.avatar} alt="" /></span>
                <span className="meta"><span className="nm" style={{ display: 'block' }}>{c.name}</span><span className="sub">{c.video ? <Video size={15} /> : <Phone size={15} />}{timeOf(c.at)}{c.note ? ` · ${c.note}` : ''}</span></span>
                <span className="acts">
                  <button aria-label={`Call ${c.name} now`} onClick={() => callNow(c)}>{c.video ? <Video size={24} /> : <Phone size={23} />}</button>
                  <button aria-label={`Cancel call with ${c.name}`} onClick={() => cancel(c)}><Trash2 size={21} color="#e5484d" /></button>
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="Schedule a call">
        {form && (<>
          <h4 className="mx-h" style={{ marginTop: 0 }}>Who</h4>
          <div className="mx-contacts" role="radiogroup" aria-label="Contact">
            {contacts.map((c) => <button type="button" key={c.name} role="radio" aria-checked={form.name === c.name} className={form.name === c.name ? 'on' : ''} onClick={() => setForm({ ...form, name: c.name, avatar: c.avatar })}><Avatar src={c.avatar} size={46} /><span>{c.name.split(' ')[0]}</span></button>)}
          </div>
          <div className="seg" role="tablist" aria-label="Call type" style={{ margin: '12px 0' }}>
            <button type="button" role="tab" aria-selected={!form.video} className={!form.video ? 'active' : ''} onClick={() => setForm({ ...form, video: false })}><Phone size={14} /> Voice</button>
            <button type="button" role="tab" aria-selected={form.video} className={form.video ? 'active' : ''} onClick={() => setForm({ ...form, video: true })}><Video size={14} /> Video</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label className="input"><input type="date" min={iso(new Date())} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" /></label></div>
            <div className="field"><label className="input"><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label="Time" /></label></div>
          </div>
          <TextField placeholder="Note (optional)" maxLength={60} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" />
          {err && <p className="err" role="alert">{err}</p>}
          <Button loading={busy} onClick={save}>Schedule call</Button>
        </>)}
      </Modal>
    </div>
  );
}
