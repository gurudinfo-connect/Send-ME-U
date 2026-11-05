import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarHeart, Heart, Cake, Plane, Plus, Trash2, Bell, Clock, Pencil } from 'lucide-react';
import { AppHeader, Button, TextField, Modal, Empty, ErrorState, ListSkeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const KINDS = { love: [Heart, '#ffe1ec', '#ff4d6d'], cake: [Cake, '#ffeccf', '#f59e0b'], trip: [Plane, '#dff3ff', '#2f6bff'] };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REMINDERS = ['None', 'At time of event', '1 hour before', '2 hours before', '1 day before'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pretty = (s) => new Date(`${s}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const blank = (date) => ({ title: '', date, time: '09:00', kind: 'love', reminder: '1 day before', note: '' });

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const notify = useUI((s) => s.notify);
  const today = new Date();
  const [cur, setCur] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [sel, setSel] = useState(iso(today));
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ev = useAsync(() => api.events(), []);

  useEffect(() => { if (params.get('new')) { setForm(blank(sel)); setParams({}, { replace: true }); } }, []); // eslint-disable-line

  const events = ev.data || [];
  const byDate = useMemo(() => events.reduce((m, e) => ((m[e.date] ||= []).push(e), m), {}), [events]);
  const cells = useMemo(() => {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1).getDay();
    const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const prevDays = new Date(cur.getFullYear(), cur.getMonth(), 0).getDate();
    return Array.from({ length: 42 }, (_, i) => {
      const n = i - first + 1;
      if (n < 1) return { d: new Date(cur.getFullYear(), cur.getMonth() - 1, prevDays + n), off: true };
      if (n > days) return { d: new Date(cur.getFullYear(), cur.getMonth() + 1, n - days), off: true };
      return { d: new Date(cur.getFullYear(), cur.getMonth(), n) };
    }).slice(0, first + days > 35 ? 42 : 35);
  }, [cur]);
  const upcoming = [...events].filter((e) => e.date >= iso(today)).sort((a, b) => a.date.localeCompare(b.date));
  const dayEvents = byDate[sel] || [];

  const save = async () => {
    if (!form.title.trim()) return setErr('Title is required');
    setBusy(true); setErr('');
    try {
      const r = await api.saveEvent(form);
      ev.setData((d) => (form.id ? d.map((x) => (x.id === r.id ? r : x)) : [...d, r]));
      setForm(null); notify(form.id ? 'Event updated' : 'Event created');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async (e) => {
    try { await api.deleteEvent(e.id); ev.setData((d) => d.filter((x) => x.id !== e.id)); setDetail(null); notify('Event deleted'); } catch (er) { notify(errMsg(er)); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const EventRow = ({ e }) => {
    const [I, bg, fg] = KINDS[e.kind] || KINDS.love;
    return (
      <button className="event" onClick={() => setDetail(e)}>
        <span className="ic" style={{ background: bg, color: fg }}><I size={20} /></span>
        <span className="grow">{e.title}<small>{pretty(e.date)} · {e.time}</small></span><ChevronRight size={18} color="var(--muted)" />
      </button>
    );
  };

  return (
    <div className="screen">
      <AppHeader back="/home" title="Our Calendar" right={<button className="icon-btn" aria-label="Add event" onClick={() => setForm(blank(sel))}><CalendarHeart size={22} /></button>} />
      <div className="scroll">
        <div className="cal-head">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))}><ChevronLeft size={20} /></button>
          <span>{cur.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button className="icon-btn" aria-label="Next month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))}><ChevronRight size={20} /></button>
        </div>
        <div className="cal-grid">
          {DOW.map((d) => <span key={d} className="dow">{d}</span>)}
          {cells.map(({ d, off }) => {
            const k = iso(d);
            return <button key={k} className={`cal-day ${off ? 'off' : ''} ${k === sel ? 'sel' : ''} ${k === iso(today) ? 'today' : ''} ${byDate[k] ? 'has' : ''}`} onClick={() => { setSel(k); if (off) setCur(new Date(d.getFullYear(), d.getMonth(), 1)); }} aria-label={pretty(k)}>{d.getDate()}</button>;
          })}
        </div>

        {dayEvents.length > 0 && (<><h3 className="h2" style={{ fontSize: 16, margin: '18px 0 10px' }}>{pretty(sel)}</h3>{dayEvents.map((e) => <EventRow key={e.id} e={e} />)}</>)}

        <h3 className="h2" style={{ fontSize: 16, margin: '18px 0 10px' }}>Upcoming</h3>
        {ev.loading && <ListSkeleton n={3} />}
        {ev.error && <ErrorState message={ev.error} onRetry={ev.reload} />}
        {!ev.loading && !ev.error && upcoming.length === 0 && <Empty title="No upcoming events" text="Plan something special together." action={<Button className="btn-sm" onClick={() => setForm(blank(sel))}>Add event</Button>} />}
        {upcoming.map((e) => <EventRow key={e.id} e={e} />)}
      </div>
      <button className="fab fab-blue" aria-label="Add event" style={{ bottom: 24 }} onClick={() => setForm(blank(sel))}><Plus size={26} /></button>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit event' : 'New event'}>
        {form && (<>
          {err && <p className="err" style={{ marginBottom: 8 }}>{err}</p>}
          <TextField placeholder="Event title" value={form.title} onChange={set('title')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label className="input"><input type="date" value={form.date} onChange={set('date')} /></label></div>
            <div className="field"><label className="input"><input type="time" value={form.time} onChange={set('time')} /></label></div>
          </div>
          <div className="chip-row" style={{ marginBottom: 12 }}>{Object.keys(KINDS).map((k) => <button key={k} type="button" className={`chip ${form.kind === k ? 'active' : ''}`} onClick={() => setForm({ ...form, kind: k })}>{{ love: '❤️ Special', cake: '🎂 Birthday', trip: '✈️ Trip' }[k]}</button>)}</div>
          <div className="field"><label className="input"><Bell size={18} /><select value={form.reminder} onChange={set('reminder')} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14 }}>{REMINDERS.map((r) => <option key={r}>{r}</option>)}</select></label></div>
          <div className="field"><label className="input textarea-box"><textarea rows={3} placeholder="Notes (optional)" value={form.note} onChange={set('note')} /></label></div>
          <Button loading={busy} onClick={save}>{form.id ? 'Save changes' : 'Create event'}</Button>
        </>)}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Event details">
        {detail && (<>
          <h3 className="h2" style={{ marginBottom: 8 }}>{detail.title}</h3>
          <p className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><Clock size={15} /> {pretty(detail.date)} · {detail.time}</p>
          <p className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><Bell size={15} /> Reminder: {detail.reminder}</p>
          {detail.note && <p style={{ margin: '10px 0 16px', fontSize: 14 }}>{detail.note}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Button variant="outline" onClick={() => { setForm({ ...detail }); setDetail(null); }}><Pencil size={16} /> Edit</Button>
            <Button variant="danger" onClick={() => remove(detail)}><Trash2 size={16} /> Delete</Button>
          </div>
        </>)}
      </Modal>
    </div>
  );
}
