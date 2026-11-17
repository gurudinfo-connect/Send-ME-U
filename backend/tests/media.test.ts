import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, base, boot, makeUser, png, shutdown } from './helpers';

before(boot); after(shutdown);

describe('media', () => {
  it('serves uploads through signed, expiring links and rejects tampering', async () => {
    const a = await makeUser('ma'); const b = await makeUser('mb');
    const cid = (await api('POST', '/conversations/direct', a.token, { userId: b.id })).body.id;
    const fd = new FormData(); fd.append('file', new Blob([png()], { type: 'image/png' }), 'x.png');
    const up = await api('POST', `/conversations/${cid}/media`, a.token, fd); assert.ok(up.status < 300, JSON.stringify(up.body).slice(0, 200));
    const url: string = up.body.attachments?.[0]?.url ?? up.body.attachment?.url ?? JSON.stringify(up.body).match(/https?:\/\/[^"]+\/media\/[^"]+/)?.[0];
    assert.ok(url, 'message carries a media URL');
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const ok = await fetch(base + path); assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/webp');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(base + path.replace(/sig=.{4}/, 'sig=0000'))).status, 403, 'tampered signature');
    assert.equal((await fetch(base + path.replace(/exp=\d+/, 'exp=1'))).status, 403, 'expired');
    assert.ok([403, 404].includes((await fetch(`${base}/media/%2e%2e/.env?exp=9999999999&sig=x`)).status), 'no traversal');
  });
});
describe('platform', () => {
  it('health, readiness, CORS, unknown routes and the /api alias', async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth/username-available?username=zzzqqq1`)).status, 200);
    const nf = await api('GET', '/nope/nothing', null); assert.ok([401, 404].includes(nf.status));
    const e = await api('POST', '/auth/login', null, { identifier: '' }); assert.equal(e.status, 400); assert.ok(e.body.error.code && e.body.message);
  });
});
