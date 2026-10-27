// Idempotent statements, run in order at startup. Add new ones to the end.
export const schema = [
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     username TEXT NOT NULL,
     password_hash TEXT NOT NULL DEFAULT '',
     google_id TEXT UNIQUE,
     email TEXT
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))',
  `CREATE TABLE IF NOT EXISTS notes (
     id SERIAL PRIMARY KEY,
     owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL DEFAULT 'Untitled',
     content TEXT NOT NULL DEFAULT '',
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS notes_owner ON notes (owner_id, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS note_versions (
     id SERIAL PRIMARY KEY,
     note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS versions_note ON note_versions (note_id, id DESC)',
  // Optimistic concurrency + attribution
  'ALTER TABLE notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL',
  'ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL',
  // Per-note sharing
  `CREATE TABLE IF NOT EXISTS note_shares (
     note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
     PRIMARY KEY (note_id, user_id)
   )`,
  'CREATE INDEX IF NOT EXISTS shares_user ON note_shares (user_id)',
  // Team workspaces
  `CREATE TABLE IF NOT EXISTS teams (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS team_members (
     team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
     PRIMARY KEY (team_id, user_id)
   )`,
  'CREATE INDEX IF NOT EXISTS team_members_user ON team_members (user_id)',
  // Deleting a team turns its notes back into personal notes of whoever created them
  'ALTER TABLE notes ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL',
  'CREATE INDEX IF NOT EXISTS notes_team ON notes (team_id)',
  // Rich text: content is sanitized HTML; content_text is a plain copy for search and previews
  "ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT ''",
  "UPDATE notes SET content_text = content WHERE content_text = '' AND content <> '' AND content NOT LIKE '%<%'",
]
