-- Couple calendar, shared availability, live location. PostgreSQL 12+.
-- Run in a transaction: psql -v ON_ERROR_STOP=1 -1 -f 002_couple_calendar_location.sql
-- Assumes existing tables: users(id) and couples(id, user_a, user_b) where a couple links exactly two users.
-- If your couples table is named or shaped differently, adapt the REFERENCES clauses and the lookup in backend/src/couple/routes.js.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- lets the overlap constraints below mix "=" and range overlap

-- ---------------------------------------------------------------- appointments
CREATE TABLE IF NOT EXISTS appointments (
  id          BIGSERIAL PRIMARY KEY,
  couple_id   BIGINT      NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  created_by  BIGINT      NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  location    TEXT        NOT NULL DEFAULT '' CHECK (char_length(location) <= 120),
  start_time  TIMESTAMPTZ NOT NULL,            -- always UTC instants; clients render in their own timezone
  end_time    TIMESTAMPTZ NOT NULL,
  notes       TEXT        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),   -- only ever returned to created_by
  visibility  TEXT        NOT NULL DEFAULT 'shared'    CHECK (visibility IN ('shared','private')),  -- private = only created_by sees it
  status      TEXT        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  rev         INTEGER     NOT NULL DEFAULT 1,  -- optimistic concurrency: PUT must send the rev it last saw
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appt_range_ok     CHECK (end_time > start_time AND end_time - start_time <= interval '12 hours'),
  CONSTRAINT appt_place_ok     CHECK (visibility = 'private' OR btrim(location) <> ''),
  -- Hard guarantee against double booking, even under simultaneous requests: [start, end) ranges may touch but not overlap.
  CONSTRAINT appt_no_overlap_shared  EXCLUDE USING gist (couple_id WITH =, tstzrange(start_time, end_time) WITH &&)
    WHERE (status = 'confirmed' AND visibility = 'shared'),
  CONSTRAINT appt_no_overlap_private EXCLUDE USING gist (couple_id WITH =, created_by WITH =, tstzrange(start_time, end_time) WITH &&)
    WHERE (status = 'confirmed' AND visibility = 'private')
);
CREATE INDEX IF NOT EXISTS idx_appt_couple_start ON appointments (couple_id, start_time) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_appt_creator      ON appointments (created_by, start_time) WHERE status = 'confirmed';

-- ---------------------------------------------------------------- availability
CREATE TABLE IF NOT EXISTS availability (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  couple_id          BIGINT      NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  start_time         TIMESTAMPTZ NOT NULL,
  end_time           TIMESTAMPTZ NOT NULL,
  availability_type  TEXT        NOT NULL CHECK (availability_type IN ('busy','available')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT avail_range_ok CHECK (end_time > start_time AND end_time - start_time <= interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_avail_user_start   ON availability (user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_avail_couple_start ON availability (couple_id, start_time);

-- ---------------------------------------------------------------- live location
CREATE TABLE IF NOT EXISTS location_sharing_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  couple_id   BIGINT      NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  expires_at  TIMESTAMPTZ,                      -- NULL = "until I turn it off" (the server still ends it after 30 min without updates)
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ,
  CONSTRAINT lss_stopped_ok CHECK (is_active OR stopped_at IS NOT NULL),
  CONSTRAINT lss_expiry_ok  CHECK (expires_at IS NULL OR expires_at > started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lss_one_active_per_user ON location_sharing_sessions (user_id) WHERE is_active;
CREATE INDEX        IF NOT EXISTS idx_lss_expiry             ON location_sharing_sessions (expires_at) WHERE is_active AND expires_at IS NOT NULL;

-- One row per user: the latest position only. There is deliberately NO history table.
CREATE TABLE IF NOT EXISTS live_locations (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  couple_id   BIGINT      NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy    REAL        CHECK (accuracy IS NULL OR accuracy >= 0),   -- metres
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_locations_couple ON live_locations (couple_id);

-- ---------------------------------------------------------------- partner notifications
CREATE TABLE IF NOT EXISTS couple_notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id)   ON DELETE CASCADE,   -- recipient
  couple_id   BIGINT      NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,
  text        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_couple_notif_user ON couple_notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------- expiry
-- Ends timed sessions that ran out and open-ended ones abandoned for 30 min, and deletes the positions of everyone not sharing.
-- backend/src/couple/sockets.js calls it every minute; reads ALSO check expiry, so a missed run never exposes old coordinates.
CREATE OR REPLACE FUNCTION end_expired_location_sessions() RETURNS TABLE (user_id BIGINT, couple_id BIGINT) AS $$
  WITH ended AS (
    UPDATE location_sharing_sessions s SET is_active = FALSE, stopped_at = now()
     WHERE s.is_active AND (
       (s.expires_at IS NOT NULL AND s.expires_at <= now()) OR
       (s.expires_at IS NULL AND COALESCE((SELECT l.updated_at FROM live_locations l WHERE l.user_id = s.user_id), s.started_at) < now() - interval '30 minutes'))
    RETURNING s.user_id, s.couple_id
  ), wiped AS (
    DELETE FROM live_locations l WHERE NOT EXISTS (SELECT 1 FROM location_sharing_sessions a WHERE a.user_id = l.user_id AND a.is_active)
  )
  SELECT user_id, couple_id FROM ended;
$$ LANGUAGE sql;

-- Down migration:
-- DROP FUNCTION end_expired_location_sessions();
-- DROP TABLE couple_notifications, live_locations, location_sharing_sessions, availability, appointments;
