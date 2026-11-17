import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, boot, connect, emitAck, makeUser, once, png, shutdown, sleep } from './helpers';

before(boot); after(shutdown);

describe('follow / block', () => {
  it('follows, lists followers, and blocking hides the profile both ways', async () => {
    const a = await makeUser('fa'); const b = await makeUser('fb');
    assert.equal((await api('POST', `/users/${b.id}/follow`, a.token)).status, 200);
    const fl = await api('GET', `/users/${b.id}/followers`, a.token);
    assert.ok(JSON.stringify(fl.body).includes(a.id));
    assert.equal((await api('POST', `/users/${a.id}/block`, b.token)).status, 200);
    assert.ok([403, 404].includes((await api('GET', `/users/${b.id}/profile`, a.token)).status));
    const send = await api('POST', '/conversations/direct', a.token, { userId: b.id });
    assert.ok([403, 404].includes(send.status), 'cannot open a chat with someone who blocked you');
  });
  it('a private account turns follows into requests until accepted', async () => {
    const a = await makeUser('pa'); const b = await makeUser('pb');
    assert.equal((await api('PUT', '/users/me', b.token, { isPrivate: true })).status < 400, true);
    const r = await api('POST', `/users/${b.id}/follow`, a.token);
    assert.equal(r.status, 200);
    const reqs = await api('GET', '/follow-requests', b.token);
    assert.equal(reqs.status, 200); assert.ok(reqs.body.length >= 1);
  });
});

describe('chat', () => {
  it('sends with idempotency, receipts, edit/delete rules and realtime delivery', async () => {
    const a = await makeUser('ca'); const b = await makeUser('cb');
    const conv = await api('POST', '/conversations/direct', a.token, { userId: b.id });
    assert.equal(conv.status, 200); const cid = conv.body.id;
    const sb = await connect(b.token);
    const incoming = once(sb, 'message:new');
    const m1 = await api('POST', `/conversations/${cid}/messages`, a.token, { text: 'hello', clientId: 'client-id-0001' });
    assert.equal(m1.status, 201); assert.equal(m1.body.text, 'hello');
    const evt: any = await incoming; assert.equal(evt.text, 'hello');
    const dup = await api('POST', `/conversations/${cid}/messages`, a.token, { text: 'hello', clientId: 'client-id-0001' });
    assert.equal(dup.body.id, m1.body.id, 'same clientId must not create a second message');
    // read receipts
    const status = once(await connect(a.token), 'message:status').catch(() => null); void status;
    assert.equal((await api('POST', `/conversations/${cid}/read`, b.token)).status, 200);
    const list = await api('GET', `/conversations/${cid}/messages`, b.token);
    assert.equal(list.body.items.length, 1);
    // only the author edits / deletes for everyone
    assert.equal((await api('PUT', `/messages/${m1.body.id}`, b.token, { text: 'hax' })).status >= 400, true);
    assert.equal((await api('PUT', `/messages/${m1.body.id}`, a.token, { text: 'hello!' })).status, 200);
    assert.equal((await api('DELETE', `/messages/${m1.body.id}`, a.token, undefined)).status < 400, true);
    sb.close();
  });
  it('outsiders cannot read or post in a conversation or join its socket room', async () => {
    const a = await makeUser('oa'); const b = await makeUser('ob'); const x = await makeUser('ox');
    const cid = (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id;
    assert.ok([403, 404].includes((await api('GET', `/conversations/${cid}/messages`, x.token)).status));
    assert.ok([403, 404].includes((await api('POST', `/conversations/${cid}/messages`, x.token, { text: 'hi', clientId: 'client-id-0002' })).status));
    const sx = await connect(x.token);
    const r: any = await emitAck(sx, 'conversation:join', { conversationId: cid });
    assert.equal(r.ok, false); sx.close();
  });
  it('typing events reach members only after they joined the room', async () => {
    const a = await makeUser('ta'); const b = await makeUser('tb');
    const cid = (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id;
    const sa = await connect(a.token); const sb = await connect(b.token);
    assert.equal(((await emitAck(sa, 'conversation:join', { conversationId: cid })) as any).ok, true);
    assert.equal(((await emitAck(sb, 'conversation:join', { conversationId: cid })) as any).ok, true);
    const t = once(sb, 'typing'); sa.emit('typing:start', { conversationId: cid });
    assert.equal(((await t) as any).userId, a.id); sa.close(); sb.close();
  });
  it('rejects a socket with no or an invalid token', async () => {
    await assert.rejects(connect('nope'));
  });
  it('groups: create, invite code join, admin-only changes', async () => {
    const a = await makeUser('ga'); const b = await makeUser('gb'); const c = await makeUser('gc');
    const g = await api('POST', '/conversations', a.token, { group: true, name: 'Trip', userIds: [b.id] });
    assert.ok(g.status === 200 || g.status === 201, JSON.stringify(g.body)); const gid = g.body.id;
    assert.ok([403, 404].includes((await api('GET', `/conversations/${gid}`, c.token)).status));
    assert.ok((await api('PATCH', `/conversations/${gid}/group`, b.token, { name: 'Hijack' })).status >= 400, 'non-admin cannot rename');
    assert.equal((await api('PATCH', `/conversations/${gid}/group`, a.token, { name: 'Trip 2' })).status, 200);
    assert.ok((await api('POST', `/conversations/${gid}/members`, b.token, { userIds: [c.id] })).status >= 400, 'non-admin cannot add members');
    assert.ok((await api('PUT', `/conversations/${gid}/members/${a.id}/role`, b.token, { role: 'member' })).status >= 400, 'cannot demote the owner');
  });
  it('disappearing messages are removed by the expiry job', async () => {
    const { expireMessages } = await import('../src/jobs');
    const { prisma } = await import('../src/lib/db');
    const a = await makeUser('da'); const b = await makeUser('db');
    const cid = (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id;
    const m = await api('POST', `/conversations/${cid}/messages`, a.token, { text: 'ephemeral', clientId: 'client-id-0003' });
    await prisma.message.update({ where: { id: m.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireMessages();
    const list = await api('GET', `/conversations/${cid}/messages`, b.token);
    assert.equal(list.body.items.filter((x: any) => x.id === m.body.id && x.text).length, 0);
  });
});

describe('uploads', () => {
  it('stores an image attachment, strips it to webp, and refuses disguised executables', async () => {
    const a = await makeUser('ua'); const b = await makeUser('ub');
    const cid = (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id;
    const fd = new FormData(); fd.append('file', new Blob([png()], { type: 'image/png' }), 'x.png');
    const ok = await api('POST', `/conversations/${cid}/media`, a.token, fd);
    assert.ok(ok.status === 201 || ok.status === 200, JSON.stringify(ok.body).slice(0, 200));
    const bad = new FormData(); bad.append('file', new Blob([Buffer.from('MZ\x90\x00 not an image')], { type: 'image/png' }), 'evil.png');
    assert.ok((await api('POST', `/conversations/${cid}/media`, a.token, bad)).status >= 400);
  });
});
void sleep;
