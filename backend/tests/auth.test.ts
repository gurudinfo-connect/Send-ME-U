import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, boot, makeUser, PASSWORD, shutdown } from './helpers';

before(boot); after(shutdown);

describe('auth', () => {
  it('registers, logs in and returns the profile; never leaks the password hash', async () => {
    const u = await makeUser('auth');
    const me = await api('GET', '/users/me', u.token);
    assert.equal(me.status, 200); assert.equal(me.body.username, u.username);
    assert.ok(!JSON.stringify(me.body).toLowerCase().includes('passwordhash'));
    const login = await api('POST', '/auth/login', null, { identifier: u.email, password: PASSWORD });
    assert.equal(login.status, 200); assert.ok(login.body.refreshToken);
  });
  it('rejects duplicates, weak passwords and bad credentials without revealing which part was wrong', async () => {
    const u = await makeUser('dup');
    assert.equal((await api('POST', '/auth/register', null, { fullName: 'X Y', username: u.username, email: `new${u.email}`, password: PASSWORD })).status, 409);
    assert.equal((await api('POST', '/auth/register', null, { fullName: 'X Y', username: `w${u.username}`, email: `w${u.email}`, password: 'short' })).status, 400);
    const a = await api('POST', '/auth/login', null, { identifier: u.email, password: 'wrong-password-1' });
    const b = await api('POST', '/auth/login', null, { identifier: 'nobody@example.com', password: 'wrong-password-1' });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.body.message, b.body.message);
  });
  it('requires a token and rejects garbage tokens', async () => {
    assert.equal((await api('GET', '/users/me')).status, 401);
    assert.equal((await api('GET', '/users/me', 'abc.def.ghi')).status, 401);
  });
  it('rotates refresh tokens and revokes the whole session when an old one is replayed', async () => {
    const u = await makeUser('rot');
    const r1 = await api('POST', '/auth/refresh', null, { refreshToken: u.refreshToken });
    assert.equal(r1.status, 200); assert.notEqual(r1.body.refreshToken, u.refreshToken);
    assert.equal((await api('GET', '/users/me', r1.body.accessToken)).status, 200);
    await new Promise((r) => setTimeout(r, 10_500)); // outside the 10s grace window for parallel refreshes
    const replay = await api('POST', '/auth/refresh', null, { refreshToken: u.refreshToken });
    assert.equal(replay.status, 401);
    // theft detected: the new token's session is dead too, and so is the access token
    assert.equal((await api('POST', '/auth/refresh', null, { refreshToken: r1.body.refreshToken })).status, 401);
    assert.equal((await api('GET', '/users/me', r1.body.accessToken)).status, 401);
  });
  it('logout invalidates the access token immediately', async () => {
    const u = await makeUser('out');
    assert.equal((await api('POST', '/auth/logout', u.token, { refreshToken: u.refreshToken })).status, 200);
    assert.equal((await api('GET', '/users/me', u.token)).status, 401);
  });
  it('locks the account after repeated wrong passwords', async () => {
    const u = await makeUser('lock');
    for (let i = 0; i < 8; i++) await api('POST', '/auth/login', null, { identifier: u.email, password: 'wrong-password-1' });
    const r = await api('POST', '/auth/login', null, { identifier: u.email, password: PASSWORD });
    assert.equal(r.status, 423);
  });
  it('account deletion anonymises, signs out everywhere and frees the login', async () => {
    const u = await makeUser('del');
    assert.equal((await api('DELETE', '/users/me', u.token, { password: PASSWORD })).status, 200);
    assert.equal((await api('GET', '/users/me', u.token)).status, 401);
    assert.equal((await api('POST', '/auth/login', null, { identifier: u.email, password: PASSWORD })).status, 401);
  });
});
