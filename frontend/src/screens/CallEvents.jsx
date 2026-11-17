import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, CalendarPlus, Check, Copy, ImagePlus, Link2, Pencil, Phone, Search, Share2, ShieldCheck, UserRound, UserRoundCheck, Video, X, Trash2 } from 'lucide-react';
import { AppHeader, Avatar, Button, Empty, ErrorState, ListSkeleton, Modal, Toggle, useAsync, clearAsyncCache } from '../components/ui';
import { api, errMsg } from '../services/api';
import { subscribeCallEvents } from '../services/socket';
import { useAuth, useUI } from '../store';
import { REMINDER_OPTIONS, DEFAULT_REMINDER, MAX_TITLE, MAX_DESC, validateEvent, filterEvents, timeRange, longDate, reminderLabel, callTypeLabel, toICS, ms } from '../callEvents/logic';

// ------------------------------------------------------------------ shared helpers
const pad = (n) => String(n).padStart(2, '0');
const dStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (d, t) => { const x = new Date(`${d}T${t}`); return Number.isNaN(+x) ? null : x; };
const fmtDay = (d) => (at(d, '00:00') ? at(d, '00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Pick a date');
const fmtTime = (t) => (at('1970-01-01', t) ? at('1970-01-01', t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Pick a time');

// Re-render now and then so "Join" opens by itself when the room window starts.
function useTick(every = 15000) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((n) => n + 1), every); return () => clearInterval(t); }, [every]); }
// Reload a list when the server / demo service says events changed.
function useLive(reload) { useEffect(() => subscribeCallEvents((name) => { if (name === 'events:changed' || name === 'notification:new') { clearAsyncCache(); reload(); } }), []); } // eslint-disable-line

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}
async function shareLink(title, url, notify) {
  if (navigator.share) { try { await navigator.share({ title, text: `Join “${title}” on SendMeU`, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  notify((await copyText(url)) ? 'Link copied' : 'Could not copy the link');
}
function downloadICS(e) {
  const blob = new Blob([toICS(e, e.meeting_link)], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${e.title.replace(/[^\w]+/g, '_') || 'event'}.ics`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// Downscale an uploaded picture so it stays small enough to store with the event.
function shrinkImage(file, max = 720) {
  return new Promise((res, rej) => {
    if (!file.type.startsWith('image/')) return rej(new Error('Choose an image file'));
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.78)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
    img.src = url;
  });
}

// The event being created / edited. Survives going to Add guests and back, cleared once saved.
export const useEventDraft = create(persist((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  patch: (p) => set((s) => ({ draft: s.draft ? { ...s.draft, ...p } : s.draft })),
  reset: () => set({ draft: null }),
}), { name: 'smu_event_draft_v1', storage: createJSONStorage(() => sessionStorage), partialize: (s) => ({ draft: s.draft }) }));

const JoinBtn = ({ e, onClick, className = '' }) => {
  const ready = e.join?.ok;
  return (
    <button type="button" className={`ev-join ${ready ? '' : 'off'} ${className}`} aria-disabled={!ready} onClick={(ev) => { ev.stopPropagation(); onClick(); }}>
      {e.call_type === 'video' ? <Video size={20} /> : <Phone size={19} />} Join
    </button>
  );
};
// One handler for every Join button: check first, then open the room.
function useJoin() {
  const nav = useNavigate(); const notify = useUI((s) => s.notify);
  return (e) => { if (!e.join?.ok) return notify(e.join?.reason || 'You cannot join this call'); nav(`/calls/room/${e.id}`); };
}

// ------------------------------------------------------------------ Events list (All / Scheduled calls / Not responded)
const TABS = [['all', 'All'], ['scheduled', 'Scheduled calls'], ['pending', 'Not responded']];
export function EventsList() {
  const nav = useNavigate(); const user = useAuth((s) => s.user); const join = useJoin();
  const [tab, setTab] = useState('scheduled');
  const list = useAsync(() => api.ceList(), []);
  useLive(list.reload); useTick();
  const items = useMemo(() => filterEvents(list.data || [], user?.id, tab), [list.data, user?.id, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const new_ = () => nav('/calls/events/new?fresh=1');
  let lastDay = '';
  return (
    <div className="screen">
      <AppHeader back fallback="/calls" title="Events" />
      <div className="ev-chips" role="tablist" aria-label="Filter events">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`ev-chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="scroll" style={{ paddingBottom: 120 }}>
        <button type="button" className="ev-new" onClick={new_}><span className="ev-new-ic"><Video size={26} /></span><span>Schedule call</span></button>
        {list.loading && !list.data && <div style={{ padding: '0 18px' }}><ListSkeleton n={3} /></div>}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && items.length === 0 && <Empty icon={CalendarDays} title={tab === 'pending' ? 'No pending invitations' : 'No scheduled calls'} text={tab === 'pending' ? 'Invitations waiting for your answer show up here.' : 'Plan a call for later and it will show up here.'} />}
        {items.map((e) => {
          const d = new Date(e.start_datetime); const k = d.toDateString(); const first = k !== lastDay; lastDay = k;
          const mine = e.guests.find((g) => g.user_id === user?.id);
          const badge = e.status === 'cancelled' ? 'Cancelled' : e.state === 'ended' ? 'Ended' : !e.me.host && mine?.invitation_status === 'pending' ? 'Invited' : !e.me.host && mine?.invitation_status === 'declined' ? 'Declined' : '';
          return (
            <div key={e.id} className="ev-row">
              <div className="ev-date">{first && <><small>{d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</small><b>{d.getDate()}</b></>}</div>
              <div className="ev-card" role="button" tabIndex={0} onClick={() => nav(`/calls/events/${e.id}`)} onKeyDown={(x) => x.key === 'Enter' && nav(`/calls/events/${e.id}`)}>
                <div className="ev-card-t">
                  <b>{e.title}</b>
                  <span>{timeRange(e)}</span>
                  <span>{callTypeLabel(e.call_type)}{badge && <em className={`ev-badge ${badge.toLowerCase()}`}>{badge}</em>}</span>
                </div>
                {e.join?.ok && (e.me.host || mine?.invitation_status === 'accepted') && <JoinBtn e={e} onClick={() => join(e)} />}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="ev-fab" aria-label="Schedule a call" onClick={new_}><CalendarPlus size={26} /></button>
    </div>
  );
}

// ------------------------------------------------------------------ Create / edit event
const blankDraft = (user, meetingId) => {
  const s = new Date(); s.setSeconds(0, 0); s.setMinutes(s.getMinutes() < 30 ? 30 : 60); const e = new Date(+s + 30 * 60e3);
  return { id: null, meeting_id: meetingId, title: `${user?.name || 'My'}'s call`, description: '', event_image: null, sd: dStr(s), st: tStr(s), ed: dStr(e), et: tStr(e), call_type: 'voice', require_approval: false, reminder_minutes: DEFAULT_REMINDER, guest_ids: [] };
};
const fromEvent = (e) => { const s = new Date(e.start_datetime), n = new Date(e.end_datetime); return { id: e.id, meeting_id: e.meeting_id, title: e.title, description: e.description || '', event_image: e.event_image, sd: dStr(s), st: tStr(s), ed: dStr(n), et: tStr(n), call_type: e.call_type, require_approval: e.require_approval, reminder_minutes: e.reminder_minutes, guest_ids: e.guests.filter((g) => g.invitation_status !== 'removed').map((g) => g.user_id) }; };
export const payloadOf = (f) => ({ title: f.title, description: f.description, event_image: f.event_image, start_datetime: at(f.sd, f.st)?.toISOString() ?? null, end_datetime: at(f.ed, f.et)?.toISOString() ?? null, call_type: f.call_type, require_approval: f.require_approval, reminder_minutes: f.reminder_minutes, meeting_id: f.meeting_id });

export function EventForm() {
  const { id } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const user = useAuth((s) => s.user); const notify = useUI((s) => s.notify);
  const { draft, setDraft } = useEventDraft();
  const [sheet, setSheet] = useState(null); const [err, setErr] = useState(''); const [ready, setReady] = useState(false);
  const file = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (id) {
          if (draft?.id === id) return live && setReady(true);
          const e = await api.ceGet(id);
          if (!e.me.host) throw new Error('Only the host can edit this event');
          if (e.state === 'cancelled' || e.state === 'ended') throw new Error(`This event ${e.state === 'ended' ? 'has ended' : 'was cancelled'}`);
          if (live) { setDraft(fromEvent(e)); setReady(true); }
        } else if (sp.get('fresh') || !draft || draft.id) {
          setDraft(blankDraft(user, await api.ceDraftId())); setSp({}, { replace: true }); if (live) setReady(true);
        } else if (live) setReady(true);
      } catch (e) { notify(errMsg(e)); nav('/calls/events', { replace: true }); }
    })();
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = ready ? draft : null;
  if (!f) return <div className="screen"><AppHeader back fallback="/calls/events" title={id ? 'Edit event' : 'Create event'} /></div>;
  const set = (p) => setDraft({ ...f, ...p });
  // moving the start keeps the end after it
  const setStart = (p) => { const n = { ...f, ...p }; const s = at(n.sd, n.st), e = at(n.ed, n.et); if (s && (!e || e <= s)) { const x = new Date(+s + 30 * 60e3); n.ed = dStr(x); n.et = tStr(x); } setDraft(n); };
  const pickImage = async (ev) => { const fl = ev.target.files?.[0]; ev.target.value = ''; if (!fl) return; try { set({ event_image: await shrinkImage(fl) }); } catch (e) { notify(errMsg(e)); } };
  const next = () => {
    const v = validateEvent(payloadOf(f));
    if (!v.ok) { setErr(v.error); notify(v.error); return; }
    setErr(''); nav('/calls/events/guests');
  };
  const dtRow = (label, dk, tk, onChange) => (
    <div className="ef-row" role="group" aria-label={label}>
      <CalendarDays size={24} />
      <label className="ef-pick grow"><span>{fmtDay(f[dk])}</span><input type="date" aria-label={`${label} date`} value={f[dk]} onClick={(e) => e.target.showPicker?.()} onChange={(e) => e.target.value && onChange({ [dk]: e.target.value })} /></label>
      <label className="ef-pick"><span>{fmtTime(f[tk])}</span><input type="time" aria-label={`${label} time`} value={f[tk]} onClick={(e) => e.target.showPicker?.()} onChange={(e) => e.target.value && onChange({ [tk]: e.target.value })} /></label>
    </div>
  );
  return (
    <div className="screen">
      <AppHeader back fallback="/calls/events" title={id ? 'Edit event' : 'Create event'} />
      <div className="scroll ef" style={{ paddingBottom: 120 }}>
        <div className="ef-top">
          <button type="button" className="ef-img" aria-label={f.event_image ? 'Change event image' : 'Add event image'} onClick={() => file.current?.click()}>
            {f.event_image ? <img src={f.event_image} alt="Event" /> : <ImagePlus size={28} />}
          </button>
          {f.event_image && <button type="button" className="ef-img-x" aria-label="Remove image" onClick={() => set({ event_image: null })}><X size={14} /></button>}
          <input ref={file} type="file" accept="image/*" hidden onChange={pickImage} />
          <div className="ef-title">
            <input aria-label="Event title" value={f.title} maxLength={MAX_TITLE} placeholder="Event title" onChange={(e) => set({ title: e.target.value })} />
            {f.title && <button type="button" aria-label="Clear title" onClick={() => set({ title: '' })}><X size={20} /></button>}
          </div>
          <textarea aria-label="Description" className="ef-desc" rows={2} maxLength={MAX_DESC} placeholder="Description (optional)" value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        {dtRow('Start', 'sd', 'st', setStart)}
        {dtRow('End', 'ed', 'et', (p) => set(p))}
        <button type="button" className="ef-row" onClick={() => setSheet('type')}>{f.call_type === 'video' ? <Video size={24} /> : <Phone size={24} />}<span className="ef-t grow"><b>Call type</b><small>{f.call_type === 'video' ? 'Video' : 'Voice'}</small></span></button>
        <div className="ef-row"><UserRoundCheck size={24} /><span className="ef-t grow"><b>Require approval to join call</b></span><Toggle on={f.require_approval} onChange={(v) => set({ require_approval: v })} label="Require approval to join call" /></div>
        <button type="button" className="ef-row" onClick={() => setSheet('reminder')}><Bell size={24} /><span className="ef-t grow"><b>Reminder</b><small>{reminderLabel(f.reminder_minutes)}</small></span></button>
        <div className="ef-row"><UserRound size={24} /><span className="ef-t grow"><b>Hosted by</b><small>{user?.name}</small><small>Your name on SendMeU. Edit in <button type="button" className="ef-link" onClick={() => nav('/profile/edit')}>Settings</button>.</small></span></div>
        <div className="ef-row note"><ShieldCheck size={24} /><span className="grow">Scheduling details will be visible to guests and SendMeU.</span></div>
        {err && <p className="ef-err" role="alert">{err}</p>}
      </div>
      <button type="button" className="ev-fab" aria-label="Next" onClick={next}><ArrowRight size={26} /></button>

      <Modal open={sheet === 'type'} onClose={() => setSheet(null)} title="Call type">
        {[['voice', 'Voice call', Phone], ['video', 'Video call', Video]].map(([k, l, I]) => (
          <button key={k} type="button" className={`ef-opt ${f.call_type === k ? 'on' : ''}`} onClick={() => { set({ call_type: k }); setSheet(null); }}><I size={22} /><span className="grow">{l}</span>{f.call_type === k && <Check size={20} />}</button>
        ))}
      </Modal>
      <Modal open={sheet === 'reminder'} onClose={() => setSheet(null)} title="Reminder">
        {REMINDER_OPTIONS.map((o) => (
          <button key={o.value} type="button" className={`ef-opt ${f.reminder_minutes === o.value ? 'on' : ''}`} onClick={() => { set({ reminder_minutes: o.value }); setSheet(null); }}><span className="grow">{o.label}</span>{f.reminder_minutes === o.value && <Check size={20} />}</button>
        ))}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Add guests
// mode 'draft': the Create/Edit flow (selection lives in the draft). mode 'invite': invite more people to a saved event.
const initial = (n) => (n || '?').trim()[0]?.toUpperCase();
export function AddGuests({ mode = 'draft' }) {
  const { id } = useParams(); const nav = useNavigate(); const notify = useUI((s) => s.notify); const me = useAuth((s) => s.user);
  const { draft, patch, reset } = useEventDraft();
  const people = useAsync(() => api.people({}), []);
  const calls = useAsync(() => api.calls(), []);
  const ev = useAsync(() => (mode === 'invite' ? api.ceGet(id) : Promise.resolve(null)), [mode, id]);
  const [q, setQ] = useState(''); const [searching, setSearching] = useState(false); const [picked, setPicked] = useState([]);
  const [linkOpen, setLinkOpen] = useState(false); const [busy, setBusy] = useState(false);

  const invited = useMemo(() => new Set(mode === 'invite' ? (ev.data?.guests || []).map((g) => g.user_id) : []), [mode, ev.data]);
  const selected = mode === 'draft' ? (draft?.guest_ids || []) : picked;
  const contacts = (people.data || []).filter((p) => p.id !== me?.id);
  const term = q.trim().toLowerCase();
  const match = (p) => !term || p.name.toLowerCase().includes(term) || (p.handle || '').toLowerCase().includes(term) || (p.phone || '').replace(/\s/g, '').includes(term.replace(/\s/g, ''));
  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));
  const score = (p) => (calls.data || []).filter((c) => c.name === p.name || c.name.split(' ')[0] === p.name.split(' ')[0]).length;
  const frequent = [...contacts].map((p) => [p, score(p) + (p.friend ? 0.5 : 0)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p);

  if (mode === 'draft' && !draft) return <Navigate to="/calls/events/new?fresh=1" replace />;
  const meetingId = mode === 'draft' ? draft.meeting_id : ev.data?.meeting_id;
  const link = meetingId ? `${window.location.origin}/calls/join/${meetingId}` : '';
  const toggle = (pid) => {
    if (invited.has(pid)) return notify('Already invited');
    const has = selected.includes(pid);
    const nextSel = has ? selected.filter((x) => x !== pid) : [...new Set([...selected, pid])];
    if (mode === 'draft') patch({ guest_ids: nextSel }); else setPicked(nextSel);
  };
  const submit = async () => {
    if (busy) return; setBusy(true);
    try {
      if (mode === 'invite') {
        const r = await api.ceAddGuests(id, picked); clearAsyncCache();
        notify(r.added?.length ? `Invited ${r.added.length} ${r.added.length === 1 ? 'person' : 'people'}` : 'Everyone was already invited');
        nav(`/calls/events/${id}`, { replace: true });
      } else {
        const body = { ...payloadOf(draft), guest_ids: draft.guest_ids };
        const e = draft.id ? await api.ceUpdate(draft.id, body) : await api.ceCreate(body);
        clearAsyncCache(); reset(); notify(draft.id ? 'Event updated' : 'Event created');
        if (draft.id) nav(`/calls/events/${e.id}`, { replace: true }); else nav('/calls', { replace: true }); // a new event lands on Calls, where it shows under Upcoming
      }
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };

  const Row = ({ p }) => {
    const on = selected.includes(p.id) || invited.has(p.id);
    return (
      <button type="button" className={`ag-row ${on ? 'on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={on} disabled={invited.has(p.id)}>
        <Avatar src={p.avatar} size={52} />
        <span className="ag-t grow"><b>{p.name}</b><small>{p.phone || p.handle}</small></span>
        {invited.has(p.id) ? <small className="ag-inv">Invited</small> : <span className={`ag-check ${on ? 'on' : ''}`}>{on && <Check size={16} strokeWidth={3} />}</span>}
      </button>
    );
  };
  const freq = frequent.filter(match); const all = sorted.filter(match);
  const label = mode === 'invite' ? (picked.length ? `Invite ${picked.length}` : 'Cancel') : selected.length ? (draft.id ? 'Save' : 'Create') : 'Skip';
  const onMain = mode === 'invite' && !picked.length ? () => nav(-1) : submit;
  return (
    <div className="screen">
      <header className="app-header ag-head">
        <button className="icon-btn" aria-label="Back" onClick={() => (searching ? (setSearching(false), setQ('')) : nav(-1))}><ArrowLeft size={22} /></button>
        {searching
          ? <input autoFocus className="ag-search" placeholder="Search name or number" aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
          : <div className="title"><span>Add guest</span><small>{selected.length + invited.size > 0 && mode === 'invite' ? `${picked.length} selected · ${invited.size} invited` : `${selected.length} of ${contacts.length} selected`}</small></div>}
        {searching ? (q && <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><X size={22} /></button>) : <button className="icon-btn" aria-label="Search contacts" onClick={() => setSearching(true)}><Search size={22} /></button>}
      </header>
      <div className="scroll" style={{ paddingBottom: 120 }}>
        <button type="button" className="ag-link" onClick={() => setLinkOpen(true)}><span className="ag-link-ic"><Link2 size={22} /></span><span className="ag-t"><b>Invite anyone via link</b><small>Guests can respond even if they're not on SendMeU.</small></span></button>
        {people.loading && !people.data && <div style={{ padding: '0 18px' }}><ListSkeleton n={4} /></div>}
        {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
        {!term && freq.length > 0 && <><h4 className="ag-h">Frequently contacted</h4>{freq.map((p) => <Row key={`f${p.id}`} p={p} />)}</>}
        {all.length > 0 && <h4 className="ag-h">Contacts on SendMeU</h4>}
        {all.map((p) => <Row key={p.id} p={p} />)}
        {!people.loading && term && all.length === 0 && <Empty icon={Search} title="No contacts found" text={`Nothing matches “${q}”.`} />}
      </div>
      <button type="button" className={`ev-fab pill ${busy ? 'busy' : ''}`} onClick={onMain} disabled={busy}>{busy ? '…' : label}</button>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Invite anyone via link">
        <p className="muted" style={{ marginBottom: 12 }}>Anyone with this link can open the invitation and respond after signing in to SendMeU.</p>
        <div className="ag-linkbox">{link || 'Generating link…'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <Button variant="outline" onClick={async () => notify((await copyText(link)) ? 'Link copied' : 'Could not copy the link')}><Copy size={18} /> Copy link</Button>
          <Button onClick={() => shareLink(draft?.title || ev.data?.title || 'Scheduled call', link, notify)}><Share2 size={18} /> Share</Button>
        </div>
        {mode === 'draft' && <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>The link starts working once the event is created.</p>}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Event details
export function EventDetails() {
  const { id } = useParams(); const nav = useNavigate(); const notify = useUI((s) => s.notify); const join = useJoin();
  const meId = useAuth((s) => s.user?.id);
  const ev = useAsync(() => api.ceGet(id), [id]);
  const parts = useAsync(() => api.ceParticipants(id), [id]);
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const reload = () => { clearAsyncCache(); ev.reload(); parts.reload(); };
  useLive(reload); useTick();
  const e = ev.data;
  const act = async (fn, msg) => { if (busy) return; setBusy(true); try { await fn(); if (msg) notify(msg); reload(); } catch (x) { notify(errMsg(x)); } finally { setBusy(false); } };

  if (ev.loading && !e) return <div className="screen"><AppHeader back fallback="/calls/events" title="Event" /><div style={{ padding: 18 }}><ListSkeleton n={4} /></div></div>;
  if (ev.error || !e) return <div className="screen"><AppHeader back fallback="/calls/events" title="Event" /><ErrorState message={ev.error || 'Event not found'} onRetry={ev.reload} /></div>;
  const open = e.state === 'upcoming' || e.state === 'live';
  const going = parts.data?.going || []; const waiting = parts.data?.not_responded || []; const declined = parts.data?.declined || []; const requests = parts.data?.requests || [];
  const nameOf = (p) => ((p.user_id || p.id) === meId ? 'You' : p.name);
  const Person = ({ p, children }) => <div className="ed-person"><Avatar src={p.avatar} size={52} /><span className="grow">{nameOf(p)}</span>{children}</div>;
  return (
    <div className="screen">
      <AppHeader back fallback="/calls/events" title="Event" right={<span className="ed-actions">
        <button className="icon-btn" aria-label="Share event" onClick={() => shareLink(e.title, e.meeting_link, notify)}><Share2 size={22} /></button>
        {e.me.host && open && <button className="icon-btn" aria-label="Edit event" onClick={() => nav(`/calls/events/${e.id}/edit`)}><Pencil size={22} /></button>}
      </span>} />
      <div className="scroll" style={{ paddingBottom: e.me.host && open ? 110 : 30 }}>
        {e.event_image && <img className="ed-cover" src={e.event_image} alt="" />}
        <h1 className="ed-title">{e.title}</h1>
        {e.status === 'cancelled' && <p className="ed-banner bad">This event was cancelled.</p>}
        {e.status !== 'cancelled' && e.state === 'ended' && <p className="ed-banner">This event has ended.</p>}
        {e.description && <p className="ed-desc">{e.description}</p>}
        <div className="ed-row"><CalendarDays size={24} /><div className="grow"><b>{longDate(e.start_datetime)} · {timeRange(e)}</b>{open && <button type="button" className="ef-link" onClick={() => downloadICS(e)}>Add to calendar</button>}</div></div>
        <div className="ed-row">
          {e.call_type === 'video' ? <Video size={24} /> : <Phone size={24} />}
          <div className="grow"><b>SendMeU {callTypeLabel(e.call_type)}</b>{e.status !== 'cancelled' && <button type="button" className="ef-link" onClick={async () => notify((await copyText(e.meeting_link)) ? 'Link copied' : 'Could not copy the link')}>Copy link</button>}</div>
          {open && (e.me.host || e.me.status === 'accepted') && <JoinBtn e={e} onClick={() => join(e)} />}
        </div>
        {e.require_approval && <div className="ed-row sub"><UserRoundCheck size={24} /><div className="grow"><b>Approval required</b><small>The host lets guests in when they ask to join.</small></div></div>}
        <div className="ed-row"><Bell size={24} /><div className="grow"><b>Reminder</b><small>{reminderLabel(e.reminder_minutes)}</small></div></div>
        {open && !e.me.host && e.me.status === 'pending' && (
          <div className="ed-respond"><b>You're invited</b><div><Button variant="outline" onClick={() => act(() => api.ceRespond(e.id, 'declined'), 'Declined')}>Decline</Button><Button onClick={() => act(() => api.ceRespond(e.id, 'accepted'), 'You are going')}>Accept</Button></div></div>
        )}
        {open && !e.me.host && e.me.status === 'accepted' && <button type="button" className="ed-quiet" onClick={() => act(() => api.ceRespond(e.id, 'declined'), 'Declined')}>I can't go</button>}
        {open && !e.me.host && e.me.status === 'declined' && <button type="button" className="ed-quiet" onClick={() => act(() => api.ceRespond(e.id, 'accepted'), 'You are going')}>Actually, I'm going</button>}
        {!e.me.host && !e.me.status && open && <div className="ed-respond"><b>You opened an invitation link</b><div><Button variant="outline" onClick={() => act(() => api.ceRespond(e.id, 'declined'), 'Declined')}>Decline</Button><Button onClick={() => act(() => api.ceRespond(e.id, 'accepted'), 'You are going')}>Accept</Button></div></div>}

        {e.me.host && requests.length > 0 && (<>
          <div className="ed-sec"><b>Asking to join</b><span>{requests.length}</span></div>
          {requests.map((p) => <Person key={p.user_id} p={p}><span className="ed-btns"><button className="ed-mini" onClick={() => act(() => api.ceDecide(e.id, p.user_id, false))}>Reject</button><button className="ed-mini go" onClick={() => act(() => api.ceDecide(e.id, p.user_id, true), 'Approved')}>Approve</button></span></Person>)}
        </>)}

        <div className="ed-sec"><b>Going</b><span>{going.length} {going.length === 1 ? 'person' : 'people'}</span></div>
        {going.map((p) => <Person key={p.user_id || p.id} p={p}>{p.creator && <em className="ed-creator">Creator</em>}{e.me.host && !p.creator && open && <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => act(() => api.ceRemoveGuest(e.id, p.user_id), 'Removed')}><X size={18} /></button>}</Person>)}
        <div className="ed-sec"><b>Not responded</b><span>{waiting.length} {waiting.length === 1 ? 'person' : 'people'}</span></div>
        {waiting.length === 0 && <p className="ed-none">Everyone has responded.</p>}
        {waiting.map((p) => <Person key={p.user_id} p={p}>{e.me.host && open && <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => act(() => api.ceRemoveGuest(e.id, p.user_id), 'Removed')}><X size={18} /></button>}</Person>)}
        {declined.length > 0 && <><div className="ed-sec"><b>Can't go</b><span>{declined.length}</span></div>{declined.map((p) => <Person key={p.user_id} p={p} />)}</>}
        {e.me.host && e.status !== 'cancelled' && e.state !== 'ended' && <button type="button" className="ed-cancel" onClick={() => setConfirm(true)}><Trash2 size={18} /> Cancel event</button>}
      </div>
      {e.me.host && open && <div className="ed-foot"><button type="button" className="ed-invite" onClick={() => nav(`/calls/events/${e.id}/invite`)}>Invite more guests</button></div>}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Cancel this event?">
        <p className="muted" style={{ marginBottom: 14 }}>Everyone invited will be told it was cancelled. This can't be undone.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setConfirm(false)}>Keep event</Button>
          <Button onClick={() => { setConfirm(false); act(() => api.ceCancel(e.id), 'Event cancelled'); }}>Cancel event</Button>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Opening an invitation link (/calls/join/:meetingId)
export function JoinLink() {
  const { meetingId } = useParams(); const nav = useNavigate();
  const ev = useAsync(() => api.ceByLink(meetingId), [meetingId]);
  useEffect(() => { if (ev.data && (ev.data.me.host || ev.data.me.status)) nav(`/calls/events/${ev.data.id}`, { replace: true }); }, [ev.data]); // eslint-disable-line
  if (ev.loading && !ev.data) return <div className="screen"><AppHeader back fallback="/calls" title="Invitation" /><div style={{ padding: 18 }}><ListSkeleton n={2} /></div></div>;
  if (ev.error) return <div className="screen"><AppHeader back fallback="/calls" title="Invitation" /><Empty icon={Link2} title="Link not valid" text={ev.error} /></div>;
  return (
    <div className="screen">
      <AppHeader back fallback="/calls" title="Invitation" />
      <div className="scroll" style={{ padding: 18 }}>
        <h1 className="ed-title" style={{ padding: 0 }}>{ev.data?.title}</h1>
        <p className="muted">{ev.data && `${longDate(ev.data.start_datetime)} · ${timeRange(ev.data)}`}</p>
        <p className="muted" style={{ margin: '8px 0 18px' }}>Hosted by {ev.data?.host.name}</p>
        <Button onClick={() => nav(`/calls/events/${ev.data.id}`)}>View invitation</Button>
      </div>
    </div>
  );
}
