import { useEffect, useState } from 'react';
import { Hourglass, Check, Share2, X, MessageCircle, Camera } from 'lucide-react';
import { fmtLeft } from '../services/streakService';

export const BADGES = {
  3: ['Spark', '✨'], 7: ['Flame', '🔥'], 14: ['Bonfire', '🪵'], 30: ['Blaze', '☄️'], 50: ['Inferno', '🌋'], 100: ['Legend', '👑'], 365: ['Eternal', '💫'],
};

// Fire + count shown beside friends with an active streak. Hourglass = at risk; small dot = friend hasn't contributed yet today.
export function StreakBadge({ s, size = 'sm' }) {
  if (!s || s.blocked || s.count < 1) return null;
  const risk = s.status === 'at_risk';
  const waiting = !s.doneToday && !s.them;
  const label = `${s.count} day streak${risk ? ', at risk' : ''}${waiting ? `, waiting for ${s.friend.name} today` : ''}`;
  return (
    <span className={`st-badge ${size} ${risk ? 'risk' : ''}`} role="img" aria-label={label}>
      <span className="fire" aria-hidden>🔥</span><b>{s.count}</b>
      {risk && <Hourglass size={size === 'sm' ? 12 : 15} aria-hidden />}
      {waiting && !risk && <i className="wait" aria-hidden />}
    </span>
  );
}

const Who = ({ name, done }) => (
  <span className={`st-who ${done ? 'done' : ''}`} aria-label={`${name}: ${done ? 'done for today' : 'not yet today'}`}>
    <span className="tick">{done ? <Check size={12} strokeWidth={3} /> : null}</span>{name}
  </span>
);

// Compact status under the chat header
export function StreakBar({ s, onMessage, onPhoto }) {
  if (!s || s.blocked) return null;
  const active = s.count > 0;
  if (!active && s.status !== 'expired') return null; // nothing to show until a streak exists (no pressure)
  const risk = s.status === 'at_risk';
  return (
    <section className={`st-bar ${risk ? 'risk' : ''}`} aria-label="Streak status">
      <div className="st-top">
        <span className="st-flame" aria-hidden>{risk ? '⏳' : '🔥'}</span>
        <div className="st-info">
          <b>{active ? `${s.count}-day streak` : 'Streak paused'}</b>
          <small>{risk && s.msLeft != null ? `${fmtLeft(s.msLeft)}. ${s.message}` : s.message}</small>
        </div>
        <div className="st-who-row"><Who name="You" done={s.me || s.doneToday} /><Who name={s.friend.name} done={s.them || s.doneToday} /></div>
      </div>
      {active && !s.doneToday && (
        <div className="st-actions">
          {!s.me && <button onClick={onMessage}><MessageCircle size={15} />Send a message</button>}
          {!s.me && <button onClick={onPhoto}><Camera size={15} />Send a photo</button>}
          {s.me && !s.them && <small>Waiting for {s.friend.name} today. No rush.</small>}
        </div>
      )}
    </section>
  );
}

// Shareable milestone card, drawn locally (nothing is uploaded)
export async function shareMilestoneCard({ days, friendName }) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, '#ff8a3d'); g.addColorStop(1, '#ff3d6e'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.textAlign = 'center'; x.fillStyle = '#fff';
  x.font = '300px serif'; x.fillText('🔥', 540, 470);
  x.font = '800 260px Poppins, system-ui, sans-serif'; x.fillText(String(days), 540, 780);
  x.font = '600 64px Poppins, system-ui, sans-serif'; x.fillText(`days with ${friendName}`, 540, 880);
  const [b, e] = BADGES[days] || ['Streak', '🔥'];
  x.font = '700 56px Poppins, system-ui, sans-serif'; x.fillText(`${e} ${b} badge`, 540, 1010);
  x.font = '500 40px Poppins, system-ui, sans-serif'; x.globalAlpha = .85; x.fillText('Send ME U', 540, 1250);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], `streak-${days}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: `${days}-day streak` }); return 'shared'; } catch { return 'cancelled'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return 'saved';
}

const CONFETTI = ['🔥', '✨', '💛', '🧡', '🎉', '⭐'];
// Full-screen celebration for a new streak or a milestone
export function Celebration({ event, friendName, onClose, onShare }) {
  useEffect(() => { const t = setTimeout(onClose, event.milestone ? 9000 : 3200); return () => clearTimeout(t); }, [event, onClose]);
  const [name, emoji] = event.milestone ? BADGES[event.count] || ['Streak', '🔥'] : [null, '🔥'];
  const [pieces] = useState(() => Array.from({ length: 18 }, (_, i) => ({ i, left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.2 + Math.random() * 1.6, e: CONFETTI[i % CONFETTI.length] })));
  return (
    <div className="st-celebrate" role="dialog" aria-modal="true" aria-label="Streak celebration" onClick={onClose}>
      {pieces.map((p) => <span key={p.i} className="st-conf" aria-hidden style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}>{p.e}</span>)}
      <div className="st-card" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn st-x" aria-label="Close" onClick={onClose}><X size={20} /></button>
        <div className="st-bigfire" aria-hidden>{event.recovered ? '🔥' : emoji}</div>
        <h2>{event.recovered ? 'Streak recovered' : event.milestone ? `${event.count} days together` : event.count === 1 ? 'Streak started' : `${event.count}-day streak`}</h2>
        {event.milestone && <p className="st-badge-name"><span>{emoji}</span> {name} badge unlocked</p>}
        <p className="muted">{event.recovered ? `Back on track with ${friendName}.` : event.milestone ? `You and ${friendName} keep showing up for each other.` : `You and ${friendName} both showed up today.`}</p>
        {event.milestone && <button className="btn-sm st-share" onClick={onShare}><Share2 size={15} /> Share milestone card</button>}
      </div>
    </div>
  );
}
