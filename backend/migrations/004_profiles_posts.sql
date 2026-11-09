-- Profile fields, private accounts, follow requests, posts, reels, tags and post interactions. PostgreSQL.
-- psql -v ON_ERROR_STOP=1 -1 -f 004_profiles_posts.sql   (run after 003_people_relations.sql)
ALTER TABLE users ADD COLUMN IF NOT EXISTS title       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills      TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests   TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified    BOOLEAN NOT NULL DEFAULT false;

-- Pending follow requests to a private account. Accepting one moves it into user_follows.
CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),             -- one pending request per pair: no duplicates
  CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests (target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type  TEXT   NOT NULL CHECK (media_type IN ('image', 'video')),
  media_url   TEXT   NOT NULL,
  poster_url  TEXT,                                  -- thumbnail for videos
  duration_s  INT,
  caption     TEXT   NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id, media_type, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post_tags (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_user ON post_tags (user_id);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)                     -- one like per person
);
CREATE TABLE IF NOT EXISTS post_saves (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS post_comments (
  id         BIGSERIAL PRIMARY KEY,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT   NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at);
