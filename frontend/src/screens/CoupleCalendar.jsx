import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarHeart, Plus, Trash2, Clock, MapPin, Users, EyeOff, Ban, CheckCircle2 } from 'lucide-react';
import { Button, TextField, Modal, Empty, ErrorState, Skeleton } from '../components/ui';
import { api, errMsg } from '../services/api';
import { subscribeCouple } from '../services/socket';
import { useUI } from '../store';
import { apptLabel } from '../couple/scheduling';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const atMin = (k, min) => { const d = new Date(`${k}T00:00`); d.setMinutes(min); return d; };       // local time on date k
const minOf = (isoStr, k) => Math.round((new Date(isoStr) - new Date(`${k}T00:00`)) / 60000);
const fmtMin = (m) => new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtT = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const prettyDay = (k) => new Date(`${k}T00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (s) => new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
const DAY_FROM = 7 * 60, DAY_TO = 23 * 60; // the part of the day couples plan around (local)
const range = (a, b, step = 30) => Array.from({ length: Math.max(0, Math.floor((b - a) / step) + 1) }, (_, i) => a + i * step);

export function CoupleCalendar({ partner }) {
  const today = new Date();
  const [cur, setCur] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState(keyOf(today));
  const [sheet, setSheet] = useState(null);            // { date, edit?: appointment, kind?: string }
  const [appts, setAppts] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [status, setStatus] = useState('loading');    // loading | ready | error
  const [error, setError] = useState('');

  const cells = useMemo(() => {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1).getDay();
    const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const total = first + days > 35 ? 42 : 35;
    return Array.from({ length: total }, (_, i) => new Date(cur.getFullYear(), cur.getMonth(), i - first + 1));
  }, [cur]);
  const fromIso = cells[0] && atMin(keyOf(cells[0]), 0).toISOString();
  const toIso = cells.length && atMin(keyOf(cells[cells.length - 1]), 24 * 60).toISOString();

  const load = useCallback(async () => {
    try {
      const [month, next] = await Promise.all([
        api.coupleAppointments({ from: fromIso, to: toIso }),
        api.coupleAppointments({ from: new Date().toISOString(), to: new Date(Date.now() + 60 * 864e5).toISOString() }),
      ]);
      setAppts(month); setUpcoming(next.slice(0, 3)); setStatus('ready'); setError('');
    } catch (e) { setError(errMsg(e)); setStatus('error'); }
  }, [fromIso, toIso]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeCouple((name) => { if (name.startsWith('appointment:') || name === 'socket:reconnected') load(); }), [load]);

  const byDay = useMemo(() => appts.reduce((m, a) => { const k = keyOf(new Date(a.start_time)); (m[k] ||= []).push(a); return m; }, {}), [appts]);
  const open = (k, extra = {}) => { setPicked(k); setSheet({ date: k, ...extra }); };
  const first = (partner?.name || 'your partner').split(' ')[0];

  return (
    <section className="cc" aria-label="Couple calendar">
      <div className="cc-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))}><ChevronLeft size={20} /></button>
        <h2 aria-live="polite">{cur.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button className="icon-btn" aria-label="Next month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))}><ChevronRight size={20} /></button>
      </div>

      <div className="cc-grid" role="grid" aria-label="Month">
        {DOW.map((d) => <span key={d} className="cc-dow" role="columnheader">{d}</span>)}
        {cells.map((d) => {
          const k = keyOf(d), n = byDay[k]?.length || 0, off = d.getMonth() !== cur.getMonth();
          return (
            <button key={k} role="gridcell" className={`cc-day ${off ? 'off' : ''} ${k === keyOf(today) ? 'today' : ''} ${k === picked ? 'sel' : ''}`}
              aria-label={`${prettyDay(k)}${n ? `, ${n} appointment${n > 1 ? 's' : ''}` : ''}`} aria-current={k === keyOf(today) ? 'date' : undefined} aria-pressed={k === picked}
              onClick={() => { if (off) setCur(new Date(d.getFullYear(), d.getMonth(), 1)); open(k); }}>
              {d.getDate()}{n > 0 && <i className="cc-dots" aria-hidden>{Array.from({ length: Math.min(n, 3) }).map((_, i) => <b key={i} />)}</i>}
            </button>
          );
        })}
      </div>

      <div className="cc-actions">
        <Button className="btn-sm" onClick={() => open(picked, { kind: 'meetup' })}><CalendarHeart size={16} /> Plan time with {first}</Button>
        <Button variant="outline" className="btn-sm" onClick={() => open(picked, { kind: 'busy' })}><Clock size={16} /> My availability</Button>
      </div>

      <h3 className="cc-sub">Upcoming</h3>
      {status === 'loading' && <><Skeleton h={54} r={14} /><div style={{ height: 8 }} /><Skeleton h={54} r={14} /></>}
      {status === 'error' && <ErrorState message={error} onRetry={() => { setStatus('loading'); load(); }} />}
      {status === 'ready' && upcoming.length === 0 && <p className="cc-empty">Nothing planned yet. Pick a date to find time you are both free.</p>}
      {status === 'ready' && upcoming.map((a) => (
        <button key={a.id} className="cc-appt" onClick={() => open(keyOf(new Date(a.start_time)), { edit: a })}>
          <span className="cc-ic"><CalendarHeart size={18} /></span>
          <span className="grow"><b>{apptLabel(a)}</b><small>{shortDay(a.start_time)} · {fmtT(a.start_time)} – {fmtT(a.end_time)}</small></span>
          <ChevronRight size={18} color="var(--muted)" />
        </button>
      ))}

      {sheet && <DaySheet key={`${sheet.date}|${sheet.edit?.id || ''}|${sheet.kind || ''}`} {...sheet} partnerName={first} dayAppts={appts.filter((a) => keyOf(new Date(a.start_time)) === sheet.date)} onClose={() => setSheet(null)} onChanged={load} />}
    </section>
  );
}

const KINDS = [['meetup', 'Meetup', Users], ['personal', 'Personal', EyeOff], ['busy', 'Busy', Ban], ['available', 'Free', CheckCircle2]];

function DaySheet({ date, edit = null, kind = null, partnerName, dayAppts, onClose, onChanged }) {
  const notify = useUI((s) => s.notify);
  const [day, setDay] = useState(date);
  const [slots, setSlots] = useState(null);           // null = loading; { me, partner, mutual, slots }
  const [slotErr, setSlotErr] = useState('');
  const [mine, setMine] = useState([]);                // my availability blocks that day
  const [form, setForm] = useState(() => (edit ? fromAppt(edit, date) : kind ? blank(kind) : null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const formDate = form?.date || day;
  const dayFrom = atMin(formDate, DAY_FROM).toISOString(), dayTo = atMin(formDate, DAY_TO).toISOString();

  const loadSlots = useCallback(async () => {
    try {
      const [s, av] = await Promise.all([
        api.coupleSlots({ from: dayFrom, to: dayTo, ignoreId: form?.id, notBefore: new Date(Math.ceil(Date.now() / 1800000) * 1800000).toISOString() }),
        api.availability({ from: atMin(formDate, 0).toISOString(), to: atMin(formDate, 24 * 60).toISOString() }),
      ]);
      setSlots(s); setMine(av); setSlotErr('');
    } catch (e) { setSlotErr(errMsg(e)); setSlots({ me: [], partner: [], mutual: [], slots: [] }); }
  }, [dayFrom, dayTo, formDate, form?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSlots(null); loadSlots(); }, [loadSlots]);
  useEffect(() => subscribeCouple((n) => { if (n.startsWith('appointment:') || n === 'availability:updated' || n === 'socket:reconnected') loadSlots(); }), [loadSlots]);
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f); }, [onClose]);

  // minutes-from-midnight sets for the form's date
  const cellSet = useMemo(() => new Set((slots?.slots || []).map((c) => minOf(c.start, formDate))), [slots, formDate]);
  const mutualRanges = useMemo(() => (slots?.mutual || []).map((r) => ({ a: minOf(r.start, formDate), b: minOf(r.end, formDate) })), [slots, formDate]);
  const meetup = form?.kind === 'meetup';
  const startOk = (m) => !meetup || cellSet.has(m);
  const endOk = (m) => !meetup || (m > form.start && range(form.start, m - 30).every((x) => cellSet.has(x)));
  const startOpts = meetup ? range(DAY_FROM, DAY_TO - 30) : range(0, 24 * 60 - 30);
  const endOpts = meetup ? range(DAY_FROM + 30, DAY_TO) : range(30, 24 * 60);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setNum = (k) => (e) => {
    const v = Number(e.target.value), next = { ...form, [k]: v };
    if (k === 'start' && next.end <= v) next.end = Math.min(v + 60, meetup ? DAY_TO : 24 * 60);
    setForm(next);
  };
  const pickRange = (r) => setForm({ ...(form || blank('meetup', formDate)), kind: 'meetup', start: r.a, end: Math.min(r.b, r.a + 90) });
  const startKind = (k) => { setErr(''); setForm({ ...blank(k, formDate), ...(form ? { title: form.title, location: form.location, notes: form.notes } : {}) }); };

  const submit = async () => {
    setErr('');
    const f = form, d = f.date, start = atMin(d, f.start).toISOString(), end = atMin(d, f.end).toISOString();
    if (f.end <= f.start) return setErr('End time must be after the start time');
    if ((f.kind === 'meetup' || f.kind === 'personal') && !f.title.trim()) return setErr('Give it a name');
    if (f.kind === 'meetup' && !f.location.trim()) return setErr('Add a location so ' + partnerName + ' knows where');
    setBusy(true);
    try {
      if (f.kind === 'busy' || f.kind === 'available') { await api.addAvailability({ availability_type: f.kind, start_time: start, end_time: end }); notify(f.kind === 'busy' ? 'Marked as busy' : 'Marked as available'); }
      else {
        const body = { title: f.title, location: f.location, notes: f.notes, start_time: start, end_time: end, visibility: f.kind === 'personal' ? 'private' : 'shared', window: { start: atMin(d, DAY_FROM).toISOString(), end: atMin(d, DAY_TO).toISOString() } };
        if (f.id) { await api.updateAppointment(f.id, { ...body, rev: f.rev }); notify('Appointment updated'); } else { await api.createAppointment(body); notify(f.kind === 'meetup' ? `Booked. ${partnerName} has been notified` : 'Added to your calendar'); }
      }
      setForm(null); onChanged(); await loadSlots();
    } catch (e) {
      const code = e?.response?.data?.code;
      setErr(errMsg(e)); if (code === 'overlap' || code === 'not_mutually_free' || code === 'stale') { loadSlots(); onChanged(); }
    } finally { setBusy(false); }
  };
  const cancelAppt = async () => {
    if (!confirmCancel) return setConfirmCancel(true);
    setBusy(true);
    try { await api.cancelAppointment(form.id); notify('Appointment cancelled'); setForm(null); setConfirmCancel(false); onChanged(); await loadSlots(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const removeBlock = async (b) => { try { await api.deleteAvailability(b.id); await loadSlots(); } catch (e) { notify(errMsg(e)); } };

  return (
    <Modal open onClose={onClose} title={prettyDay(formDate)}>
      <p className="cc-tz">Times are in your local time{tz ? ` (${tz})` : ''}</p>

      <Bars slots={slots} formDate={formDate} partnerName={partnerName} />
      {slotErr && <p className="err" role="alert">{slotErr}</p>}
      {slots && mutualRanges.length === 0 && !slotErr && <p className="cc-note">You are not both free at any point on this day. Try another date, or free up some time.</p>}
      {mutualRanges.length > 0 && (
        <div className="cc-chips" aria-label="Times you are both free">
          {mutualRanges.map((r) => <button key={r.a} className="cc-chip" onClick={() => pickRange(r)}>{fmtMin(r.a)} – {fmtMin(r.b)}</button>)}
        </div>
      )}

      {dayAppts.length > 0 && !form && (<>
        <h4 className="cc-h4">On this day</h4>
        {dayAppts.map((a) => (
          <button key={a.id} className="cc-appt" onClick={() => { setConfirmCancel(false); setErr(''); setForm(fromAppt(a, day)); }}>
            <span className="cc-ic">{a.visibility === 'private' ? <EyeOff size={18} /> : <CalendarHeart size={18} />}</span>
            <span className="grow"><b>{apptLabel(a)}</b><small>{fmtT(a.start_time)} – {fmtT(a.end_time)}{a.visibility === 'private' ? ' · only you' : ''}</small></span>
          </button>
        ))}
      </>)}

      {mine.length > 0 && !form && (<>
        <h4 className="cc-h4">My availability</h4>
        {mine.map((b) => (
          <div key={b.id} className="cc-block">
            <span className={`cc-tag ${b.availability_type}`}>{b.availability_type === 'busy' ? 'Busy' : 'Free'}</span>
            <span className="grow">{fmtT(b.start_time)} – {fmtT(b.end_time)}</span>
            <button className="icon-btn" aria-label={`Remove ${b.availability_type} block at ${fmtT(b.start_time)}`} onClick={() => removeBlock(b)}><Trash2 size={16} color="#8a6df0" /></button>
          </div>
        ))}
      </>)}

      {!form && (
        <div className="cc-actions" style={{ marginTop: 14 }}>
          <Button onClick={() => { setErr(''); setForm(blank('meetup', day, mutualRanges[0])); }}><Plus size={18} /> Book a meetup</Button>
          <Button variant="outline" onClick={() => { setErr(''); setForm(blank('busy', day)); }}>Add busy / free / personal</Button>
        </div>
      )}

      {form && (
        <form className="cc-form" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={form.id ? 'Edit appointment' : 'New entry'}>
          {!form.id && (
            <div className="seg" role="tablist" aria-label="What are you adding?">
              {KINDS.map(([k, l, I]) => <button type="button" key={k} role="tab" aria-selected={form.kind === k} className={form.kind === k ? 'active' : ''} onClick={() => startKind(k)}><I size={14} />{l}</button>)}
            </div>
          )}
          {form.kind === 'personal' && <p className="cc-note"><EyeOff size={14} /> Only you see this. {partnerName} just sees you as busy.</p>}
          {(form.kind === 'meetup' || form.kind === 'personal') && (<>
            <TextField placeholder={form.kind === 'meetup' ? 'Meetup name (e.g. Coffee Date)' : 'What is it?'} value={form.title} onChange={set('title')} maxLength={80} aria-label="Name" />
            <TextField icon={MapPin} placeholder={form.kind === 'meetup' ? 'Location (e.g. Cubbon Park)' : 'Location (optional)'} value={form.location} onChange={set('location')} maxLength={120} aria-label="Location" />
          </>)}
          <div className="cc-times">
            <label className="cc-sel"><span>Date</span><input type="date" value={form.date} min={keyOf(new Date())} onChange={(e) => e.target.value && setForm({ ...form, date: e.target.value })} /></label>
            <label className="cc-sel"><span>Starts</span>
              <select value={form.start} onChange={setNum('start')}>{startOpts.map((m) => <option key={m} value={m} disabled={!startOk(m)}>{fmtMin(m)}</option>)}</select></label>
            <label className="cc-sel"><span>Ends</span>
              <select value={form.end} onChange={setNum('end')}>{endOpts.map((m) => <option key={m} value={m} disabled={!endOk(m)}>{fmtMin(m)}</option>)}</select></label>
          </div>
          {meetup && slots && !startOk(form.start) && <p className="cc-note">That start time is not free for both of you. Pick one of the times above.</p>}
          {(form.kind === 'meetup' || form.kind === 'personal') && <div className="field"><label className="input textarea-box"><textarea rows={2} placeholder="Notes (optional, only you can see them)" value={form.notes} onChange={set('notes')} maxLength={500} aria-label="Notes" /></label></div>}
          {err && <p className="err" role="alert">{err}</p>}
          <div className="cc-actions">
            <Button type="submit" loading={busy}>{form.id ? 'Save changes' : form.kind === 'meetup' ? 'Confirm booking' : form.kind === 'personal' ? 'Add to my calendar' : form.kind === 'busy' ? 'Mark busy' : 'Mark available'}</Button>
            <Button type="button" variant="outline" onClick={() => { setForm(null); setErr(''); setConfirmCancel(false); }}>Back</Button>
          </div>
          {form.id && <button type="button" className="cc-danger" disabled={busy} onClick={cancelAppt}>{confirmCancel ? 'Tap again to cancel this appointment' : 'Cancel appointment'}</button>}
        </form>
      )}
    </Modal>
  );
}

function Bars({ slots, formDate, partnerName }) {
  if (!slots) return <Skeleton h={92} r={14} />;
  const cellsN = (DAY_TO - DAY_FROM) / 30;
  const row = (free) => {
    const rs = free.map((r) => ({ a: minOf(r.start, formDate), b: minOf(r.end, formDate) }));
    return Array.from({ length: cellsN }, (_, i) => { const s = DAY_FROM + i * 30; return rs.some((r) => r.a <= s && s + 30 <= r.b); });
  };
  const rows = [['You', row(slots.me)], [partnerName, row(slots.partner)], ['Both', row(slots.mutual)]];
  const sum = (free) => free.length ? free.map((r) => `${fmtT(r.start)} to ${fmtT(r.end)}`).join(', ') : 'no free time';
  return (
    <div className="cc-bars" role="img" aria-label={`Free time. You: ${sum(slots.me)}. ${partnerName}: ${sum(slots.partner)}. Both: ${sum(slots.mutual)}.`}>
      {rows.map(([name, cs]) => (
        <div key={name} className="cc-bar"><span>{name}</span><div className={name === 'Both' ? 'both' : ''}>{cs.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}</div></div>
      ))}
      <div className="cc-scale" aria-hidden><span>{fmtMin(DAY_FROM)}</span><span>{fmtMin(15 * 60)}</span><span>{fmtMin(DAY_TO)}</span></div>
    </div>
  );
}

function blank(kind, date = keyOf(new Date()), r = null) {
  return { kind, date, title: '', location: '', notes: '', start: r ? r.a : 18 * 60, end: r ? Math.min(r.b, r.a + 90) : 19 * 60 + 30 };
}
function fromAppt(a, day) {
  const k = keyOf(new Date(a.start_time));
  return { id: a.id, rev: a.rev, kind: a.visibility === 'private' ? 'personal' : 'meetup', date: k || day, title: a.title, location: a.location || '', notes: a.notes || '', start: minOf(a.start_time, k), end: minOf(a.end_time, k) };
}
