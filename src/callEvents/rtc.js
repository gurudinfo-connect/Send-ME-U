// Real browser-to-browser calling for scheduled calls: WebRTC mesh (everyone connects to everyone), so it fits small groups.
// Signalling (who is in the room, offers / answers / ICE candidates) goes through a tiny transport:
//   - real server: Socket.IO events room:join / room:signal / room:leave handled in backend/src/callEvents/sockets.js
//   - demo mode:   BroadcastChannel, so two browser tabs / windows on the same device genuinely call each other
// Media never touches the server. For users behind strict NATs add a TURN server via VITE_ICE_SERVERS (JSON array of RTCIceServer).
import { USE_MOCK } from '../services/api';
import { connectSocket } from '../services/socket';

const ICE = (() => { try { const v = JSON.parse(import.meta.env.VITE_ICE_SERVERS || 'null'); if (Array.isArray(v)) return v; } catch { /* ignore */ } return [{ urls: 'stun:stun.l.google.com:19302' }]; })();
const cid = () => Math.random().toString(36).slice(2, 10);

function bcTransport(meetingId, onMsg) {
  const ch = new BroadcastChannel(`smu-room-${meetingId}`);
  ch.onmessage = (e) => onMsg(e.data);
  return { send: (m) => ch.postMessage(m), close: () => ch.close(), join: async () => ({ ok: true }) };
}
function socketTransport(meetingId, onMsg) {
  const s = connectSocket();
  if (!s) throw new Error('No connection to the call server');
  const h = (m) => onMsg(m);
  s.on('room:signal', h);
  return {
    join: () => new Promise((res, rej) => s.timeout(8000).emit('room:join', { meetingId }, (err, ack) => (err ? rej(new Error('The call server did not answer')) : ack?.ok ? res(ack) : rej(new Error(ack?.message || 'You cannot join this call'))))),
    send: (m) => s.emit('room:signal', { meetingId, ...m }),
    close: () => { s.emit('room:leave', { meetingId }); s.off('room:signal', h); },
  };
}

/** One person's connection to a scheduled-call room. */
export class RoomSession {
  /** @param {{meetingId:string, me:{id:string,name:string,avatar:string}, video:boolean, onChange:()=>void}} o */
  constructor(o) {
    this.o = o; this.id = cid(); this.joinedAt = Date.now(); this.peers = new Map(); this.local = null;
    this.muted = false; this.camOff = !o.video; this.mediaError = ''; this.closed = false; this.t = null;
  }
  get info() { return { ...this.o.me, muted: this.muted, camOff: this.camOff }; }
  get peerList() { return [...this.peers.values()].map((p) => ({ id: p.id, info: p.info, stream: p.stream, state: p.pc.connectionState })); }
  changed() { if (!this.closed) this.o.onChange?.(); }

  async start() {
    // 1. microphone / camera. If they are blocked we still join, listen-only, and tell the user why.
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access the microphone');
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.o.video ? { facingMode: 'user' } : false });
    } catch (e) {
      this.mediaError = e?.name === 'NotAllowedError' ? 'Microphone or camera access is blocked. Allow it in your browser settings to be heard.' : e?.name === 'NotFoundError' ? 'No microphone or camera was found. You can still listen.' : (e?.message || 'Could not start the microphone');
      this.muted = true; this.camOff = true;
    }
    if (this.local && this.o.video && !this.local.getVideoTracks().length) this.camOff = true;
    // 2. signalling
    this.t = (USE_MOCK ? bcTransport : socketTransport)(this.o.meetingId, (m) => this.onSignal(m));
    await this.t.join();
    this.t.send({ type: 'hello', from: this.id, joinedAt: this.joinedAt, info: this.info });
    this.changed();
  }

  amInitiatorFor(theirJoinedAt, theirId) { return this.joinedAt < theirJoinedAt || (this.joinedAt === theirJoinedAt && this.id < theirId); }

  makePeer(id, info) {
    let p = this.peers.get(id); if (p) { p.info = info || p.info; return p; }
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { id, info, pc, stream: new MediaStream(), pending: [] };
    this.peers.set(id, p);
    this.local?.getTracks().forEach((tr) => pc.addTrack(tr, this.local));
    pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((tr) => { if (!p.stream.getTracks().includes(tr)) p.stream.addTrack(tr); }); this.changed(); };
    pc.onicecandidate = (e) => e.candidate && this.t.send({ type: 'ice', from: this.id, to: id, candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); else this.changed(); };
    this.changed();
    return p;
  }
  drop(id) { const p = this.peers.get(id); if (!p) return; try { p.pc.close(); } catch { /* ignore */ } this.peers.delete(id); this.changed(); }

  async offerTo(id, info) {
    const p = this.makePeer(id, info);
    const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
    this.t.send({ type: 'offer', from: this.id, to: id, sdp: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
  }

  async onSignal(m) {
    if (this.closed || !m || m.from === this.id || (m.to && m.to !== this.id)) return;
    try {
      if (m.type === 'hello' || m.type === 'here') {
        if (m.type === 'hello') this.t.send({ type: 'here', from: this.id, to: m.from, joinedAt: this.joinedAt, info: this.info });
        const p = this.makePeer(m.from, m.info); p.joinedAt = m.joinedAt;
        if (this.amInitiatorFor(m.joinedAt, m.from) && p.pc.signalingState === 'stable' && !p.pc.remoteDescription) await this.offerTo(m.from, m.info);
      } else if (m.type === 'offer') {
        const p = this.makePeer(m.from, this.peers.get(m.from)?.info);
        await p.pc.setRemoteDescription(m.sdp); await this.flush(p);
        const answer = await p.pc.createAnswer(); await p.pc.setLocalDescription(answer);
        this.t.send({ type: 'answer', from: this.id, to: m.from, sdp: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
      } else if (m.type === 'answer') {
        const p = this.peers.get(m.from); if (p && p.pc.signalingState === 'have-local-offer') { await p.pc.setRemoteDescription(m.sdp); await this.flush(p); }
      } else if (m.type === 'ice') {
        const p = this.peers.get(m.from); if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.candidate); else p.pending.push(m.candidate);
      } else if (m.type === 'state') {
        const p = this.peers.get(m.from); if (p) { p.info = { ...p.info, ...m.info }; this.changed(); }
      } else if (m.type === 'bye') this.drop(m.from);
    } catch (e) { console.warn('[room] signal failed', m.type, e?.message); }
  }
  async flush(p) { for (const c of p.pending.splice(0)) { try { await p.pc.addIceCandidate(c); } catch { /* stale candidate */ } } }

  broadcastState() { this.t?.send({ type: 'state', from: this.id, info: { muted: this.muted, camOff: this.camOff } }); this.changed(); }
  setMuted(v) { if (!this.local?.getAudioTracks().length) return; this.muted = v; this.local.getAudioTracks().forEach((t) => { t.enabled = !v; }); this.broadcastState(); }
  setCamOff(v) { if (!this.local?.getVideoTracks().length) return; this.camOff = v; this.local.getVideoTracks().forEach((t) => { t.enabled = !v; }); this.broadcastState(); }

  leave() {
    if (this.closed) return; this.closed = true;
    try { this.t?.send({ type: 'bye', from: this.id }); this.t?.close(); } catch { /* ignore */ }
    this.peers.forEach((p) => { try { p.pc.close(); } catch { /* ignore */ } }); this.peers.clear();
    this.local?.getTracks().forEach((t) => t.stop()); this.local = null;
  }
}
