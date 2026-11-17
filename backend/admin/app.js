// Send Me/U admin dashboard. Static, no build step. Talks to /api/v1/admin on the same origin; the SERVER enforces roles,
// this page only hides what you cannot use. Tokens live in sessionStorage (cleared when the tab closes).
(() => {
  const API = '/api/v1';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private mode */ } } };
  let me = null, tab = 'overview';

  async function raw(method, path, body, retry = true) {
    const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(store.get('at') ? { authorization: 'Bearer ' + store.get('at') } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry && store.get('rt')) {
      const rr = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: store.get('rt') }) });
      if (rr.ok) { const d = await rr.json(); store.set('at', d.accessToken); store.set('rt', d.refreshToken); return raw(method, path, body, false); }
      store.set('at', null); store.set('rt', null); location.reload(); throw new Error('Session expired');
    }
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = { message: t }; }
    if (!r.ok) throw new Error(d?.message || d?.error?.message || 'Request failed (' + r.status + ')');
    return d;
  }
  const get = (p) => raw('GET', p); const post = (p, b) => raw('POST', p, b || {});
  const date = (v) => (v ? new Date(v).toLocaleString() : '—');
  const fmt = (n) => Number(n || 0).toLocaleString();

  function login(err = '') {
    $('#app').innerHTML = `<form class="login" id="f"><h1>Send Me/U Admin</h1><label>Email or username<br><input name="id" autocomplete="username" required style="width:100%"></label>
      <label>Password<br><input name="pw" type="password" autocomplete="current-password" required style="width:100%"></label><button class="b">Sign in</button><div class="err">${esc(err)}</div></form>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try {
        const d = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: f.get('id'), password: f.get('pw'), deviceName: 'Admin dashboard', platform: 'web' }) });
        const j = await d.json(); if (!d.ok) throw new Error(j.message || 'Sign in failed');
        store.set('at', j.accessToken); store.set('rt', j.refreshToken); start();
      } catch (x) { login(x.message); }
    };
  }

  const TABS = [['overview', 'Overview'], ['users', 'Users'], ['reports', 'Reports'], ['content', 'Content'], ['audit', 'Audit log', true], ['system', 'System', true]];
  function shell() {
    const isAdmin = me.role === 'ADMIN';
    $('#app').innerHTML = `<header><h1>Send Me/U Admin</h1><nav>${TABS.filter((t) => !t[2] || isAdmin).map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</nav><span class="sp"></span>
      <span class="mute">${esc(me.name || me.username)} · ${esc(me.role)}</span><button class="b g" id="out">Sign out</button></header><main id="main"></main>`;
    document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; shell(); render(); }));
    $('#out').onclick = async () => { try { await post('/auth/logout', { refreshToken: store.get('rt') }); } catch { /* already gone */ } store.set('at', null); store.set('rt', null); location.reload(); };
  }
  const main = () => $('#main');
  const loading = () => (main().innerHTML = '<p class="mute">Loading…</p>');
  const fail = (e) => (main().innerHTML = `<p class="err">${esc(e.message)}</p>`);
  async function render() { loading(); try { await ({ overview, users, reports, content, audit, system }[tab])(); } catch (e) { fail(e); } }

  async function overview() {
    const [s, a] = await Promise.all([get('/admin/stats'), get('/admin/analytics?days=14')]);
    const cards = [['Users', s.users], ['Active (7d)', s.activeUsers7d], ['New (24h)', s.newUsers24h], ['New (7d)', s.newUsers7d], ['Messages (24h)', s.messages24h], ['Live stories', s.liveStories], ['Posts', s.posts], ['Calls (24h)', s.calls24h], ['Couples', s.activeCouples], ['Open reports', s.openReports], ['Suspended', s.suspended], ['Connected now', s.socketsConnected]];
    const bars = (rows) => { const max = Math.max(1, ...rows.map((r) => r.count)); return rows.length ? rows.map((r) => `<div title="${esc(r.date)}: ${r.count}" style="display:inline-block;width:${100 / Math.max(rows.length, 1) - 1}%;height:${Math.max(2, (r.count / max) * 70)}px;background:var(--brand);margin-right:1%;vertical-align:bottom;border-radius:3px 3px 0 0"></div>`).join('') : '<span class="mute">No data yet</span>'; };
    main().innerHTML = `<div class="cards">${cards.map(([l, v]) => `<div class="card"><b>${fmt(v)}</b><span>${l}</span></div>`).join('')}</div>
      ${[['Sign-ups per day', a.signups], ['Messages per day', a.messages], ['Stories per day', a.stories], ['Calls per day', a.calls]].map(([t, r]) => `<div class="card" style="margin-bottom:12px"><span>${t} (last ${a.days} days)</span><div style="height:76px;margin-top:8px;display:flex;align-items:flex-end">${bars(r)}</div></div>`).join('')}`;
  }

  async function users(q = '', status = '') {
    const d = await get(`/admin/users?limit=50${q ? '&q=' + encodeURIComponent(q) : ''}${status ? '&status=' + status : ''}`);
    const isAdmin = me.role === 'ADMIN';
    main().innerHTML = `<div class="row"><input id="q" placeholder="Search name, @username or email" value="${esc(q)}" style="min-width:260px"><select id="st"><option value="">All</option>${['active', 'suspended', 'deleted'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="b" id="go">Search</button><span class="mute">${fmt(d.total)} accounts</span></div>
      <table><tr><th>User</th><th>Email</th><th>Status</th><th>Joined</th><th></th></tr>${d.items.map((u) => `<tr><td><b>${esc(u.name)}</b><br><span class="mute">@${esc(u.username)} · ${esc(u.role)}</span></td><td>${esc(u.email)}</td>
      <td><span class="tag ${u.status === 'active' ? 'ok' : 'bad'}">${esc(u.status)}</span>${u.suspendedReason ? `<br><span class="mute">${esc(u.suspendedReason)}</span>` : ''}</td><td>${date(u.createdAt)}</td>
      <td>${isAdmin && u.role !== 'ADMIN' && u.status === 'active' ? `<button class="b d" data-s="${u.id}">Suspend</button>` : ''}${isAdmin && u.status === 'suspended' ? `<button class="b g" data-u="${u.id}">Unsuspend</button>` : ''}</td></tr>`).join('')}</table>`;
    $('#go').onclick = () => users($('#q').value.trim(), $('#st').value).catch(fail); $('#q').onkeydown = (e) => e.key === 'Enter' && $('#go').click();
    document.querySelectorAll('[data-s]').forEach((b) => (b.onclick = async () => { const reason = prompt('Reason for suspension (shown in the audit log)'); if (!reason) return; try { await post(`/admin/users/${b.dataset.s}/suspend`, { reason }); users(q, status); } catch (e) { alert(e.message); } }));
    document.querySelectorAll('[data-u]').forEach((b) => (b.onclick = async () => { try { await post(`/admin/users/${b.dataset.u}/unsuspend`); users(q, status); } catch (e) { alert(e.message); } }));
  }

  async function reports(status = 'open') {
    const d = await get(`/admin/reports?status=${status}&limit=50`);
    main().innerHTML = `<div class="row"><select id="st">${['open', 'reviewing', 'resolved', 'dismissed', 'all'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="mute">${fmt(d.total)} reports</span></div>
      <table><tr><th>Reported</th><th>Reason</th><th>By</th><th>When</th><th></th></tr>${d.items.map((r) => `<tr><td><b>${esc(r.targetType)}</b><br><span class="mute">${esc(r.reportedUser ? '@' + r.reportedUser.username : '')}</span></td><td>${esc(r.reason)}<br><span class="mute">${esc(r.details)}</span></td><td>@${esc(r.reporter?.username)}</td><td>${date(r.createdAt)}</td><td><button class="b" data-r="${r.id}">Review</button></td></tr>`).join('') || '<tr><td colspan="5" class="mute">Nothing here 🎉</td></tr>'}</table>`;
    $('#st').onchange = (e) => reports(e.target.value).catch(fail);
    document.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => review(b.dataset.r, status)));
  }
  async function review(id, status) {
    const r = await get('/admin/reports/' + id); const it = r.item;
    const m = document.createElement('div'); m.className = 'modal';
    const isAdmin = me.role === 'ADMIN';
    m.innerHTML = `<div><h3 style="margin:0">Report: ${esc(r.targetType)}</h3><div class="mute">${esc(r.reason)} — ${esc(r.details)}</div>
      <div class="card">${!it ? '<span class="mute">The reported item no longer exists.</span>' : it.deleted ? '<span class="mute">Already removed.</span>' : `${it.text ? `<pre>${esc(it.text)}</pre>` : ''}${it.caption ? `<pre>${esc(it.caption)}</pre>` : ''}${it.media ? `<img class="thumb" src="${esc(it.media)}" alt="">` : ''}${(it.attachments || []).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name || a.kind)}</a>`).join('<br>')}`}</div>
      <label>Note (internal)<textarea id="note" rows="2" style="width:100%"></textarea></label>
      <div class="row"><button class="b g" data-a="dismiss">Dismiss</button><button class="b" data-a="warn">Warn user</button><button class="b d" data-a="remove_content">Remove content</button>${isAdmin ? '<button class="b d" data-a="suspend">Suspend user</button>' : ''}<button class="b g" id="x">Close</button></div><div class="err" id="e"></div></div>`;
    document.body.appendChild(m); $('#x', m).onclick = () => { m.remove(); reports(status); };
    m.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => { try { await post(`/admin/reports/${id}/resolve`, { action: b.dataset.a, note: $('#note', m).value, suspendReason: r.reason }); m.remove(); reports(status); } catch (e) { $('#e', m).textContent = e.message; } }));
  }

  async function content() {
    const [p, s] = await Promise.all([get('/admin/content/posts?limit=20'), get('/admin/content/stories?limit=20')]);
    const grid = (rows, type) => rows.length ? `<table><tr><th>Preview</th><th>Owner</th><th>Text</th><th>When</th><th></th></tr>${rows.map((x) => `<tr><td>${x.media ? `<img src="${esc(x.media)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px">` : ''}</td><td>@${esc(x.user?.username)}</td><td>${esc(x.caption || x.text || '')}</td><td>${date(x.createdAt)}</td><td><button class="b d" data-x="${type}:${x.id}">Remove</button></td></tr>`).join('')}</table>` : '<p class="mute">Nothing to show.</p>';
    main().innerHTML = `<h3>Public posts</h3>${grid(p, 'post')}<h3>Live public stories</h3>${grid(s, 'story')}<p class="mute">Private chats, followers-only and private stories are never listed here. Moderators only see a message when someone reports it.</p>`;
    document.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { const [t, id] = b.dataset.x.split(':'); const reason = prompt('Reason for removal'); if (!reason) return; try { await raw('DELETE', `/admin/content/${t}/${id}`, { reason }); content(); } catch (e) { alert(e.message); } }));
  }

  async function audit() {
    const d = await get('/admin/audit-logs?limit=100');
    main().innerHTML = `<table><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th></tr>${d.items.map((a) => `<tr><td>${date(a.createdAt)}</td><td>${esc(a.action)}</td><td>${esc(a.actor?.username || '—')}</td><td>${esc(a.targetType || '')} ${esc(a.targetId || '')}</td><td>${esc(a.ip || '')}</td></tr>`).join('')}</table>`;
  }
  async function system() {
    const [h, s] = await Promise.all([get('/admin/system/health'), get('/admin/system/storage')]);
    const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
    main().innerHTML = `<div class="cards"><div class="card"><b><span class="tag ${h.status === 'ok' ? 'ok' : 'bad'}">${esc(h.status)}</span></b><span>Overall</span></div><div class="card"><b>${h.db.ok ? h.db.ms + ' ms' : 'down'}</b><span>Database</span></div><div class="card"><b>${h.redis.ok ? (h.redis.ms ?? h.redis.mode) + (h.redis.ms != null ? ' ms' : '') : 'down'}</b><span>Redis</span></div>
      <div class="card"><b>${Math.round(h.uptimeSec / 60)} min</b><span>Uptime</span></div><div class="card"><b>${h.memoryMb} MB</b><span>Memory</span></div><div class="card"><b>${h.sockets}</b><span>Sockets</span></div></div>
      <h3>Media storage (${esc(s.driver)})</h3><div class="cards"><div class="card"><b>${fmt(s.attachments.count)}</b><span>Attachments</span></div><div class="card"><b>${mb(s.attachments.bytes)}</b><span>Used by chat media</span></div>${s.disk ? `<div class="card"><b>${mb(s.disk.freeBytes)}</b><span>Disk free</span></div>` : ''}</div>`;
  }

  async function start() {
    if (!store.get('at')) return login();
    try { me = await get('/users/me'); } catch { return login(); }
    if (!['ADMIN', 'MODERATOR'].includes(me.role)) { store.set('at', null); store.set('rt', null); return login('This account is not an administrator or moderator.'); }
    shell(); render();
  }
  start();
})();
