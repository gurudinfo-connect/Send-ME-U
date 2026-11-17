import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Users } from 'lucide-react';
import { Avatar, Button } from '../components/ui';
import { api, errMsg } from '../services/api';
import { subscribeCallEvents } from '../services/socket';
import { useAuth, useUI } from '../store';
import { RoomSession } from '../callEvents/rtc';
import { clearAsyncCache } from '../components/ui';

// A video element that plays a MediaStream. Voice calls keep it (nearly) invisible so remote audio still plays.
function Tile({ stream, info, local, video }) {
  const ref = useRef(null);
  useEffect(() => { const v = ref.current; if (v && v.srcObject !== (stream || null)) { v.srcObject = stream || null; v.play?.().catch(() => {}); } }, [stream]);
  const showVideo = video && stream && !info?.camOff && stream.getVideoTracks().length > 0;
  return (
    <div className={`cr-tile ${showVideo ? 'vid' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={!!local} className={showVideo ? (local ? 'mirror' : '') : 'cr-hidden'} />
      {!showVideo && <Avatar src={info?.avatar} size={84} />}
      <span className="cr-name">{local ? 'You' : info?.name}{info?.muted && <MicOff size={14} />}</span>
    </div>
  );
}

// The actual scheduled-call room. Order: ask the API for permission (event exists, not cancelled, invited, time window, approval),
// then open microphone / camera and connect to everyone else in the room.
export default function CallRoom() {
  const { id } = useParams(); const nav = useNavigate();
  const user = useAuth((s) => s.user); const notify = useUI((s) => s.notify);
  const [phase, setPhase] = useState('checking'); // checking | waiting | live | denied
  const [msg, setMsg] = useState(''); const [event, setEvent] = useState(null);
  const [, bump] = useState(0); const [requests, setRequests] = useState([]); const [secs, setSecs] = useState(0);
  const sess = useRef(null); const logged = useRef(false);

  // 1. permission
  useEffect(() => {
    let live = true, timer = null;
    const attempt = async () => {
      try {
        const r = await api.ceJoin(id);
        if (!live) return;
        setEvent(r.event);
        if (r.status === 'pending') { setPhase('waiting'); return; }
        clearInterval(timer); setPhase('live');
        if (!logged.current) { logged.current = true; api.placeCall({ name: r.event.title, avatar: r.event.event_image || r.event.host.avatar, fav: false, video: r.event.call_type === 'video' }).catch(() => {}); }
      } catch (e) { if (live) { clearInterval(timer); setMsg(errMsg(e)); setPhase('denied'); } }
    };
    attempt();
    timer = setInterval(() => { if (phaseRef.current === 'waiting') attempt(); }, 2500); // waiting for the host: ask again until let in
    const off = subscribeCallEvents((n) => { if (n === 'join:approved') attempt(); });
    return () => { live = false; clearInterval(timer); off(); };
  }, [id]);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  // 2. media + connection
  useEffect(() => {
    if (phase !== 'live' || !event || !user) return undefined;
    const s = new RoomSession({ meetingId: event.meeting_id, me: { id: user.id, name: user.name, avatar: user.avatar }, video: event.call_type === 'video', onChange: () => bump((n) => n + 1) });
    sess.current = s;
    s.start().catch((e) => { setMsg(errMsg(e)); setPhase('denied'); });
    const clock = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => { clearInterval(clock); s.leave(); sess.current = null; api.ceLeave(id).catch(() => {}); clearAsyncCache(); };
  }, [phase === 'live', event?.meeting_id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. the host sees people asking to join
  useEffect(() => {
    if (!event?.me.host) return undefined;
    let live = true;
    const load = () => api.ceParticipants(id).then((p) => live && setRequests(p.requests || [])).catch(() => {});
    load(); const t = setInterval(load, 3000); const off = subscribeCallEvents((n) => n === 'events:changed' && load());
    return () => { live = false; clearInterval(t); off(); };
  }, [id, event?.me.host]);
  const decide = async (uid, ok) => { try { await api.ceDecide(id, uid, ok); setRequests((r) => r.filter((x) => x.user_id !== uid)); } catch (e) { notify(errMsg(e)); } };

  const leave = () => nav(`/calls/events/${id}`, { replace: true });
  const s = sess.current;
  const peers = s?.peerList || [];
  const video = event?.call_type === 'video';
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (phase === 'checking') return <div className="cr cr-center"><div className="cr-spin" /><p>Connecting…</p></div>;
  if (phase === 'denied') return <div className="cr cr-center"><h2>Can't join this call</h2><p>{msg}</p><Button onClick={leave}>Back to event</Button></div>;
  if (phase === 'waiting') return (
    <div className="cr cr-center"><Avatar src={event?.host.avatar} size={96} /><h2>{event?.title}</h2><p>Waiting for {event?.host.name.split(/[ _]/)[0]} to let you in…</p><div className="cr-spin" /><Button variant="outline" onClick={leave}>Cancel</Button></div>
  );
  return (
    <div className="cr">
      <header className="cr-top"><div><b>{event?.title}</b><small>{clock}</small></div><span className="cr-count"><Users size={16} /> {peers.length + 1}</span></header>
      {s?.mediaError && <p className="cr-warn" role="alert">{s.mediaError}</p>}
      {requests.map((r) => (
        <div key={r.user_id} className="cr-req"><Avatar src={r.avatar} size={36} /><span className="grow">{r.name} wants to join</span><button onClick={() => decide(r.user_id, false)}>Reject</button><button className="go" onClick={() => decide(r.user_id, true)}>Approve</button></div>
      ))}
      <div className={`cr-grid n${Math.min(peers.length + 1, 4)}`}>
        {peers.map((p) => <Tile key={p.id} stream={p.stream} info={p.info} video={video} />)}
        <Tile stream={s?.local} info={s?.info} local video={video} />
      </div>
      {peers.length === 0 && <p className="cr-wait">Waiting for others to join. Share the event link to invite them.</p>}
      <div className="cr-bar">
        <button className={`cr-btn ${s?.muted ? 'off' : ''}`} aria-label={s?.muted ? 'Unmute' : 'Mute'} onClick={() => s?.setMuted(!s.muted)}>{s?.muted ? <MicOff size={24} /> : <Mic size={24} />}</button>
        {video && <button className={`cr-btn ${s?.camOff ? 'off' : ''}`} aria-label={s?.camOff ? 'Turn camera on' : 'Turn camera off'} onClick={() => s?.setCamOff(!s.camOff)}>{s?.camOff ? <VideoOff size={24} /> : <Video size={24} />}</button>}
        <button className="cr-btn end" aria-label="Leave call" onClick={leave}><PhoneOff size={26} /></button>
      </div>
    </div>
  );
}
