-- Friends Streaks. PostgreSQL. Run in a transaction: psql -v ON_ERROR_STOP=1 -1 -f 001_friend_streaks.sql
-- Assumes an existing `users(id)` table and a `friendships(id, user_a, user_b, status)` table with user_a < user_b.
-- If your friendships table has a different shape, adapt the foreign keys; the streak tables only need friendship_id.

CREATE TABLE IF NOT EXISTS friend_streaks (
  friendship_id        BIGINT PRIMARY KEY REFERENCES friendships(id) ON DELETE CASCADE,  -- deleting/unfriending removes the streak
  user_a               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tz                   TEXT   NOT NULL DEFAULT 'UTC',          -- friendship timezone (IANA); fixed at creation, see docs/STREAKS.md
  current_count        INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  longest_count        INTEGER NOT NULL DEFAULT 0 CHECK (longest_count >= current_count),
  streak_id            INTEGER NOT NULL DEFAULT 0,             -- increments each time a new run begins
  status               TEXT   NOT NULL DEFAULT 'none' CHECK (status IN ('none','active','at_risk','expired')),
  last_mutual_day      DATE,                                    -- local (tz) day of the last mutual exchange
  day_key              DATE,                                    -- local day the two contribution columns refer to
  a_contributed_at     TIMESTAMPTZ,                             -- UTC; NULL = nothing yet on day_key
  b_contributed_at     TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,                             -- UTC instant the current streak ends
  blocked              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS idx_friend_streaks_user_a ON friend_streaks (user_a) WHERE current_count > 0;
CREATE INDEX IF NOT EXISTS idx_friend_streaks_user_b ON friend_streaks (user_b) WHERE current_count > 0;
CREATE INDEX IF NOT EXISTS idx_friend_streaks_expiry ON friend_streaks (expires_at) WHERE status IN ('active','at_risk');

-- Idempotency: one row per processed message. INSERT ... ON CONFLICT DO NOTHING; if 0 rows inserted, the event is a duplicate.
CREATE TABLE IF NOT EXISTS friend_streak_events (
  friendship_id  BIGINT NOT NULL REFERENCES friend_streaks(friendship_id) ON DELETE CASCADE,
  message_id     TEXT   NOT NULL,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT   NOT NULL,
  day_key        DATE   NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (friendship_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_streak_events_day ON friend_streak_events (friendship_id, user_id, day_key);

CREATE TABLE IF NOT EXISTS friend_streak_milestones (
  id             BIGSERIAL PRIMARY KEY,
  friendship_id  BIGINT NOT NULL REFERENCES friend_streaks(friendship_id) ON DELETE CASCADE,
  streak_id      INTEGER NOT NULL,
  days           INTEGER NOT NULL CHECK (days IN (3,7,14,30,50,100,365)),
  achieved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (friendship_id, streak_id, days)                       -- a milestone is saved once per run
);

CREATE TABLE IF NOT EXISTS friend_streak_recoveries (
  id              BIGSERIAL PRIMARY KEY,
  friendship_id   BIGINT NOT NULL REFERENCES friend_streaks(friendship_id) ON DELETE CASCADE,
  requested_by    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_count  INTEGER NOT NULL,
  expired_at      TIMESTAMPTZ NOT NULL,
  recovered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_streak_recoveries_recent ON friend_streak_recoveries (friendship_id, recovered_at DESC);  -- cooldown lookup

CREATE TABLE IF NOT EXISTS streak_reminder_prefs (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,                 -- independent of message notifications
  push           BOOLEAN NOT NULL DEFAULT TRUE,
  in_app         BOOLEAN NOT NULL DEFAULT TRUE,
  hours_before   SMALLINT NOT NULL DEFAULT 4 CHECK (hours_before BETWEEN 1 AND 12),
  last_reminded  JSONB NOT NULL DEFAULT '{}'::jsonb             -- {friendship_id: 'YYYY-MM-DD'} -> at most one nudge per day
);

-- Down migration:
-- DROP TABLE streak_reminder_prefs, friend_streak_recoveries, friend_streak_milestones, friend_streak_events, friend_streaks;
