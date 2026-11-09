-- Scheduled calls ("call events"): events, guests, reminders, notifications. PostgreSQL 12+.
-- Run in a transaction: psql -v ON_ERROR_STOP=1 -1 -f 005_call_events.sql
-- Assumes users(id, name, avatar_url). Table names avoid the existing couple "appointments" tables.

CREATE TABLE IF NOT EXISTS scheduled_events (
  id               BIGSERIAL PRIMARY KEY,
  host_user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  description      TEXT        NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  event_image      TEXT,                                  -- small data URL or object-storage URL (the UI downsizes to <= 720px)
  start_datetime   TIMESTAMPTZ NOT NULL,                  -- UTC instants; clients render in their own time zone
  end_datetime     TIMESTAMPTZ NOT NULL,
  call_type        TEXT        NOT NULL CHECK (call_type IN ('voice','video')),
  meeting_id       TEXT        NOT NULL UNIQUE CHECK (meeting_id ~ '^[a-z0-9]{10,40}$'),  -- unguessable room id; the invite link is /calls/join/<meeting_id>
  require_approval BOOLEAN     NOT NULL DEFAULT false,
  reminder_minutes INTEGER     NOT NULL DEFAULT 15 CHECK (reminder_minutes IN (0,5,15,30,60,1440)),
  status           TEXT        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT se_range_ok CHECK (end_datetime > start_datetime AND end_datetime - start_datetime <= interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_se_host  ON scheduled_events (host_user_id, start_datetime);
CREATE INDEX IF NOT EXISTS idx_se_start ON scheduled_events (start_datetime) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS scheduled_event_guests (
  id                BIGSERIAL PRIMARY KEY,
  event_id          BIGINT      NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
  user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitation_status TEXT        NOT NULL DEFAULT 'pending' CHECK (invitation_status IN ('pending','accepted','declined','removed')),
  approved          BOOLEAN     NOT NULL DEFAULT false,   -- host let this guest in (only matters when the event requires approval)
  join_requested    BOOLEAN     NOT NULL DEFAULT false,
  via_link          BOOLEAN     NOT NULL DEFAULT false,   -- answered through the invitation link instead of being invited by name
  joined_at         TIMESTAMPTZ,
  left_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)                              -- a person can never be invited twice
);
CREATE INDEX IF NOT EXISTS idx_seg_user ON scheduled_event_guests (user_id, invitation_status);

CREATE TABLE IF NOT EXISTS event_reminders (
  id                BIGSERIAL PRIMARY KEY,
  event_id          BIGINT      NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
  user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_datetime TIMESTAMPTZ NOT NULL,
  delivery_status   TEXT        NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','skipped')),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_er_due ON event_reminders (reminder_datetime) WHERE delivery_status = 'pending';

-- Notifications shown in the app's Notifications screen. If you already have a notifications table, insert there instead (see notify() in routes.js).
CREATE TABLE IF NOT EXISTS call_event_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   BIGINT      REFERENCES scheduled_events(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL,   -- event:invite | event:updated | event:cancelled | event:response | event:request | event:reminder
  text       TEXT        NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cen_user ON call_event_notifications (user_id, created_at DESC);
