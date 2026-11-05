import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Check, Copy, Share2, Mail, MessageCircle, MessageSquare, Plus, Trash2, Crown, Flame, Image as ImageIcon, Palette, Lock,
  Sparkles, RefreshCw, ShieldCheck, Delete, Search, Pencil, AlertTriangle, ExternalLink, Ban, Smartphone,
} from 'lucide-react';
import { AppHeader, Avatar, Button, Empty, ListSkeleton, Modal, TextField, Toggle, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { applyTheme, useAuth, useChatPrefs, useMenu, useProfile, useUI } from '../store';
import { APP_VERSION, FAQS, LANGUAGES, PAGES, langLabel } from './registry';

/* ---------- small helpers ---------- */
const fmtBytes = (n = 0) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const download = (name, obj) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const sha = async (s) => {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`smu:${s}`)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  catch { return btoa(`smu:${s}`); }
};
const isDirect = (c) => !c.locked && c.type !== 'couple' && c.type !== 'group' && c.kind !== 'groups';
const INVITE = (handle) => `https://sendmeu.app/i/${(handle || '').replace(/^@/, '')}`;

/* ---------- layout pieces ---------- */
function Shell({ title, children, right }) {
  return (
    <div className="screen yp">
      <AppHeader back fallback="/profile" title={title} right={right} />
      <div className="scroll yp-scroll">{children}</div>
    </div>
  );
}

function Row({ title, sub, right, onClick, danger, icon: I, tone }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`yp-row ${danger ? 'danger' : ''}`} type={onClick ? 'button' : undefined} onClick={onClick}>
      {I && <span className="yp-ic" style={tone ? { color: tone } : undefined}><I size={22} /></span>}
      <span className="yp-t"><b>{title}</b>{sub != null && sub !== '' && <small>{sub}</small>}</span>
      {right}
    </Tag>
  );
}

const Section = ({ h, children }) => (
  <section className="yp-sec">{h && <h3 className="yp-h">{h}</h3>}{children}</section>
);

function Radio({ on, label, desc, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`mx-radio ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="dot">{on && <i />}</span>
      <span className="grow"><b>{label}</b>{desc && <small>{desc}</small>}</span>
    </button>
  );
}

function Confirm({ open, title, text, cta = 'Confirm', danger, onCancel, onOk }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="muted" style={{ marginBottom: 16, fontSize: 14 }}>{text}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onOk}>{cta}</Button>
      </div>
    </Modal>
  );
}

/* ---------- registry-driven item ---------- */
function Item({ it, ctx, actions }) {
  const { settings, setSetting } = ctx;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const nav = useNavigate();
  const txt = (v) => (typeof v === 'function' ? v(ctx) : v);
  const cur = it.k ? (settings[it.k] ?? it.def) : undefined;

  if (it.t === 'note') return <p className="yp-note">{it.text}</p>;
  if (it.t === 'info') return <Row title={it.label} sub={txt(it.value)} />;
  if (it.t === 'link') return <Row title={it.label} sub={txt(it.desc)} danger={it.danger} onClick={() => nav(it.to)} />;
  if (it.t === 'toggle') {
    return (
      <div className="yp-row" onClick={(e) => { if (!e.target.closest('button')) setSetting(it.k, !cur); }}>
        <span className="yp-t"><b>{it.label}</b>{it.desc && <small>{txt(it.desc)}</small>}</span>
        <Toggle on={!!cur} onChange={(v) => setSetting(it.k, v)} label={it.label} />
      </div>
    );
  }
  if (it.t === 'choice') {
    const o = it.options.find((x) => x.v === cur) || it.options[0];
    return (
      <>
        <Row title={it.label} sub={o.label} onClick={() => setOpen(true)} />
        <Modal open={open} onClose={() => setOpen(false)} title={it.label}>
          {it.desc && <p className="muted" style={{ margin: '-4px 0 12px' }}>{it.desc}</p>}
          <div role="radiogroup" aria-label={it.label}>
            {it.options.map((x) => <Radio key={x.v} on={x.v === o.v} label={x.label} desc={x.desc} onClick={() => { setSetting(it.k, x.v); setOpen(false); }} />)}
          </div>
          {it.note && <p className="muted" style={{ marginTop: 6 }}>{it.note}</p>}
        </Modal>
      </>
    );
  }
  if (it.t === 'multi') {
    const sel = Array.isArray(cur) ? cur : [];
    const flip = (v) => setSetting(it.k, sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
    const sum = sel.length ? it.options.filter((x) => sel.includes(x.v)).map((x) => x.label).join(', ') : 'No media';
    return (
      <>
        <Row title={it.label} sub={sum} onClick={() => setOpen(true)} />
        <Modal open={open} onClose={() => setOpen(false)} title={it.label}>
          {it.options.map((x) => (
            <button key={x.v} type="button" role="checkbox" aria-checked={sel.includes(x.v)} className="yp-chk" onClick={() => flip(x.v)}>
              <span className={`box ${sel.includes(x.v) ? 'on' : ''}`}>{sel.includes(x.v) && <Check size={16} strokeWidth={3} />}</span>{x.label}
            </button>
          ))}
          <Button style={{ marginTop: 12 }} onClick={() => setOpen(false)}>OK</Button>
        </Modal>
      </>
    );
  }
  if (it.t === 'action') {
    const run = () => (it.danger ? setAsk(true) : actions[it.id]?.());
    return (
      <>
        <Row title={it.label} sub={txt(it.desc)} danger={it.danger} onClick={run} />
        <Confirm open={ask} danger title={it.label} text={txt(it.desc) || 'Are you sure?'} cta="Continue" onCancel={() => setAsk(false)} onOk={() => { setAsk(false); actions[it.id]?.(); }} />
      </>
    );
  }
  return null;
}

/* ---------- custom pages ---------- */
function StorageUsage() {
  const [est, setEst] = useState(null);
  useEffect(() => { navigator.storage?.estimate?.().then(setEst).catch(() => {}); }, []);
  const ls = useMemo(() => { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch { /* private mode */ } return n; }, []);
  const res = performance.getEntriesByType?.('resource') || [];
  const rx = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
  const cache = Math.max(0, (est?.usage || 0) - ls);
  const total = ls + cache || 1;
  return (
    <div className="yp-card">
      <div className="yp-big"><b>{fmtBytes(ls + cache)}</b><span>used by Send ME/U on this device{est?.quota ? ` · ${fmtBytes(est.quota)} available` : ''}</span></div>
      <div className="yp-bar" role="img" aria-label="Storage breakdown"><i style={{ width: `${(ls / total) * 100}%`, background: '#2f6bff' }} /><i style={{ width: `${(cache / total) * 100}%`, background: '#19c3a5' }} /></div>
      <div className="yp-legend"><span><i style={{ background: '#2f6bff' }} />App data · {fmtBytes(ls)}</span><span><i style={{ background: '#19c3a5' }} />Cache & files · {fmtBytes(cache)}</span></div>
      <div className="yp-stats">
        <div><b>{fmtBytes(rx)}</b><span>Received this session</span></div>
        <div><b>{res.length}</b><span>Requests this session</span></div>
      </div>
    </div>
  );
}

function FaqPage() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const list = FAQS.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Shell title="Help Center">
      <TextField icon={Search} placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map(([a, b]) => (
        <details key={a} className="yp-faq"><summary>{a}</summary><p>{b}</p></details>
      ))}
      {!list.length && <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No answers match “{q}”.</p>}
      <Button variant="outline" style={{ marginTop: 12 }} onClick={() => nav('/you/contact')}>Still need help? Contact us</Button>
    </Shell>
  );
}

function ContactPage() {
  const user = useAuth((s) => s.user);
  const notify = useUI((s) => s.notify);
  const [topic, setTopic] = useState('Question');
  const [msg, setMsg] = useState('');
  const send = () => {
    if (msg.trim().length < 5) return notify('Tell us a little more');
    const body = `${msg.trim()}\n\n—\n${user?.name || ''} (${user?.handle || ''})\nSend ME/U ${APP_VERSION}\n${navigator.userAgent}`;
    window.location.href = `mailto:support@sendmeu.app?subject=${encodeURIComponent(`[${topic}] Send ME/U`)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <Shell title="Contact us">
      <p className="yp-note" style={{ marginTop: 0 }}>Describe your question. This opens your email app with your message ready to send.</p>
      <div className="yp-chips" role="radiogroup" aria-label="Topic">
        {['Question', 'Problem', 'Feedback', 'Account'].map((t) => <button key={t} role="radio" aria-checked={topic === t} className={`yp-chip ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>{t}</button>)}
      </div>
      <div className="field"><label className="input textarea-box"><textarea rows={6} maxLength={800} placeholder="Tell us what's going on" value={msg} onChange={(e) => setMsg(e.target.value)} /></label></div>
      <Button onClick={send}><Mail size={18} /> Send</Button>
    </Shell>
  );
}

function TermsPage() {
  return (
    <Shell title="Terms and Privacy Policy">
      <Section>
        <Row icon={ExternalLink} title="Terms of Service" sub="sendmeu.app/terms" onClick={() => window.open('https://sendmeu.app/terms', '_blank', 'noopener')} />
        <Row icon={ExternalLink} title="Privacy Policy" sub="sendmeu.app/privacy" onClick={() => window.open('https://sendmeu.app/privacy', '_blank', 'noopener')} />
      </Section>
    </Shell>
  );
}

function ChangeNumber() {
  const { user, setUser } = useAuth();
  const notify = useUI((s) => s.notify);
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!/^\+?[0-9 ]{8,16}$/.test(phone.trim())) return setErr('Enter a valid number, e.g. +91 98765 43210');
    setBusy(true); setErr('');
    try { const u = await api.updateMe({ phone: phone.trim() }); setUser({ ...user, ...u }); notify('Number changed'); nav(-1); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Change number">
      <p className="yp-note" style={{ marginTop: 0 }}>Your chats, groups and settings move to the new number. Current number: <b>{user?.phone || 'not set'}</b></p>
      {err && <div className="error-box" role="alert">{err}</div>}
      <TextField placeholder="New phone number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Button loading={busy} onClick={save}>Save number</Button>
    </Shell>
  );
}

function DeleteAccount() {
  const { logout } = useAuth();
  const notify = useUI((s) => s.notify);
  const nav = useNavigate();
  const [word, setWord] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await api.deleteMe(); logout(); notify('Your account was deleted'); nav('/signup', { replace: true }); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Shell title="Delete account">
      <div className="yp-warn"><AlertTriangle size={22} /><b>Deleting your account will:</b></div>
      <ul className="yp-list">
        <li>Delete your account info, profile photo and username</li>
        <li>Remove you from all groups, communities and couple space</li>
        <li>Delete your message history, memories and streaks</li>
      </ul>
      <p className="yp-note">This can't be undone. Want a copy first? <button className="link-blue" style={{ display: 'inline' }} onClick={() => nav('/you/account')}>Request account info</button></p>
      {err && <div className="error-box" role="alert">{err}</div>}
      <TextField placeholder="Type DELETE to confirm" value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" />
      <Button variant="danger" loading={busy} disabled={word.trim().toUpperCase() !== 'DELETE'} onClick={go}>Delete my account</Button>
    </Shell>
  );
}

function BlockedPage() {
  const { prefs, setPref } = useChatPrefs();
  const notify = useUI((s) => s.notify);
  const r = useAsync(() => api.conversations({}), []);
  const blocked = (r.data || []).filter((c) => prefs[c.id]?.blocked);
  return (
    <Shell title="Blocked contacts">
      {r.loading && !r.data ? <ListSkeleton n={3} /> : !blocked.length
        ? <Empty icon={Ban} title="No blocked contacts" text="People you block can't message or call you. Block someone from their chat menu." />
        : blocked.map((c) => (
          <div key={c.id} className="yp-row"><Avatar src={c.avatar} size={46} /><span className="yp-t"><b>{c.name}</b><small>{c.handle || 'Blocked'}</small></span>
            <button className="yp-pill" onClick={() => { setPref(c.id, { blocked: false }); notify(`${c.name} unblocked`); }}>Unblock</button></div>
        ))}
    </Shell>
  );
}

const LIST_EMOJI = ['⭐', '🎉', '🏠', '💼', '❤️', '🎓', '🎮', '✈️'];
const SUGGEST = [['Favourites', '⭐'], ['Friends', '🎉'], ['Family', '🏠'], ['Work', '💼']];
function ListsPage() {
  const { lists, addList, updateList, deleteList } = useProfile();
  const notify = useUI((s) => s.notify);
  const r = useAsync(() => api.conversations({}), []);
  const people = (r.data || []).filter(isDirect);
  const [ed, setEd] = useState(null);
  const byId = (id) => people.find((p) => p.id === id);
  const save = () => {
    const name = ed.name.trim(); if (!name) return notify('Give your list a name');
    ed.id ? updateList(ed.id, { name, emoji: ed.emoji, members: ed.members }) : addList({ name, emoji: ed.emoji, members: ed.members });
    setEd(null); notify('List saved');
  };
  return (
    <Shell title="Lists" right={<button className="icon-btn" aria-label="New list" onClick={() => setEd({ name: '', emoji: '⭐', members: [] })}><Plus size={24} /></button>}>
      <p className="yp-note" style={{ marginTop: 0 }}>Organise people into lists so you can find them fast and send broadcasts.</p>
      {!lists.length && (
        <>
          <Empty icon={Sparkles} title="No lists yet" text="Start with one of these, or tap + to make your own." />
          <div className="yp-chips" style={{ justifyContent: 'center' }}>{SUGGEST.map(([n, e]) => <button key={n} className="yp-chip" onClick={() => setEd({ name: n, emoji: e, members: [] })}>{e} {n}</button>)}</div>
        </>
      )}
      {lists.map((l) => (
        <Row key={l.id} title={`${l.emoji} ${l.name}`} sub={l.members.length ? l.members.map((m) => byId(m)?.name).filter(Boolean).join(', ') || `${l.members.length} people` : 'No one yet'}
          right={<Pencil size={18} className="yp-faint" />} onClick={() => setEd({ ...l })} />
      ))}
      <Modal open={!!ed} onClose={() => setEd(null)} title={ed?.id ? 'Edit list' : 'New list'}>
        {ed && (
          <>
            <TextField placeholder="List name" value={ed.name} maxLength={24} onChange={(e) => setEd({ ...ed, name: e.target.value })} />
            <div className="yp-chips" style={{ marginBottom: 8 }}>{LIST_EMOJI.map((e) => <button key={e} aria-label={`Icon ${e}`} className={`yp-chip sq ${ed.emoji === e ? 'on' : ''}`} onClick={() => setEd({ ...ed, emoji: e })}>{e}</button>)}</div>
            <h3 className="yp-h" style={{ margin: '8px 2px' }}>People</h3>
            {people.map((p) => {
              const on = ed.members.includes(p.id);
              return (
                <button key={p.id} type="button" role="checkbox" aria-checked={on} className="yp-chk" onClick={() => setEd({ ...ed, members: on ? ed.members.filter((x) => x !== p.id) : [...ed.members, p.id] })}>
                  <span className={`box ${on ? 'on' : ''}`}>{on && <Check size={16} strokeWidth={3} />}</span><Avatar src={p.avatar} size={36} />{p.name}
                </button>
              );
            })}
            <div style={{ display: 'grid', gridTemplateColumns: ed.id ? '1fr 2fr' : '1fr', gap: 10, marginTop: 12 }}>
              {ed.id && <Button variant="outline" onClick={() => { deleteList(ed.id); setEd(null); notify('List deleted'); }}><Trash2 size={18} /> Delete</Button>}
              <Button onClick={save}>Save list</Button>
            </div>
          </>
        )}
      </Modal>
    </Shell>
  );
}

function AppearancePage() {
  const { theme, setTheme } = useUI();
  const [mode, setMode] = useState(() => (localStorage.getItem('smu_theme') ? theme : 'system'));
  const pick = (m) => {
    setMode(m);
    if (m === 'system') {
      localStorage.removeItem('smu_theme');
      const t = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyTheme(t); useUI.setState({ theme: t });
    } else setTheme(m);
  };
  const nav = useNavigate();
  return (
    <Shell title="Appearance">
      <h3 className="yp-h">Theme</h3>
      <div className="ap-tiles" role="radiogroup" aria-label="Theme">
        {[['light', 'Light'], ['dark', 'Dark'], ['system', 'System default']].map(([m, l]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={`ap-tile ${mode === m ? 'on' : ''}`} onClick={() => pick(m)}>
            <span className={`ap-prev ${m}`}><i /><i /><i /></span>
            <b>{l}</b><span className="ap-dot">{mode === m && <Check size={14} strokeWidth={3} />}</span>
          </button>
        ))}
      </div>
      <p className="yp-note">System default follows your phone's light and dark setting automatically.</p>
      <Section>
        <Row icon={Palette} title="Accessibility" sub="Increase contrast, bold text, reduce animation" onClick={() => nav('/you/accessibility')} />
        <Row icon={ImageIcon} title="Chat settings" sub="Enter is send, media visibility" onClick={() => nav('/you/chats')} />
      </Section>
    </Shell>
  );
}

const PLANS = [{ id: 'monthly', name: 'Monthly', price: '₹99', per: '/ month' }, { id: 'yearly', name: 'Yearly', price: '₹799', per: '/ year', tag: 'Save 33%' }];
const PERKS = [[Crown, 'Plus badge', 'Show a badge next to your name'], [Flame, 'Streak freeze', 'Protect a streak once a month'], [ImageIcon, 'Original-quality memories', 'No compression on uploads'], [Palette, 'Extra themes', 'More looks for chats and the app'], [Lock, 'More locked chats', 'Keep more chats in Private Space']];
function SubscriptionsPage() {
  const { plan, setPlan } = useProfile();
  const notify = useUI((s) => s.notify);
  const [sel, setSel] = useState('yearly');
  const start = () => { const now = Date.now(); setPlan({ id: sel, since: now, trialEnds: now + 7 * 864e5 }); notify('Send ME/U Plus is on — enjoy your free week'); };
  return (
    <Shell title="Subscriptions">
      <div className="sub-hero"><Crown size={30} /><h2>Send ME/U Plus</h2><p>{plan ? `Active · ${PLANS.find((p) => p.id === plan.id)?.name} plan` : 'Premium benefits for your chats and memories'}</p></div>
      <Section h="What you get">
        {PERKS.map(([I, t, d]) => <Row key={t} icon={I} tone="#6d4cf0" title={t} sub={d} />)}
      </Section>
      {plan ? (
        <>
          <p className="yp-note">Free trial ends {new Date(plan.trialEnds).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
          <Button variant="outline" onClick={() => { setPlan(null); notify('Plan cancelled'); }}>Cancel plan</Button>
        </>
      ) : (
        <>
          <div className="sub-plans" role="radiogroup" aria-label="Plan">
            {PLANS.map((p) => (
              <button key={p.id} role="radio" aria-checked={sel === p.id} className={`sub-plan ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
                {p.tag && <em>{p.tag}</em>}<span>{p.name}</span><b>{p.price}</b><small>{p.per}</small>
              </button>
            ))}
          </div>
          <Button onClick={start}>Try 7 days free</Button>
          <p className="yp-note" style={{ textAlign: 'center' }}>Preview — billing isn't connected yet, so nothing is charged.</p>
        </>
      )}
    </Shell>
  );
}

function PinPad({ title, sub, error, onDone }) {
  const [v, setV] = useState('');
  useEffect(() => { if (v.length === 4) { const t = setTimeout(() => { onDone(v); setV(''); }, 160); return () => clearTimeout(t); } return undefined; }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div className="pin">
      <ShieldCheck size={34} />
      <h2>{title}</h2><p>{sub}</p>
      <div className={`pin-dots ${error ? 'bad' : ''}`} aria-live="polite" aria-label={`${v.length} of 4 digits`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < v.length ? 'on' : ''} />)}</div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="pin-keys">
        {keys.map((k, i) => (k === '' ? <span key={i} /> : (
          <button key={i} type="button" aria-label={k === 'del' ? 'Delete' : k} onClick={() => setV((x) => (k === 'del' ? x.slice(0, -1) : x.length < 4 ? x + k : x))}>{k === 'del' ? <Delete size={22} /> : k}</button>
        )))}
      </div>
    </div>
  );
}

function ParentalPage() {
  const { settings, setSetting } = useUI();
  const notify = useUI((s) => s.notify);
  const on = !!settings.parentalOn && !!settings.parentalPin;
  const [step, setStep] = useState(on ? 'gate' : 'intro'); // intro | create | confirm | gate | panel | change
  const [first, setFirst] = useState(''); const [err, setErr] = useState('');
  const ctx = { settings, setSetting };
  const Items = ({ items }) => items.map((it) => <Item key={it.label} it={it} ctx={ctx} actions={{}} />);
  if (step === 'create' || step === 'change') return <Shell title="Parental controls"><PinPad title="Create a PIN" sub="Choose a 4-digit PIN. You'll need it to change these settings." onDone={(p) => { setFirst(p); setErr(''); setStep('confirm'); }} /></Shell>;
  if (step === 'confirm') return <Shell title="Parental controls"><PinPad title="Confirm your PIN" sub="Enter the same PIN again" error={err} onDone={async (p) => { if (p !== first) { setErr("PINs don't match — try again"); setStep('create'); return; } setSetting('parentalPin', await sha(p)); setSetting('parentalOn', true); notify('Parental controls are on'); setErr(''); setStep('panel'); }} /></Shell>;
  if (step === 'gate') return <Shell title="Parental controls"><PinPad title="Enter your PIN" sub="Parental controls are protected" error={err} onDone={async (p) => { if ((await sha(p)) === settings.parentalPin) { setErr(''); setStep('panel'); } else setErr('Wrong PIN'); }} /></Shell>;
  if (step === 'panel') {
    return (
      <Shell title="Parental controls">
        <Section h="Contacts">
          <Items items={[{ t: 'toggle', k: 'pcUnknown', label: 'Only saved contacts', desc: 'Block messages and calls from people who are not in your contacts', def: true }]} />
        </Section>
        <Section h="Content and time">
          <Items items={[
            { t: 'toggle', k: 'pcSensitive', label: 'Filter sensitive content', desc: 'Blur photos and videos that may be sensitive', def: true },
            { t: 'toggle', k: 'pcPrivate', label: 'Hide Private Space', desc: 'Remove Private Space from the home screen', def: false },
            { t: 'choice', k: 'pcLimit', label: 'Daily screen time', def: 'none', options: [{ v: 'none', label: 'No limit' }, { v: '1h', label: '1 hour' }, { v: '2h', label: '2 hours' }, { v: '3h', label: '3 hours' }] },
          ]} />
        </Section>
        <Section>
          <Row title="Change PIN" sub="Pick a new 4-digit PIN" onClick={() => setStep('change')} />
          <Row danger title="Turn off parental controls" sub="Removes the PIN and these limits" onClick={() => { setSetting('parentalOn', false); setSetting('parentalPin', ''); notify('Parental controls are off'); setStep('intro'); }} />
        </Section>
      </Shell>
    );
  }
  return (
    <Shell title="Parental controls">
      <div className="sub-hero fam"><ShieldCheck size={30} /><h2>Settings for your family</h2><p>Protect a young person's account with a PIN, limit who can reach them and filter sensitive content.</p></div>
      <Section>
        <Row icon={Ban} tone="#6d4cf0" title="Limit contacts" sub="Only saved contacts can reach them" />
        <Row icon={ImageIcon} tone="#6d4cf0" title="Filter sensitive content" sub="Blur photos and videos that may be sensitive" />
        <Row icon={Lock} tone="#6d4cf0" title="PIN protected" sub="Settings can't be changed without your PIN" />
      </Section>
      <Button onClick={() => setStep('create')}>Set up parental controls</Button>
    </Shell>
  );
}

function LanguagePage() {
  const { settings, setSetting } = useUI();
  const notify = useUI((s) => s.notify);
  const cur = settings.lang || 'en';
  return (
    <Shell title="App language">
      <div role="radiogroup" aria-label="App language">
        {LANGUAGES.map(([c, n, d]) => <Radio key={c} on={cur === c} label={n} desc={c === 'en' ? "Device's language" : d} onClick={() => { setSetting('lang', c); notify(`Language: ${langLabel(c)}`); }} />)}
      </div>
    </Shell>
  );
}

function InvitePage() {
  const user = useAuth((s) => s.user);
  const notify = useUI((s) => s.notify);
  const link = INVITE(user?.handle);
  const text = `Join me on Send ME/U — chat, share and be real. ${link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); notify('Link copied'); } catch { notify(link); } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: 'Send ME/U', text, url: link }); } catch { /* cancelled */ } } else copy(); };
  const open = (u) => window.open(u, '_blank', 'noopener');
  return (
    <Shell title="Invite a friend">
      <div className="sub-hero inv"><Sparkles size={28} /><h2>Better together</h2><p>Friends who join with your link are added to your contacts automatically.</p></div>
      <div className="inv-link"><span>{link}</span><button aria-label="Copy link" onClick={copy}><Copy size={20} /></button></div>
      <Button onClick={share}><Share2 size={18} /> Share invite link</Button>
      <h3 className="yp-h" style={{ marginTop: 18 }}>Send it with</h3>
      <Section>
        <Row icon={MessageCircle} tone="#22c55e" title="WhatsApp" onClick={() => open(`https://wa.me/?text=${encodeURIComponent(text)}`)} />
        <Row icon={MessageSquare} tone="#2f6bff" title="Messages (SMS)" onClick={() => { window.location.href = `sms:?&body=${encodeURIComponent(text)}`; }} />
        <Row icon={Mail} tone="#ff8a00" title="Email" onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent('Join me on Send ME/U')}&body=${encodeURIComponent(text)}`; }} />
      </Section>
    </Shell>
  );
}

function UpdatesPage() {
  const { settings, setSetting } = useUI();
  const [state, setState] = useState('idle'); // idle | checking | latest | available
  const [at, setAt] = useState(null);
  const regRef = useRef(null);
  const check = async () => {
    setState('checking');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      regRef.current = reg;
      await reg?.update();
      setState(reg?.waiting || reg?.installing ? 'available' : 'latest');
    } catch { setState('latest'); }
    setAt(new Date());
  };
  const apply = () => { regRef.current?.waiting?.postMessage({ type: 'SKIP_WAITING' }); window.location.reload(); };
  return (
    <Shell title="App updates">
      <div className="yp-card center">
        <div className={`upd-ic ${state}`}>{state === 'checking' ? <RefreshCw size={30} /> : state === 'available' ? <Smartphone size={30} /> : <Check size={30} strokeWidth={3} />}</div>
        <h2>{state === 'available' ? 'A new version is ready' : state === 'checking' ? 'Checking…' : "You're up to date"}</h2>
        <p className="muted">Send ME/U {APP_VERSION}{at ? ` · checked ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      </div>
      {state === 'available' ? <Button onClick={apply}>Update now</Button> : <Button variant="outline" loading={state === 'checking'} onClick={check}>Check for updates</Button>}
      <Section>
        <div className="yp-row" onClick={(e) => { if (!e.target.closest('button')) setSetting('autoUpdate', !(settings.autoUpdate ?? true)); }}>
          <span className="yp-t"><b>Update automatically</b><small>Install new versions in the background</small></span>
          <Toggle on={settings.autoUpdate ?? true} onChange={(v) => setSetting('autoUpdate', v)} label="Update automatically" />
        </div>
      </Section>
    </Shell>
  );
}

const CUSTOM = {
  faq: FaqPage, contact: ContactPage, terms: TermsPage, changeNumber: ChangeNumber, deleteAccount: DeleteAccount, blocked: BlockedPage,
  lists: ListsPage, appearance: AppearancePage, subscriptions: SubscriptionsPage, parental: ParentalPage, language: LanguagePage,
  invite: InvitePage, updates: UpdatesPage,
};

/* ---------- the generic page ---------- */
export default function YouPage() {
  const { page } = useParams();
  const def = PAGES[page];
  const { user } = useAuth();
  const { settings, setSetting, theme, notify } = useUI();
  const [, bump] = useState(0);
  if (!def) return <Navigate to="/profile" replace />;
  if (def.custom) { const C = CUSTOM[def.custom]; return <C />; }

  const saved = localStorage.getItem('smu_theme');
  const ctx = { user, settings, setSetting, themeLabel: saved ? (theme === 'dark' ? 'Dark' : 'Light') : 'System default' };
  const actions = {
    exportData: () => { download('sendmeu-account.json', { exportedAt: new Date().toISOString(), profile: { name: user?.name, handle: user?.handle, email: user?.email, phone: user?.phone, about: user?.about, links: user?.links }, settings, lists: useProfile.getState().lists, plan: useProfile.getState().plan }); notify('Account info downloaded'); },
    exportChats: async () => { try { const l = await api.conversations({}); download('sendmeu-chats.json', l.map((c) => ({ name: c.name, type: c.type, last: c.last, time: c.time }))); notify('Chat list downloaded'); } catch (e) { notify(errMsg(e)); } },
    clearStars: () => { useMenu.getState().clearStars(); notify('Starred messages cleared'); },
    askNotif: async () => {
      if (typeof Notification === 'undefined') return notify('Notifications are not supported here');
      if (Notification.permission === 'denied') return notify('Blocked — allow them in your browser settings');
      const r = await Notification.requestPermission(); bump((n) => n + 1);
      return notify(r === 'granted' ? 'Notifications allowed' : 'Notifications not allowed');
    },
    resetNotifs: () => { PAGES.notifications.sections.forEach((s) => s.items.forEach((it) => { if (it.k && it.def !== undefined) setSetting(it.k, it.def); })); notify('Notification settings reset'); },
    clearCache: async () => { try { const ks = (await window.caches?.keys?.()) || []; await Promise.all(ks.map((k) => caches.delete(k))); notify(ks.length ? 'Cache cleared' : 'Nothing to clear'); } catch { notify('Could not clear cache'); } },
  };
  return (
    <Shell title={def.title}>
      {def.top === 'storageUsage' && <StorageUsage />}
      {def.sections.map((s, i) => (
        <Section key={i} h={s.h}>{s.items.map((it, j) => <Item key={`${it.label || it.text}-${j}`} it={it} ctx={ctx} actions={actions} />)}</Section>
      ))}
    </Shell>
  );
}
