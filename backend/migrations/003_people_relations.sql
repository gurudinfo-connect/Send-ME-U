-- Follow / dismissed-suggestion / block relations. PostgreSQL. psql -v ON_ERROR_STOP=1 -1 -f 003_people_relations.sql
-- Assumes an existing users(id) table.
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),            -- one relationship per pair: no duplicate follows
  CHECK (follower_id <> followee_id)                 -- nobody follows themselves
);
CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows (followee_id);

CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_id),
  CHECK (user_id <> dismissed_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);
