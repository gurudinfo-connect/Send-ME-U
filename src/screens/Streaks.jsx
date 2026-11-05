import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hourglass, ChevronRight, Bell, BellOff } from 'lucide-react';
import { AppHeader, ListSkeleton, ErrorState, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';
import { useStreaks } from '../streaks/hooks';
import { StreakBadge, BADGES, Celebration, shareMilestoneCard } from '../streaks/components';
import { fmtLeft } from '../services/streakService';

const when = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Streaks() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const st = useStreaks();
  const prefs = useAsync(() => api.streakPrefs(), []);
  const [celebrate, setCelebrate] = useState(null);
  const p = prefs.data || { enabled: true };
  const items = st.items;
  const active = items.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const pending = active.filter((s) => !s.me && !s.doneToday);
  const expired = items.filter((s) => s.status === 'expired' && s.recovery);
  const best = items.reduce((m, s) => Math.max(m, s.longest), 0);
  const medals = items.flatMap((s) => s.milestones.map((m) => ({ ...m, friend: s.friend.name }))).sort((a, b) => b.at - a.at);

  const toggle = async (patch) => {
    prefs.setData((d) => ({ ...d, ...patch }));
    try { await api.setStreakPrefs(patch); } catch (e) { notify(errMsg(e)); prefs.reload(); }
  };
  const recover = async (s) => {
    try { await api.recoverStreak(s.friendshipId); setCelebrate({ event: { count: s.recovery.previousCount, recovered: true }, name: s.friend.name }); st.reload(); }
    catch (e) { notify(errMsg(e)); st.reload(); }
  };
  const Row = ({ s, right }) => (
    <button className="st-item" onClick={() => nav(`/chats/${s.friendshipId}`)} aria-label={`Open chat with ${s.friend.name}`}>
      <img src={s.friend.avatar} alt="" />
      <span className="grow"><b>{s.friend.name}</b><small>{s.status === 'at_risk' ? `${fmtLeft(s.msLeft)}` : s.doneToday ? 'Done for today' : s.them ? `${s.friend.name} has sent today` : 'Nothing yet today'}</small></span>
      {right}
    </button>
  );

  return (
    <div className="screen st-page">
      <AppHeader back title="Streaks" fallback="/home" />
      <div className="scroll">
        {st.loading && <ListSkeleton n={3} />}
        {st.error && <ErrorState message={st.error} onRetry={st.reload} />}
        {!st.loading && !st.error && (
          <>
            <div className="st-sec">Active streaks</div>
            {active.length === 0 && <div className="st-empty">No streaks yet. Both of you send a message in the same day to start one.</div>}
            {active.map((s) => <Row key={s.friendshipId} s={s} right={<><StreakBadge s={{ ...s, them: true }} size="lg" /><ChevronRight size={18} color="var(--muted)" /></>} />)}

            {pending.length > 0 && <>
              <div className="st-sec">Waiting on you today</div>
              {pending.map((s) => <Row key={s.friendshipId} s={s} right={<span className={`st-pill ${s.status === 'at_risk' ? '' : 'ghost'}`}>{s.status === 'at_risk' && <Hourglass size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}Say hi</span>} />)}
            </>}

            <div className="st-sec">Longest streak{best ? ` · ${best} days` : ''}</div>
            {items.filter((s) => s.longest > 0).sort((a, b) => b.longest - a.longest).map((s) => (
              <div key={s.friendshipId} className="st-set"><span className="grow"><b>{s.friend.name}</b><small>Best run {s.longest} days{s.nextMilestone && s.count > 0 ? ` · next badge at ${s.nextMilestone}` : ''}</small></span><span className="st-badge sm"><span className="fire">🔥</span><b>{s.longest}</b></span></div>
            ))}

            <div className="st-sec">Milestone badges</div>
            {medals.length === 0 ? <div className="st-empty">Badges appear at 3, 7, 14, 30, 50, 100 and 365 days.</div> : (
              <div className="st-medals">{medals.map((m) => <button key={`${m.streakId}${m.days}${m.friend}`} className="st-medal" onClick={() => setCelebrate({ event: { count: m.days, milestone: true }, name: m.friend })} aria-label={`${BADGES[m.days][0]} badge with ${m.friend}, ${m.days} days`}>{BADGES[m.days][1]} {m.days} · {m.friend}</button>)}</div>
            )}

            {expired.length > 0 && <>
              <div className="st-sec">Recently ended</div>
              {expired.map((s) => (
                <div key={s.friendshipId} className="st-item" style={{ cursor: 'default' }}>
                  <img src={s.friend.avatar} alt="" />
                  <span className="grow"><b>{s.friend.name}</b><small>Was {s.recovery.previousCount} days, ended {when(s.recovery.expiredAt)}. Recover until {when(s.recovery.eligibleUntil)}. Free, once.</small></span>
                  <button className="st-pill" onClick={() => recover(s)}>Recover</button>
                </div>
              ))}
            </>}

            <div className="st-sec">Reminders</div>
            <button className="st-set" role="switch" aria-checked={!!p.enabled} onClick={() => toggle({ enabled: !p.enabled })}>
              {p.enabled ? <Bell size={20} /> : <BellOff size={20} />}
              <span className="grow"><b>Streak reminders</b><small>One gentle nudge a day, only when a streak is close to ending. Separate from message notifications.</small></span>
              <span className={`toggle ${p.enabled ? 'on' : ''}`} aria-hidden />
            </button>
            {p.enabled && (
              <button className="st-set" role="switch" aria-checked={p.push !== false} onClick={() => toggle({ push: p.push === false })}>
                <span className="grow"><b>Push notifications</b><small>In-app reminders stay on while reminders are enabled.</small></span>
                <span className={`toggle ${p.push !== false ? 'on' : ''}`} aria-hidden />
              </button>
            )}
            <p className="muted" style={{ margin: '10px 4px' }}>Streaks are just for fun. You can message anyone normally without worrying about them.</p>
          </>
        )}
      </div>
      {celebrate && <Celebration event={celebrate.event} friendName={celebrate.name} onClose={() => setCelebrate(null)} onShare={() => shareMilestoneCard({ days: celebrate.event.count, friendName: celebrate.name }).then((r) => r === 'saved' && notify('Card saved'))} />}
    </div>
  );
}
