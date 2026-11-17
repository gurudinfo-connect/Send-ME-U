import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../src/lib/db';
import { api, boot, connect, emitAck, makeUser, once, PASSWORD, shutdown, TUser } from './helpers';

before(boot); after(shutdown);
const direct = async (a: TUser, b: TUser) => (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id as string;

describe('stories', () => {
  it('privacy: followers-only story is invisible to non-followers; viewers are recorded; owner can delete', async () => {
    const owner = await makeUser('so'); const fan = await makeUser('sf'); const stranger = await makeUser('ss');
    await api('POST', `/users/${owner.id}/follow`, fan.token);
    const pub = await api('POST', '/stories', owner.token, { type: 'text', text: 'followers only', bg: 'sunset', privacy: 'followers' });
    assert.equal(pub.status, 201, JSON.stringify(pub.body)); const sid = pub.body.created.id;
    assert.equal((await api('POST', `/stories/${sid}/view`, fan.token)).status < 400, true);
    assert.ok([403, 404].includes((await api('POST', `/stories/${sid}/view`, stranger.token)).status));
    const viewers = await api('GET', `/stories/${sid}/viewers`, owner.token);
    assert.equal(viewers.status, 200); assert.ok(JSON.stringify(viewers.body).includes(fan.id));
    assert.ok((await api('GET', `/stories/${sid}/viewers`, fan.token)).status >= 400, 'only the owner sees viewers');
    assert.ok((await api('DELETE', `/stories/${sid}`, fan.token)).status >= 400);
    assert.equal((await api('DELETE', `/stories/${sid}`, owner.token)).status, 200);
  });
  it('a reply lands in the owner chat; drafts are private to their author', async () => {
    const owner = await makeUser('ro'); const fan = await makeUser('rf');
    const st = await api('POST', '/stories', owner.token, { type: 'text', text: 'hi', privacy: 'everyone' });
    assert.equal((await api('POST', `/stories/${st.body.created.id}/reply`, fan.token, { text: 'nice!' })).status < 400, true);
    const convs = await api('GET', '/conversations', owner.token);
    assert.ok(JSON.stringify(convs.body).includes('nice!') || convs.body.length >= 1);
    const fd = new FormData(); fd.append('payload', JSON.stringify({ type: 'text', text: 'draft', bg: 'sunset' }));
    const d = await api('POST', '/stories/drafts', owner.token, fd); assert.ok(d.status < 300, JSON.stringify(d.body));
    assert.equal(JSON.stringify((await api('GET', '/stories/drafts', fan.token)).body).includes(d.body.id), false);
  });
  it('expired stories are hidden from the feed', async () => {
    const owner = await makeUser('eo'); const fan = await makeUser('ef');
    const st = await api('POST', '/stories', owner.token, { type: 'text', text: 'old', privacy: 'everyone' });
    await prisma.story.update({ where: { id: st.body.created.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000), expiresAt: new Date(Date.now() - 3_600_000) } });
    assert.ok((await api('POST', `/stories/${st.body.created.id}/view`, fan.token)).status >= 400);
  });
});

describe('private space', () => {
  it('locked chats vanish from lists and refuse access until unlocked; wrong PINs lock out', async () => {
    const a = await makeUser('pa'); const b = await makeUser('pb');
    const cid = await direct(a, b);
    await api('POST', `/conversations/${cid}/messages`, b.token, { text: 'secret', clientId: 'client-id-pv01' });
    assert.equal((await api('POST', '/private-space/setup', a.token, { pin: '482915' })).status < 300, true);
    assert.equal((await api('PATCH', `/conversations/${cid}/lock`, a.token, { locked: true })).status, 200);
    assert.equal(JSON.stringify((await api('GET', '/conversations', a.token)).body).includes(cid), false, 'hidden from the list');
    assert.equal((await api('GET', `/conversations/${cid}/messages`, a.token)).status, 423);
    const sock = await connect(a.token);
    assert.equal(((await emitAck(sock, 'conversation:join', { conversationId: cid })) as any).ok, false, 'socket join refused while locked');
    const bad = await api('POST', '/private-space/unlock', a.token, { pin: '000000' }); assert.equal(bad.status, 401);
    const ok = await api('POST', '/private-space/unlock', a.token, { pin: '482915' }); assert.equal(ok.status, 200);
    const t = { 'x-private-token': ok.body.token };
    assert.equal((await api('GET', `/conversations/${cid}/messages`, a.token, undefined, t)).status, 200);
    assert.equal(((await emitAck(sock, 'conversation:join', { conversationId: cid, privateToken: ok.body.token })) as any).ok, true);
    assert.equal((await api('GET', `/conversations/${cid}/messages`, b.token)).status, 200, 'the other person is unaffected');
    assert.equal((await api('POST', '/private-space/unlock', b.token, { pin: '482915' })).status >= 400, true, 'someone else’s PIN setup is separate');
    sock.close();
    for (let i = 0; i < 5; i++) await api('POST', '/private-space/unlock', a.token, { pin: '111111' });
    assert.equal((await api('POST', '/private-space/unlock', a.token, { pin: '482915' })).status, 423, 'locked out after 5 wrong PINs');
  });
  it('a token minted for one user is useless for another', async () => {
    const a = await makeUser('ta'); const x = await makeUser('tx'); const b = await makeUser('tb');
    const cid = await direct(a, b);
    await api('POST', '/private-space/setup', a.token, { pin: '482915' }); await api('PATCH', `/conversations/${cid}/lock`, a.token, { locked: true });
    const tok = (await api('POST', '/private-space/unlock', a.token, { pin: '482915' })).body.token;
    assert.ok([403, 404, 423].includes((await api('GET', `/conversations/${cid}/messages`, x.token, undefined, { 'x-private-token': tok })).status));
  });
});

describe('streaks', () => {
  it('are created by the server from real messages and cannot be forged by the client', async () => {
    const a = await makeUser('ka'); const b = await makeUser('kb');
    const cid = await direct(a, b);
    await api('POST', `/conversations/${cid}/messages`, a.token, { text: 'morning', clientId: 'client-id-st01' });
    await api('POST', `/conversations/${cid}/messages`, b.token, { text: 'morning!', clientId: 'client-id-st02' });
    const list = await api('GET', '/streaks', a.token); assert.equal(list.status, 200);
    const row = list.body.find((s: any) => JSON.stringify(s).includes(b.id) || s.conversationId === cid);
    assert.ok(row, 'streak exists after both people messaged: ' + JSON.stringify(list.body).slice(0, 200));
    assert.equal((await api('POST', `/streaks/${cid}/activity`, a.token, { count: 999 })).status, 403);
  });
});

describe('couple', () => {
  it('invite → accept → shared appointments reject overlaps; notes and private appointments stay private', async () => {
    const a = await makeUser('ca'); const b = await makeUser('cb'); const x = await makeUser('cx');
    const inv = await api('POST', '/couple/invite', a.token, { userId: b.id }); assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.ok((await api('POST', '/couple/accept', x.token, { inviteId: inv.body.id })).status >= 400, 'only the invitee can accept');
    assert.equal((await api('POST', '/couple/accept', b.token, { inviteId: inv.body.id })).status, 200);
    const t0 = Date.now() + 3 * 86_400_000; const iso = (o: number) => new Date(t0 + o * 3_600_000).toISOString();
    const a1 = await api('POST', '/couple/appointments', a.token, { title: 'Dinner', location: 'Cafe', start_time: iso(0), end_time: iso(2), notes: 'my secret plan' });
    assert.equal(a1.status, 201, JSON.stringify(a1.body));
    const clash = await api('POST', '/couple/appointments', b.token, { title: 'Gym', location: 'Gym', start_time: iso(1), end_time: iso(3) });
    assert.ok([409, 422].includes(clash.status), 'overlap refused: ' + clash.status);
    const seen = await api('GET', '/couple/appointments', b.token);
    assert.equal(JSON.stringify(seen.body).includes('my secret plan'), false, 'partner never sees the author’s notes');
    const priv = await api('POST', '/couple/appointments', a.token, { title: 'Surprise gift', visibility: 'private', start_time: iso(10), end_time: iso(11) });
    assert.equal(priv.status, 201, JSON.stringify(priv.body));
    assert.equal(JSON.stringify((await api('GET', '/couple/appointments', b.token)).body).includes('Surprise gift'), false);
    assert.ok([403, 404, 409].includes((await api('GET', '/couple/appointments', x.token)).status) || (await api('GET', '/couple/appointments', x.token)).body.length === 0, 'outsiders see nothing');
  });
  it('live location needs consent, stores only the latest point, and is partner-only', async () => {
    const a = await makeUser('la'); const b = await makeUser('lb');
    const inv = await api('POST', '/couple/invite', a.token, { userId: b.id }); await api('POST', '/couple/accept', b.token, { inviteId: inv.body.id });
    assert.ok((await api('PUT', '/couple/location', a.token, { latitude: 12.9, longitude: 77.6 })).status >= 400, 'no sharing before consent');
    assert.ok((await api('POST', '/couple/location/session', a.token, { duration: '15m' })).status < 300);
    assert.equal((await api('PUT', '/couple/location', a.token, { latitude: 12.9, longitude: 77.6, accuracy: 10 })).status < 300, true);
    assert.equal(await prisma.liveLocation.count({ where: { userId: a.id } }), 1);
    const g = await api('GET', '/couple/location', b.token); assert.equal(g.status, 200);
    assert.equal((await api('DELETE', '/couple/location/session', a.token)).status < 300, true);
    assert.equal(await prisma.liveLocation.count({ where: { userId: a.id } }), 0, 'coordinates deleted when sharing stops');
  });
});

describe('calls', () => {
  it('ring → answer → end over REST and sockets, busy detection, and signalling only inside the call', async () => {
    const a = await makeUser('xa'); const b = await makeUser('xb'); const c = await makeUser('xc'); const x = await makeUser('xx');
    const sb = await connect(b.token); const sa = await connect(a.token); const sx = await connect(x.token);
    const ring = once(sb, 'call:incoming');
    const call = await api('POST', '/calls', a.token, { peerId: b.id, video: true }); assert.equal(call.status, 201, JSON.stringify(call.body));
    assert.equal(((await ring) as any).callId, call.body.id);
    assert.ok(Array.isArray(call.body.ice.iceServers));
    assert.equal((await api('POST', '/calls', c.token, { peerId: b.id })).status, 409, 'callee is busy');
    assert.ok((await api('POST', `/calls/${call.body.id}/answer`, a.token)).status >= 400, 'caller cannot answer their own call');
    const answered = once(sa, 'call:answered');
    assert.equal(((await emitAck(sb, 'call:answer', { callId: call.body.id })) as any).ok, true); await answered;
    const sig = once(sb, 'call:signal');
    assert.equal(((await emitAck(sa, 'call:signal', { callId: call.body.id, type: 'offer', data: { sdp: 'v=0' } })) as any).ok, true);
    assert.equal(((await sig) as any).type, 'offer');
    assert.equal(((await emitAck(sx, 'call:signal', { callId: call.body.id, type: 'offer', data: {} })) as any).ok, false, 'outsiders cannot inject signals');
    const ended = once(sb, 'call:ended');
    const end = await api('POST', `/calls/${call.body.id}/end`, a.token); assert.equal(end.body.status, 'ended'); await ended;
    const log = await api('GET', '/calls', b.token); assert.equal(log.body[0].dir, 'in');
    [sa, sb, sx].forEach((s) => s.close());
  });
  it('unanswered calls become missed; blocked users cannot call', async () => {
    const { expireCalls } = await import('../src/modules/calls');
    const a = await makeUser('ma'); const b = await makeUser('mb');
    const call = await api('POST', '/calls', a.token, { peerId: b.id });
    await prisma.call.update({ where: { id: call.body.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await expireCalls();
    const log = await api('GET', '/calls', b.token); assert.equal(log.body[0].dir, 'missed');
    await api('POST', `/users/${a.id}/block`, b.token);
    assert.ok((await api('POST', '/calls', a.token, { peerId: b.id })).status >= 400);
  });
  it('call events: invite, accept, approval-gated join, and cancellation', async () => {
    const h = await makeUser('eh'); const g = await makeUser('eg'); const o = await makeUser('eo');
    const start = new Date(Date.now() + 3_600_000); const end = new Date(Date.now() + 7_200_000);
    const ev = await api('POST', '/call-events', h.token, { title: 'Team sync', start_datetime: start.toISOString(), end_datetime: end.toISOString(), call_type: 'video', guest_ids: [g.id], require_approval: false, reminder_minutes: 15 });
    assert.equal(ev.status, 201, JSON.stringify(ev.body)); const id = ev.body.data.id;
    assert.ok((await api('GET', `/call-events/${id}`, o.token)).status === 403, 'uninvited users cannot open it by id');
    assert.equal((await api('POST', `/call-events/${id}/respond`, g.token, { status: 'accepted' })).status, 200);
    assert.ok((await api('PUT', `/call-events/${id}`, g.token, { title: 'x' })).status >= 400, 'only the host edits');
    assert.equal((await api('POST', `/call-events/${id}/join`, g.token)).status, 425, 'too early to join');
    assert.equal((await api('DELETE', `/call-events/${id}`, h.token)).body.data.status, 'cancelled');
  });
});

describe('notifications & admin', () => {
  it('follow creates a notification; only the owner can read it', async () => {
    const a = await makeUser('na'); const b = await makeUser('nb');
    await api('POST', `/users/${b.id}/follow`, a.token);
    const n = await api('GET', '/notifications', b.token); assert.equal(n.status, 200);
    assert.ok(JSON.stringify(n.body).length > 5);
    assert.equal(JSON.stringify((await api('GET', '/notifications', a.token)).body).includes('started following'), false);
  });
  it('admin API: role-gated, reports flow to resolution, suspension kills sessions, everything is audited', async () => {
    const admin = await makeUser('ad'); const reporter = await makeUser('rp'); const bad = await makeUser('bd');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const adminLogin = await api('POST', '/auth/login', null, { identifier: admin.email, password: PASSWORD }); const at = adminLogin.body.accessToken;
    assert.equal((await api('GET', '/admin/stats', reporter.token)).status, 403, 'normal users are refused');
    assert.equal((await api('GET', '/admin/stats', null)).status, 401);
    assert.equal((await api('GET', '/admin/stats', at)).status, 200);
    const cid = await direct(reporter, bad);
    const m = await api('POST', `/conversations/${cid}/messages`, bad.token, { text: 'abusive text', clientId: 'client-id-ad01' });
    const rep = await api('POST', '/reports', reporter.token, { targetType: 'message', targetId: m.body.id, reason: 'harassment' }); assert.ok(rep.status < 300, JSON.stringify(rep.body));
    const q = await api('GET', '/admin/reports?status=open', at); assert.ok(q.body.items.length >= 1);
    const detail = await api('GET', `/admin/reports/${q.body.items.find((r: any) => r.targetId === m.body.id).id}`, at);
    assert.equal(detail.body.item.text, 'abusive text', 'reviewer sees only the reported message');
    const done = await api('POST', `/admin/reports/${detail.body.id}/resolve`, at, { action: 'suspend', note: 'abuse', suspendReason: 'harassment' }); assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await api('GET', '/users/me', bad.token)).status, 401, 'suspended user is signed out immediately');
    assert.equal((await api('POST', '/auth/login', null, { identifier: bad.email, password: PASSWORD })).status, 403);
    const logs = await api('GET', '/admin/audit-logs?action=admin.', at);
    assert.ok(logs.body.items.some((l: any) => l.action === 'admin.report.suspend'));
    assert.equal((await api('POST', `/admin/users/${bad.id}/unsuspend`, at)).status, 200);
    assert.equal((await api('POST', `/admin/users/${admin.id}/suspend`, at, { reason: 'oops' })).status, 400, 'cannot suspend yourself');
  });
});
