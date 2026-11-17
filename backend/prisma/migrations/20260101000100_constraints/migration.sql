-- Constraints, partial indexes and search indexes that Prisma's schema language cannot express.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── users ──────────────────────────────────────────────
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("username" ~ '^[a-z0-9._]{3,30}$');
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower"     CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_failed_logins_ok" CHECK ("failedLogins" >= 0);
CREATE INDEX "users_username_trgm" ON "users" USING gin ("username" gin_trgm_ops);
CREATE INDEX "users_fullname_trgm" ON "users" USING gin ("fullName" gin_trgm_ops);

-- ── social graph: no self relations ────────────────────
ALTER TABLE "follows"         ADD CONSTRAINT "follows_not_self"  CHECK ("followerId" <> "followeeId");
ALTER TABLE "follow_requests" ADD CONSTRAINT "frq_not_self"      CHECK ("requesterId" <> "targetId");
ALTER TABLE "blocked_users"   ADD CONSTRAINT "blocks_not_self"   CHECK ("blockerId" <> "blockedId");
ALTER TABLE "posts"           ADD CONSTRAINT "posts_media_type"  CHECK ("mediaType" IN ('image','video'));
ALTER TABLE "posts"           ADD CONSTRAINT "posts_caption_len" CHECK (char_length("caption") <= 2200);
ALTER TABLE "post_comments"   ADD CONSTRAINT "pc_body_len"       CHECK (char_length("body") BETWEEN 1 AND 500);

-- ── chat ───────────────────────────────────────────────
ALTER TABLE "conversations" ADD CONSTRAINT "conv_direct_key" CHECK (("type" = 'DIRECT') = ("directKey" IS NOT NULL));
ALTER TABLE "conversations" ADD CONSTRAINT "conv_disappear_ok" CHECK ("disappearAfterSec" IS NULL OR "disappearAfterSec" BETWEEN 5 AND 31536000);
ALTER TABLE "messages" ADD CONSTRAINT "msg_text_len" CHECK ("text" IS NULL OR char_length("text") <= 8000);
-- chat search inside a conversation
CREATE INDEX "messages_text_trgm" ON "messages" USING gin ("text" gin_trgm_ops) WHERE "deletedAt" IS NULL;
-- at most one pinned message per slot lookup is cheap; partial index for the pinned list
CREATE INDEX "messages_pinned_idx" ON "messages" ("conversationId", "pinnedAt") WHERE "pinnedAt" IS NOT NULL;
-- "unread for me" lookups
CREATE INDEX "messages_live_idx" ON "messages" ("conversationId", "createdAt" DESC) WHERE "deletedAt" IS NULL;

-- ── stories ────────────────────────────────────────────
ALTER TABLE "stories" ADD CONSTRAINT "story_expiry_ok" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "stories" ADD CONSTRAINT "story_has_content" CHECK (
  ("type" = 'TEXT' AND "textContent" IS NOT NULL) OR ("type" <> 'TEXT' AND "mediaUrl" IS NOT NULL));
CREATE INDEX "stories_active_idx" ON "stories" ("userId", "createdAt" DESC) WHERE "deletedAt" IS NULL;

-- ── couples ────────────────────────────────────────────
ALTER TABLE "couple_connections" ADD CONSTRAINT "couple_not_self" CHECK ("inviterId" <> "inviteeId");
-- one open (pending/active) connection per pair, in either direction
CREATE UNIQUE INDEX "couple_pair_open_uq" ON "couple_connections" (LEAST("inviterId","inviteeId"), GREATEST("inviterId","inviteeId"))
  WHERE "status" IN ('PENDING','ACTIVE');
-- a person can be in at most one ACTIVE couple (checked per side; the service also checks the cross case under a lock)
CREATE UNIQUE INDEX "couple_active_inviter_uq" ON "couple_connections" ("inviterId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "couple_active_invitee_uq" ON "couple_connections" ("inviteeId") WHERE "status" = 'ACTIVE';

ALTER TABLE "couple_calendar_events" ADD CONSTRAINT "cce_title_len" CHECK (char_length(btrim("title")) BETWEEN 1 AND 120);

ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_title_len" CHECK (char_length(btrim("title")) BETWEEN 1 AND 80);
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_range_ok"  CHECK ("endTime" > "startTime" AND "endTime" - "startTime" <= interval '12 hours');
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_vis_ok"    CHECK ("visibility" IN ('shared','private'));
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_status_ok" CHECK ("status" IN ('confirmed','cancelled'));
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_place_ok"  CHECK ("visibility" = 'private' OR btrim("location") <> '');
-- Hard guarantee against double booking even under simultaneous requests: [start,end) may touch but not overlap.
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_no_overlap_shared" EXCLUDE USING gist
  ("coupleId" WITH =, tsrange("startTime", "endTime") WITH &&) WHERE ("status" = 'confirmed' AND "visibility" = 'shared');
ALTER TABLE "couple_appointments" ADD CONSTRAINT "appt_no_overlap_private" EXCLUDE USING gist
  ("coupleId" WITH =, "createdById" WITH =, tsrange("startTime", "endTime") WITH &&) WHERE ("status" = 'confirmed' AND "visibility" = 'private');

ALTER TABLE "couple_availability" ADD CONSTRAINT "avail_range_ok" CHECK ("endTime" > "startTime" AND "endTime" - "startTime" <= interval '24 hours');
ALTER TABLE "couple_availability" ADD CONSTRAINT "avail_type_ok"  CHECK ("type" IN ('busy','available'));

CREATE UNIQUE INDEX "location_one_active_uq" ON "location_sessions" ("userId") WHERE "isActive";
ALTER TABLE "location_sessions" ADD CONSTRAINT "loc_stopped_ok" CHECK ("isActive" OR "stoppedAt" IS NOT NULL);
ALTER TABLE "live_locations" ADD CONSTRAINT "ll_lat_ok" CHECK ("latitude"  BETWEEN -90  AND 90);
ALTER TABLE "live_locations" ADD CONSTRAINT "ll_lng_ok" CHECK ("longitude" BETWEEN -180 AND 180);

-- ── streaks ────────────────────────────────────────────
ALTER TABLE "streaks" ADD CONSTRAINT "streak_users_ordered" CHECK ("userAId" < "userBId");
ALTER TABLE "streaks" ADD CONSTRAINT "streak_counts_ok"     CHECK ("currentCount" >= 0 AND "longestCount" >= "currentCount");

-- ── calls ──────────────────────────────────────────────
ALTER TABLE "call_events" ADD CONSTRAINT "ce_range_ok"   CHECK ("endsAt" > "startsAt" AND "endsAt" - "startsAt" <= interval '24 hours');
ALTER TABLE "call_events" ADD CONSTRAINT "ce_meeting_ok" CHECK ("meetingId" ~ '^[a-z0-9]{10,40}$');
ALTER TABLE "call_events" ADD CONSTRAINT "ce_rem_ok"     CHECK ("reminderMinutes" IN (0,5,15,30,60,1440));
ALTER TABLE "call_events" ADD CONSTRAINT "ce_status_ok"  CHECK ("status" IN ('scheduled','cancelled'));
-- a user can be in only one live call at a time (RINGING/ONGOING), enforced through participants in the service layer

-- ── notifications / reports ────────────────────────────
CREATE INDEX "notifications_unread_idx" ON "notifications" ("userId", "createdAt" DESC) WHERE "readAt" IS NULL;
CREATE UNIQUE INDEX "reports_open_dedupe_uq" ON "reports" ("reporterId", "targetType", "targetId") WHERE "status" IN ('OPEN','REVIEWING');
