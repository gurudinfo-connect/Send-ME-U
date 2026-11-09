// Express routes for the Timeline "People you know" actions. Mount at /api/v1:
//   app.use('/api/v1', peopleRouter({ pool, auth }));
// `auth` must set req.user.id from a verified token; the caller is never taken from the URL or body.
// Assumes users(id, name, username, bio, avatar_url) plus the profile columns added by migrations/004_profiles_posts.sql.
// Adapt the column names in PROFILE_SQL to your users table.
import express from 'express';

const HttpError = (status, message) => Object.assign(new Error(message), { status });
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idOf = (v) => { if (!/^\d{1,18}$/.test(String(v))) throw HttpError(400, 'Invalid user id'); return String(v); };

// Blocking is mutual for visibility: neither side can see the other's profile.
const BLOCKED = `EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))`;
// $1 = the signed-in user. May $1 see the posts / lists of account `u`? Owner, public account, or an accepted follower.
const CAN_VIEW = `(u.id = $1 OR NOT u.is_private OR EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = $1 AND f.followee_id = u.id))`;
const PROFILE_SQL = `
  SELECT u.id, u.name, u.username AS handle, u.bio, u.avatar_url AS avatar, u.title, u.location, u.website, u.skills, u.interests,
    u.is_private AS "isPrivate", u.verified,
    (SELECT count(*) FROM posts p WHERE p.user_id = u.id AND p.deleted_at IS NULL)::int AS posts,
    (SELECT count(*) FROM user_follows f WHERE f.followee_id = u.id)::int AS followers,
    (SELECT count(*) FROM user_follows f WHERE f.follower_id = u.id)::int AS following,
    (SELECT count(*) FROM user_follows a JOIN user_follows b ON a.followee_id = b.follower_id AND b.followee_id = u.id
       WHERE a.follower_id = $1 AND EXISTS (SELECT 1 FROM user_follows c WHERE c.follower_id = u.id AND c.followee_id = a.followee_id))::int AS mutual,
    EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS "isFollowing",
    EXISTS (SELECT 1 FROM follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
    EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follower
  FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`;
// People in a followers / following list, as the signed-in user sees them. Blocked people (either way) are left out.
const PERSON_ROW = `u.id, u.name, u.username AS handle, u.avatar_url AS avatar, u.verified,
    (u.id = $1) AS "isMe",
    EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS "isFollowing",
    EXISTS (SELECT 1 FROM follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested`;
const POST_COLS = `p.id, p.user_id AS "userId", p.media_type AS type, CASE WHEN p.media_type = 'image' THEN p.media_url END AS src,
    COALESCE(p.poster_url, CASE WHEN p.media_type = 'video' THEN p.media_url END) AS poster, p.duration_s, p.caption, p.created_at AS "createdAt",
    (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id)::int AS likes,
    EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked,
    EXISTS (SELECT 1 FROM post_saves s WHERE s.post_id = p.id AND s.user_id = $1) AS saved,
    (SELECT count(*) FROM post_comments c WHERE c.post_id = p.id)::int AS comments,
    json_build_object('id', u.id, 'name', u.name, 'handle', u.username, 'avatar', u.avatar_url, 'verified', u.verified) AS owner`;
// A post is reachable only through an owner the viewer may see (not blocked, public or followed)
const POST_FROM = `posts p JOIN users u ON u.id = p.user_id WHERE p.deleted_at IS NULL AND NOT ${BLOCKED} AND ${CAN_VIEW}`;
const TABS = {
  posts: `p.user_id = $2 AND p.media_type = 'image'`,
  reels: `p.user_id = $2 AND p.media_type = 'video'`,
  tagged: `p.user_id <> $2 AND EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.user_id = $2)`,
};
const page = (req) => ({ limit: Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 30)), offset: Math.max(0, parseInt(req.query.offset, 10) || 0) });

export function peopleRouter({ pool, auth }) {
  const r = express.Router();
  r.use(auth);
  r.use(express.json({ limit: '10kb' })); // no-op when the app already parsed the body
  const target = (req) => { const id = idOf(req.params.userId); if (id === String(req.user.id)) throw HttpError(400, 'You cannot do that to yourself'); return id; };
  const mustBeVisible = async (me, id) => { const { rows } = await pool.query(`SELECT u.id FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`, [me, id]); if (!rows[0]) throw HttpError(404, 'User not found'); };

  r.get('/users/:userId/profile', asyncH(async (req, res) => {
    const id = idOf(req.params.userId);
    const { rows } = await pool.query(PROFILE_SQL, [req.user.id, id]);
    if (rows[0]) return res.json({ data: rows[0] });
    // someone I blocked: only who they are, so the app can offer Unblock. If they blocked me, it is a plain 404.
    const mine = await pool.query(`SELECT u.id, u.name, u.username AS handle, u.avatar_url AS avatar, true AS blocked FROM users u
      WHERE u.id = $2 AND EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = u.id)`, [req.user.id, id]);
    if (!mine.rows[0]) throw HttpError(404, 'This profile isn’t available');
    res.json({ data: mine.rows[0] });
  }));

  // tab = posts | reels | tagged. A private account's content comes back locked (200) until the viewer is an accepted follower.
  r.get('/users/:userId/posts', asyncH(async (req, res) => {
    const id = idOf(req.params.userId);
    const tab = TABS[req.query.tab] ? req.query.tab : 'posts';
    const { limit, offset } = page(req);
    const who = await pool.query(`SELECT u.id, ${CAN_VIEW} AS ok FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`, [req.user.id, id]);
    if (!who.rows[0]) throw HttpError(404, 'This profile isn’t available');
    if (!who.rows[0].ok) return res.json({ data: { locked: true, items: [] } });
    const { rows } = await pool.query(`SELECT ${POST_COLS} FROM ${POST_FROM} AND ${TABS[tab]} ORDER BY p.created_at DESC, p.id DESC LIMIT $3 OFFSET $4`, [req.user.id, id, limit, offset]);
    res.json({ data: { locked: false, items: rows } });
  }));

  // followers / following lists (hidden for private accounts the viewer doesn't follow)
  const list = (dir) => asyncH(async (req, res) => {
    const id = idOf(req.params.userId);
    const { limit, offset } = page(req);
    const who = await pool.query(`SELECT ${CAN_VIEW} AS ok FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`, [req.user.id, id]);
    if (!who.rows[0]) throw HttpError(404, 'This profile isn’t available');
    if (!who.rows[0].ok) throw HttpError(403, 'This account is private');
    const [self, other] = dir === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const { rows } = await pool.query(`SELECT ${PERSON_ROW} FROM user_follows e JOIN users u ON u.id = e.${other}
      WHERE e.${self} = $2 AND NOT ${BLOCKED} ORDER BY e.created_at DESC, u.id LIMIT $3 OFFSET $4`, [req.user.id, id, limit, offset]);
    res.json({ data: rows });
  });
  r.get('/users/:userId/followers', list('followers'));
  r.get('/users/:userId/following', list('following'));

  // Follow is idempotent: the primary keys make a second request a no-op. A private account gets a request instead of a follow.
  r.post('/users/:userId/follow', asyncH(async (req, res) => {
    const id = target(req); await mustBeVisible(req.user.id, id);
    const { rows: [t] } = await pool.query(`SELECT is_private FROM users WHERE id = $1`, [id]);
    const already = await pool.query(`SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2`, [req.user.id, id]);
    let result;
    if (already.rowCount || !t.is_private) {
      await pool.query(`INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
      await pool.query(`DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [req.user.id, id]);
      result = { following: true, requested: false };
    } else {
      await pool.query(`INSERT INTO follow_requests (requester_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
      result = { following: false, requested: true };
    }
    const { rows } = await pool.query(`SELECT count(*)::int AS followers FROM user_follows WHERE followee_id = $1`, [id]);
    res.json({ data: { ...result, followers: rows[0].followers } });
  }));
  // Unfollow, and also cancels a pending request
  r.delete('/users/:userId/follow', asyncH(async (req, res) => {
    const id = target(req);
    await pool.query(`DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`, [req.user.id, id]);
    await pool.query(`DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [req.user.id, id]);
    const { rows } = await pool.query(`SELECT count(*)::int AS followers FROM user_follows WHERE followee_id = $1`, [id]);
    res.json({ data: { following: false, requested: false, followers: rows[0].followers } });
  }));

  // Requests I have received, and accepting / declining them
  r.get('/follow-requests', asyncH(async (req, res) => {
    const { rows } = await pool.query(`SELECT u.id, u.name, u.username AS handle, u.avatar_url AS avatar, u.verified, q.created_at AS "createdAt"
      FROM follow_requests q JOIN users u ON u.id = q.requester_id WHERE q.target_id = $1 AND NOT ${BLOCKED} ORDER BY q.created_at DESC`, [req.user.id]);
    res.json({ data: rows });
  }));
  r.post('/follow-requests/:userId/accept', asyncH(async (req, res) => {
    const id = target(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const del = await client.query(`DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [id, req.user.id]);
      if (!del.rowCount) throw HttpError(404, 'This request is no longer pending');
      await client.query(`INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, req.user.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ data: { ok: true } });
  }));
  r.delete('/follow-requests/:userId', asyncH(async (req, res) => {
    const id = target(req);
    await pool.query(`DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2`, [id, req.user.id]);
    res.json({ data: { ok: true } });
  }));

  // Remove from suggestions only: no account change, no unfollow.
  r.delete('/suggestions/:userId', asyncH(async (req, res) => {
    const id = target(req);
    await pool.query(`INSERT INTO dismissed_suggestions (user_id, dismissed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
    res.json({ data: { ok: true } });
  }));

  // Block also severs follows in both directions.
  r.post('/users/:userId/block', asyncH(async (req, res) => {
    const id = target(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
      await client.query(`DELETE FROM user_follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`, [req.user.id, id]);
      await client.query(`DELETE FROM follow_requests WHERE (requester_id = $1 AND target_id = $2) OR (requester_id = $2 AND target_id = $1)`, [req.user.id, id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ data: { blocked: true } });
  }));

  r.delete('/users/:userId/block', asyncH(async (req, res) => {
    const id = target(req);
    await pool.query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [req.user.id, id]);
    res.json({ data: { blocked: false } });
  }));

  // ---- post interactions: every one first checks the viewer may see the post (not blocked, public or followed) ----
  const postId = (req) => { if (!/^\d{1,18}$/.test(String(req.params.postId))) throw HttpError(400, 'Invalid post id'); return String(req.params.postId); };
  const mustSee = async (me, pid) => { const { rows } = await pool.query(`SELECT p.id FROM ${POST_FROM} AND p.id = $2`, [me, pid]); if (!rows[0]) throw HttpError(404, 'This post isn’t available'); };
  const flag = (table, on) => asyncH(async (req, res) => {
    const pid = postId(req); await mustSee(req.user.id, pid);
    await pool.query(on ? `INSERT INTO ${table} (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING` : `DELETE FROM ${table} WHERE post_id = $1 AND user_id = $2`, [pid, req.user.id]);
    const { rows } = await pool.query(`SELECT count(*)::int AS likes FROM post_likes WHERE post_id = $1`, [pid]);
    res.json({ data: table === 'post_likes' ? { liked: on, likes: rows[0].likes } : { saved: on } });
  });
  r.post('/posts/:postId/like', flag('post_likes', true));
  r.delete('/posts/:postId/like', flag('post_likes', false));
  r.post('/posts/:postId/save', flag('post_saves', true));
  r.delete('/posts/:postId/save', flag('post_saves', false));

  r.get('/posts/:postId/comments', asyncH(async (req, res) => {
    const pid = postId(req); await mustSee(req.user.id, pid);
    const { limit, offset } = page(req);
    const { rows } = await pool.query(`SELECT c.id, c.user_id AS "userId", u.name, u.avatar_url AS avatar, c.body AS text, c.created_at AS at
      FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = $2 AND NOT ${BLOCKED} ORDER BY c.created_at, c.id LIMIT $3 OFFSET $4`, [req.user.id, pid, limit, offset]);
    res.json({ data: rows });
  }));
  r.post('/posts/:postId/comments', asyncH(async (req, res) => {
    const pid = postId(req); await mustSee(req.user.id, pid);
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw HttpError(400, 'Write a comment first');
    if (text.length > 500) throw HttpError(400, 'Comments can be up to 500 characters');
    const { rows } = await pool.query(`WITH c AS (INSERT INTO post_comments (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, user_id, body, created_at)
      SELECT c.id, c.user_id AS "userId", u.name, u.avatar_url AS avatar, c.body AS text, c.created_at AS at FROM c JOIN users u ON u.id = c.user_id`, [pid, req.user.id, text]);
    res.status(201).json({ data: rows[0] });
  }));

  r.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.status ? err.message : 'Something went wrong' }));
  return r;
}
