// Express routes for the Timeline "People you know" actions. Mount at /api/v1:
//   app.use('/api/v1', peopleRouter({ pool, auth }));
// `auth` must set req.user.id from a verified token; the caller is never taken from the URL or body.
// Assumes users(id, name, username, bio, avatar_url). Adapt the column names in PROFILE_SQL to your users table.
import express from 'express';

const HttpError = (status, message) => Object.assign(new Error(message), { status });
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idOf = (v) => { if (!/^\d{1,18}$/.test(String(v))) throw HttpError(400, 'Invalid user id'); return String(v); };

// Blocking is mutual for visibility: neither side can see the other's profile.
const BLOCKED = `EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))`;
const PROFILE_SQL = `
  SELECT u.id, u.name, u.username AS handle, u.bio, u.avatar_url AS avatar,
    (SELECT count(*) FROM user_follows f WHERE f.followee_id = u.id)::int AS followers,
    (SELECT count(*) FROM user_follows f WHERE f.follower_id = u.id)::int AS following,
    (SELECT count(*) FROM user_follows a JOIN user_follows b ON a.followee_id = b.follower_id AND b.followee_id = u.id
       WHERE a.follower_id = $1 AND EXISTS (SELECT 1 FROM user_follows c WHERE c.follower_id = u.id AND c.followee_id = a.followee_id))::int AS mutual,
    EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS "isFollowing",
    EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follower
  FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`;

export function peopleRouter({ pool, auth }) {
  const r = express.Router();
  r.use(auth);
  const target = (req) => { const id = idOf(req.params.userId); if (id === String(req.user.id)) throw HttpError(400, 'You cannot do that to yourself'); return id; };
  const mustBeVisible = async (me, id) => { const { rows } = await pool.query(`SELECT u.id FROM users u WHERE u.id = $2 AND NOT ${BLOCKED}`, [me, id]); if (!rows[0]) throw HttpError(404, 'User not found'); };

  r.get('/users/:userId/profile', asyncH(async (req, res) => {
    const { rows } = await pool.query(PROFILE_SQL, [req.user.id, idOf(req.params.userId)]);
    if (!rows[0]) throw HttpError(404, 'This profile isn’t available');
    res.json({ data: rows[0] });
  }));

  // Follow is idempotent: the primary key makes a second request a no-op.
  r.post('/users/:userId/follow', asyncH(async (req, res) => {
    const id = target(req); await mustBeVisible(req.user.id, id);
    await pool.query(`INSERT INTO user_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
    const { rows } = await pool.query(`SELECT count(*)::int AS followers FROM user_follows WHERE followee_id = $1`, [id]);
    res.json({ data: { following: true, followers: rows[0].followers } });
  }));
  r.delete('/users/:userId/follow', asyncH(async (req, res) => {
    const id = target(req);
    await pool.query(`DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`, [req.user.id, id]);
    const { rows } = await pool.query(`SELECT count(*)::int AS followers FROM user_follows WHERE followee_id = $1`, [id]);
    res.json({ data: { following: false, followers: rows[0].followers } });
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
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ data: { blocked: true } });
  }));

  r.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.status ? err.message : 'Something went wrong' }));
  return r;
}
