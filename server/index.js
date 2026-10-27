import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'

const SECRET = process.env.JWT_SECRET
if (!SECRET || SECRET.length < 16) {
  console.error('Set JWT_SECRET (16+ chars) in .env')
  process.exit(1)
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

const here = path.dirname(fileURLToPath(import.meta.url))

// ---------- Database ----------
// Production: Postgres via DATABASE_URL (e.g. Neon). Local dev without it: PGlite (embedded Postgres, stored in ./data).
let query
if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  query = async (text, params) => (await pool.query(text, params)).rows
} else {
  const { PGlite } = await import('@electric-sql/pglite')
  const lite = new PGlite(process.env.PGLITE_DIR || path.join(here, '../data/pgdata'))
  await lite.waitReady
  query = async (text, params) => (await lite.query(text, params)).rows
}

for (const statement of [
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
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL DEFAULT 'Untitled',
     content TEXT NOT NULL DEFAULT '',
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS notes_user ON notes (user_id, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS note_versions (
     id SERIAL PRIMARY KEY,
     note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS versions_note ON note_versions (note_id, id DESC)',
]) await query(statement)

// Save the state a note had before an edit. Throttled so autosave doesn't create hundreds of versions.
const MIN_GAP_SECONDS = 30
const MAX_VERSIONS = 50
const snapshot = async (note, force = false) => {
  if (note.title === 'Untitled' && !note.content) return
  const [last] = await query(
    'SELECT title, content, EXTRACT(EPOCH FROM (now() - created_at)) AS age FROM note_versions WHERE note_id = $1 ORDER BY id DESC LIMIT 1',
    [note.id]
  )
  if (last && last.title === note.title && last.content === note.content) return
  if (!force && last && Number(last.age) < MIN_GAP_SECONDS) return
  await query('INSERT INTO note_versions (note_id, title, content) VALUES ($1, $2, $3)', [note.id, note.title, note.content])
  await query(
    'DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (SELECT id FROM note_versions WHERE note_id = $1 ORDER BY id DESC LIMIT $2)',
    [note.id, MAX_VERSIONS]
  )
}

const asId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null)
const ownNote = async (id, userId) => {
  const noteId = asId(id)
  if (noteId === null) return null
  const [note] = await query('SELECT id, title, content FROM notes WHERE id = $1 AND user_id = $2', [noteId, userId])
  return note
}
// Aliases keep the client's note shape: _id, title, content, updatedAt
const cols = 'id AS "_id", title, content, updated_at AS "updatedAt"'

const app = express()
app.use(express.json({ limit: '1mb' }))
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next)

// ---------- Authentication ----------
const sign = (user) => jwt.sign({ sub: user.id, username: user.username }, SECRET, { expiresIn: '7d' })

const credentials = (req, res, next) => {
  const { username, password } = req.body || {}
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.@+-]{3,60}$/.test(username))
    return res.status(400).json({ error: 'Use 3-60 characters: letters, numbers or . _ @ + -' })
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return res.status(400).json({ error: 'Password must be 6-72 characters' })
  next()
}

app.post('/api/auth/register', credentials, wrap(async (req, res) => {
  const { username, password } = req.body
  try {
    const [user] = await query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, await bcrypt.hash(password, 10)]
    )
    res.status(201).json({ token: sign(user), username: user.username })
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' })
    throw e
  }
}))

app.post('/api/auth/login', credentials, wrap(async (req, res) => {
  const { username, password } = req.body
  const [user] = await query('SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)', [username])
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Invalid username or password' })
  res.json({ token: sign(user), username: user.username })
}))

app.get('/api/auth/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }))

app.post('/api/auth/google', wrap(async (req, res) => {
  if (!googleClient) return res.status(501).json({ error: 'Google sign-in is not configured' })
  let payload
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body?.credential, audience: GOOGLE_CLIENT_ID })
    payload = ticket.getPayload()
  } catch {
    return res.status(401).json({ error: 'Invalid Google credential' })
  }
  if (!payload.email_verified) return res.status(401).json({ error: 'Google email is not verified' })

  let [user] = await query('SELECT id, username FROM users WHERE google_id = $1', [payload.sub])
  if (!user) {
    const base = (payload.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'user').slice(0, 24)
    let username = base
    for (let i = 1; (await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])).length; i++) username = `${base}${i}`
    ;[user] = await query(
      'INSERT INTO users (username, google_id, email) VALUES ($1, $2, $3) RETURNING id, username',
      [username, payload.sub, payload.email]
    )
  }
  res.json({ token: sign(user), username: user.username })
}))

// ---------- Authorization: every /api/notes route requires a valid token ----------
const requireAuth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  try {
    req.userId = jwt.verify(token, SECRET).sub
    next()
  } catch {
    res.status(401).json({ error: 'Please log in' })
  }
}
app.use('/api/notes', requireAuth)

// Every query is scoped to req.userId, so users can only touch their own notes
app.get('/api/notes', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  res.json(
    await query(
      `SELECT ${cols} FROM notes WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2) ORDER BY updated_at DESC, id DESC`,
      [req.userId, q]
    )
  )
}))

app.post('/api/notes', wrap(async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const [note] = await query(
    `INSERT INTO notes (user_id, title, content) VALUES ($1, $2, $3) RETURNING ${cols}`,
    [req.userId, String(title), String(content)]
  )
  res.status(201).json(note)
}))

app.put('/api/notes/:id', wrap(async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const existing = await ownNote(req.params.id, req.userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.title !== String(title) || existing.content !== String(content)) {
    await snapshot(existing)
    await query('UPDATE notes SET title = $1, content = $2, updated_at = now() WHERE id = $3', [String(title), String(content), existing.id])
  }
  const [note] = await query(`SELECT ${cols} FROM notes WHERE id = $1`, [existing.id])
  res.json(note)
}))

app.get('/api/notes/:id/history', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json(await query('SELECT id, title, content, created_at AS "createdAt" FROM note_versions WHERE note_id = $1 ORDER BY id DESC', [note.id]))
}))

app.post('/api/notes/:id/restore/:versionId', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  const versionId = asId(req.params.versionId)
  const [version] = note && versionId !== null
    ? await query('SELECT title, content FROM note_versions WHERE id = $1 AND note_id = $2', [versionId, note.id])
    : []
  if (!version) return res.status(404).json({ error: 'Not found' })
  await snapshot(note, true)
  await query('UPDATE notes SET title = $1, content = $2, updated_at = now() WHERE id = $3', [version.title, version.content, note.id])
  const [restored] = await query(`SELECT ${cols} FROM notes WHERE id = $1`, [note.id])
  res.json(restored)
}))

app.delete('/api/notes/:id', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  await query('DELETE FROM notes WHERE id = $1', [note.id]) // versions cascade
  res.json({ ok: true })
}))

// Serve the built React app in production
const dist = path.join(here, '../client/dist')
app.use(express.static(dist))
app.get('*', (req, res, next) =>
  req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html'), (err) => err && next())
)

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})

const port = process.env.PORT || 5000
app.listen(port, () => console.log(`Server on http://localhost:${port}`))
