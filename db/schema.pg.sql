-- PostgreSQL schema. Targets Supabase in production and PGlite locally;
-- both are real Postgres, so this file is the single source of truth.
--
-- Timestamps are BIGINT milliseconds (Date.now()) rather than timestamptz,
-- so the JavaScript side never has to think about timezones.

-- An organisation is the wall between tenants. Every user belongs to one;
-- every task, tag, meeting and conversation carries the id of the one it
-- belongs to, and nothing is ever read across that line.
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Shown to the CEO, typed by whoever is joining. Rotatable.
  invite_code TEXT NOT NULL UNIQUE,
  created_at  BIGINT NOT NULL
);

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
  name  TEXT NOT NULL,
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

-- Files attached to a task. Like the voice notes above, the bytes live in the
-- database: Supabase's free tier is 500 MB shared with everything else, hence
-- the small per-file cap enforced in the upload route.
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size   INTEGER NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

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
  -- What was actually discussed. Written in the app after the call, because
  -- Meet only transcribes for paid Workspace accounts.
  minutes           TEXT NOT NULL DEFAULT '',
  minutes_author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  minutes_updated_at BIGINT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(starts_at);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL until somebody says either way: "not marked" and "did not turn up"
  -- are different things, and only one of them is worth showing in a history.
  attended   INTEGER,
  PRIMARY KEY (meeting_id, user_id)
);

-- Upgrades a database created before meeting minutes existed.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS minutes TEXT NOT NULL DEFAULT '';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS minutes_author_id TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS minutes_updated_at BIGINT;
ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS attended INTEGER;

-- Conversations. A 'task' conversation is opened automatically the moment a
-- task involves more than two people and closes when the task is done; a
-- 'direct' one is between whoever started it. Messages are the record; the
-- conversation row only says who is in it and whether it is still open.
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('direct','task')),
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  closed_at  BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_task    ON conversations(task_id);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Unread is "anything after this", so a member never needs a row per message.
  last_read_at    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_convmem_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

-- A message can be reworded or taken back. Deleting keeps the row (so the
-- thread still reads in order) but empties it and drops any file with it.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at  BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at BIGINT;

-- Clearing or deleting a chat is per person: what one member wipes from their
-- own view stays with everyone else, the way a phone clears a thread without
-- reaching into anyone else's. cleared_at hides everything older; hidden_at
-- drops the room from that member's list until somebody writes in it again.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_at  BIGINT;

-- Files sent in chat: pictures, documents, voice notes. The bytes live in the
-- row like every other upload here, under the same per-file cap as task
-- attachments; one file per message.
CREATE TABLE IF NOT EXISTS message_files (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('file','image','voice')),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size   INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_files_msg ON message_files(message_id);

-- Profile pictures, kept small and in the row like everything else.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT;
-- When the picture last changed. It is the cache key: the URL carries it, so
-- a new picture is a new URL for everyone, not just for the person who
-- uploaded it and only until they reload.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at BIGINT;
-- Pictures that predate the stamp get one now, so their URL changes once and
-- every browser holding an old copy asks again instead of waiting out a timer.
UPDATE users SET avatar_updated_at = (extract(epoch from now()) * 1000)::bigint
  WHERE avatar_data IS NOT NULL AND avatar_updated_at IS NULL;

-- Browser push. One row per browser a person has said yes in.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Tenancy columns, added after the fact so an existing install upgrades in
-- place. Everything that existed before organisations did is adopted into
-- one default organisation, exactly once.
ALTER TABLE users         ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE tasks         ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE tags          ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE meetings      ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);

INSERT INTO organizations (id, name, invite_code, created_at)
  SELECT 'org_default', 'My organization', upper(substr(md5(random()::text), 1, 8)),
         (extract(epoch from now()) * 1000)::bigint
  WHERE NOT EXISTS (SELECT 1 FROM organizations)
    AND EXISTS (SELECT 1 FROM users WHERE org_id IS NULL);

UPDATE users SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;
UPDATE tasks SET org_id = (SELECT u.org_id FROM users u WHERE u.id = tasks.creator_id)
  WHERE org_id IS NULL AND creator_id IS NOT NULL;
UPDATE tasks SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;
UPDATE tags SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;
UPDATE meetings SET org_id = (SELECT u.org_id FROM users u WHERE u.id = meetings.organizer_id)
  WHERE org_id IS NULL AND organizer_id IS NOT NULL;
UPDATE meetings SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;
UPDATE conversations SET org_id = (SELECT t.org_id FROM tasks t WHERE t.id = conversations.task_id)
  WHERE org_id IS NULL AND task_id IS NOT NULL;
UPDATE conversations SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
  WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_org    ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org    ON tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_meetings_org ON meetings(org_id);
CREATE INDEX IF NOT EXISTS idx_conv_org     ON conversations(org_id);
-- A tag name is unique within an organisation, not across all of them.
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_org_name ON tags(org_id, name);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
INSERT INTO counters (name, value) VALUES ('task_seq', 0) ON CONFLICT (name) DO NOTHING;
