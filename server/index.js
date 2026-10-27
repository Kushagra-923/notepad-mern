import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'
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
const dbFile = process.env.DB_FILE || path.join(here, 'notes.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

const db = new DatabaseSync(dbFile)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL
  )
`)
// Google sign-in columns (added after the first release)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'googleId')) {
  db.exec('ALTER TABLE users ADD COLUMN googleId TEXT')
  db.exec('ALTER TABLE users ADD COLUMN email TEXT')
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_googleId ON users(googleId)')

// Early versions had no owner column; those notes belonged to nobody, so start fresh
if (!db.prepare('PRAGMA table_info(notes)').all().some((c) => c.name === 'userId')) {
  db.exec('DROP TABLE IF EXISTS notes')
}
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noteId INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)

// Save the state a note had before an edit. Throttled so autosave doesn't create hundreds of versions.
const MIN_GAP_SECONDS = 30
const MAX_VERSIONS = 50
const snapshot = (note, force = false) => {
  if (note.title === 'Untitled' && !note.content) return
  const last = db
    .prepare("SELECT title, content, strftime('%s','now') - strftime('%s', createdAt) AS age FROM note_versions WHERE noteId = ? ORDER BY id DESC LIMIT 1")
    .get(note.id)
  if (last && last.title === note.title && last.content === note.content) return
  if (!force && last && last.age < MIN_GAP_SECONDS) return
  db.prepare('INSERT INTO note_versions (noteId, title, content) VALUES (?, ?, ?)').run(note.id, note.title, note.content)
  db.prepare('DELETE FROM note_versions WHERE noteId = ? AND id NOT IN (SELECT id FROM note_versions WHERE noteId = ? ORDER BY id DESC LIMIT ?)')
    .run(note.id, note.id, MAX_VERSIONS)
}
const ownNote = (id, userId) => db.prepare('SELECT id, title, content FROM notes WHERE id = ? AND userId = ?').get(id, userId)

// "id AS _id" keeps the client's note shape unchanged
const cols = 'id AS _id, title, content, updatedAt'
const app = express()
app.use(express.json({ limit: '1mb' }))

// ---------- Authentication ----------
const sign = (user) =>
  jwt.sign({ sub: user.id, username: user.username }, SECRET, { expiresIn: '7d' })

const credentials = (req, res, next) => {
  const { username, password } = req.body || {}
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.@+-]{3,60}$/.test(username))
    return res.status(400).json({ error: 'Use 3-60 characters: letters, numbers or . _ @ + -' })
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return res.status(400).json({ error: 'Password must be 6-72 characters' })
  next()
}

app.post('/api/auth/register', credentials, (req, res) => {
  const { username, password } = req.body
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
    return res.status(409).json({ error: 'Username already taken' })
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, passwordHash) VALUES (?, ?)')
    .run(username, bcrypt.hashSync(password, 10))
  const user = { id: Number(lastInsertRowid), username }
  res.status(201).json({ token: sign(user), username })
})

app.post('/api/auth/login', credentials, (req, res) => {
  const { username, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: 'Invalid username or password' })
  res.json({ token: sign(user), username: user.username })
})

app.get('/api/auth/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }))

app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) return res.status(501).json({ error: 'Google sign-in is not configured' })
  let payload
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body?.credential, audience: GOOGLE_CLIENT_ID })
    payload = ticket.getPayload()
  } catch {
    return res.status(401).json({ error: 'Invalid Google credential' })
  }
  if (!payload.email_verified) return res.status(401).json({ error: 'Google email is not verified' })

  let user = db.prepare('SELECT * FROM users WHERE googleId = ?').get(payload.sub)
  if (!user) {
    const base = (payload.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'user').slice(0, 24)
    let username = base
    for (let i = 1; db.prepare('SELECT 1 FROM users WHERE username = ?').get(username); i++) username = `${base}${i}`
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (username, passwordHash, googleId, email) VALUES (?, '', ?, ?)")
      .run(username, payload.sub, payload.email)
    user = { id: Number(lastInsertRowid), username }
  }
  res.json({ token: sign(user), username: user.username })
})

// ---------- Authorization: every /api/notes route requires a valid token ----------
const requireAuth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  try {
    const payload = jwt.verify(token, SECRET)
    req.userId = payload.sub
    next()
  } catch {
    res.status(401).json({ error: 'Please log in' })
  }
}
app.use('/api/notes', requireAuth)

// Every query is scoped to req.userId, so users can only touch their own notes
app.get('/api/notes', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`
  res.json(
    db
      .prepare(`SELECT ${cols} FROM notes WHERE userId = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updatedAt DESC, id DESC`)
      .all(req.userId, q, q)
  )
})

app.post('/api/notes', (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notes (userId, title, content) VALUES (?, ?, ?)')
    .run(req.userId, String(title), String(content))
  res.status(201).json(db.prepare(`SELECT ${cols} FROM notes WHERE id = ?`).get(lastInsertRowid))
})

app.put('/api/notes/:id', (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const existing = ownNote(req.params.id, req.userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.title !== String(title) || existing.content !== String(content)) {
    snapshot(existing)
    db.prepare('UPDATE notes SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(String(title), String(content), existing.id)
  }
  res.json(db.prepare(`SELECT ${cols} FROM notes WHERE id = ?`).get(existing.id))
})

app.get('/api/notes/:id/history', (req, res) => {
  const note = ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json(db.prepare('SELECT id, title, content, createdAt FROM note_versions WHERE noteId = ? ORDER BY id DESC').all(note.id))
})

app.post('/api/notes/:id/restore/:versionId', (req, res) => {
  const note = ownNote(req.params.id, req.userId)
  const version = note && db.prepare('SELECT title, content FROM note_versions WHERE id = ? AND noteId = ?').get(req.params.versionId, note.id)
  if (!version) return res.status(404).json({ error: 'Not found' })
  snapshot(note, true)
  db.prepare('UPDATE notes SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(version.title, version.content, note.id)
  res.json(db.prepare(`SELECT ${cols} FROM notes WHERE id = ?`).get(note.id))
})

app.delete('/api/notes/:id', (req, res) => {
  db.prepare('DELETE FROM note_versions WHERE noteId IN (SELECT id FROM notes WHERE id = ? AND userId = ?)').run(req.params.id, req.userId)
  const { changes } = db.prepare('DELETE FROM notes WHERE id = ? AND userId = ?').run(req.params.id, req.userId)
  changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' })
})

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
