-- PostgreSQL schema. Targets Supabase in production and PGlite locally;
-- both are real Postgres, so this file is the single source of truth.
--
-- Timestamps are BIGINT milliseconds (Date.now()) rather than timestamptz,
-- so the JavaScript side never has to think about timezones.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('CEO','MANAGER','TEAM_LEAD','DEV')),
  avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
  title         TEXT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  used_at    BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'TRIAGE'
                 CHECK (status IN ('TRIAGE','TODO','IN_PROGRESS','SUBMITTED','CHANGES_REQUESTED','BLOCKED','DONE')),
  priority     TEXT NOT NULL DEFAULT 'MEDIUM'
                 CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW','NONE')),
  -- Nullable so a departed teammate can be removed without deleting the
  -- tasks they raised. The UI shows "Removed user" instead.
  creator_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignee_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  due_date     BIGINT,
  start_date   BIGINT,
  estimate     DOUBLE PRECISION,
  progress     INTEGER NOT NULL DEFAULT 0,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  submitted_at BIGINT,
  completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent   ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);

CREATE TABLE IF NOT EXISTS task_links (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url      TEXT NOT NULL,
  label    TEXT NOT NULL DEFAULT '',
  position DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_task ON task_links(task_id);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'gray'
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  message    TEXT NOT NULL DEFAULT '',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS activity (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);

-- Audio lives in the database as BYTEA. Supabase's free tier is 500 MB, and a
-- 5-minute Opus recording is roughly 2-4 MB, so keep an eye on it — the README
-- explains how to move these to object storage if the workspace gets busy.
CREATE TABLE IF NOT EXISTS voice_notes (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  mime        TEXT NOT NULL DEFAULT 'audio/webm',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  byte_size   INTEGER NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_at  BIGINT NOT NULL,
  -- Speech-to-text, generated client-side (see src/lib/transcribe*.ts). Urdu
  -- speech is stored transliterated into Roman script, English as spoken.
  transcript        TEXT,
  transcript_lang   TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'none'
                      CHECK (transcript_status IN ('none','pending','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_voice_task    ON voice_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_voice_comment ON voice_notes(comment_id);

-- Upgrades a database created before transcription existed. Safe to run on
-- every cold start: each ADD COLUMN is a no-op once the column is present.
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS transcript_lang TEXT;
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS transcript_status TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS progress_updates (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'update'
                 CHECK (kind IN ('update','submitted','approved','changes_requested')),
  percent      INTEGER NOT NULL DEFAULT 0,
  done_summary TEXT NOT NULL DEFAULT '',
  remaining    TEXT NOT NULL DEFAULT '',
  blockers     TEXT NOT NULL DEFAULT '',
  hours_spent  DOUBLE PRECISION,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_task ON progress_updates(task_id, created_at);

-- Video calls. The Meet link is created against one central Google account, so
-- nobody here ever connects a Google account of their own. Google owns the
-- invite emails and reminders; this table owns everything the app shows.
CREATE TABLE IF NOT EXISTS meetings (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  agenda            TEXT NOT NULL DEFAULT '',
  organizer_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Optional: a meeting can hang off the task it is about.
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  starts_at         BIGINT NOT NULL,
  duration_min      INTEGER NOT NULL DEFAULT 30,
  -- Times are epoch milliseconds like everywhere else, but Google needs an
  -- IANA zone alongside them, and keeping it makes a later edit survive DST.
  time_zone         TEXT NOT NULL DEFAULT 'UTC',
  join_url          TEXT,
  calendar_event_id TEXT,
  -- 'failed' means the meeting exists here but Google never took it, so the
  -- organiser keeps their input and can retry instead of losing the form.
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','failed','cancelled')),
  sync_error        TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(starts_at);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
INSERT INTO counters (name, value) VALUES ('task_seq', 0) ON CONFLICT (name) DO NOTHING;
