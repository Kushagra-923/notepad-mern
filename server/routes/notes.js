import { Router } from 'express'
import { query } from '../db.js'
import { wrap, validateNote } from '../middleware.js'
import { withNote, noteSelect, getNoteFor, VISIBLE, asId } from '../access.js'

// Save the state a note had before an edit, credited to whoever wrote that state.
// Throttled so one person's autosave doesn't create hundreds of versions, but never throttled
// when a different person is overwriting (see callers): that work must stay recoverable and credited.
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
  await query('INSERT INTO note_versions (note_id, title, content, edited_by) VALUES ($1, $2, $3, $4)', [
    note.id, note.title, note.content, note.updated_by,
  ])
  await query(
    'DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (SELECT id FROM note_versions WHERE note_id = $1 ORDER BY id DESC LIMIT $2)',
    [note.id, MAX_VERSIONS]
  )
}

const router = Router()

// scope: all (default) | mine | shared (shared with me individually) | team:<id>
const scopeClause = (scope) => {
  if (scope === 'mine') return { sql: 'n.owner_id = $1', params: [] }
  if (scope === 'shared') return { sql: 'n.owner_id <> $1 AND s.user_id IS NOT NULL', params: [] }
  const team = /^team:(\d{1,9})$/.exec(scope || '')
  if (team) return { sql: 'n.team_id = $3 AND tm.user_id IS NOT NULL', params: [Number(team[1])] }
  return { sql: VISIBLE, params: [] }
}

router.get('/', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  const { sql, params } = scopeClause(req.query.scope)
  res.json(
    await query(
      `${noteSelect(false)} WHERE ${sql} AND (n.title ILIKE $2 OR n.content ILIKE $2) ORDER BY n.updated_at DESC, n.id DESC`,
      [req.userId, q, ...params]
    )
  )
}))

router.post('/', validateNote, wrap(async (req, res) => {
  const { title = 'Untitled', content = '', teamId = null } = req.body
  if (teamId !== null) {
    const id = asId(teamId)
    const [member] = id === null ? [] : await query('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [id, req.userId])
    if (!member) return res.status(403).json({ error: 'You are not a member of that team' })
  }
  const [{ id }] = await query(
    'INSERT INTO notes (owner_id, updated_by, title, content, team_id) VALUES ($1, $1, $2, $3, $4) RETURNING id',
    [req.userId, title, content, teamId]
  )
  res.status(201).json(await getNoteFor(id, req.userId))
}))

router.get('/:id', withNote('viewer'), wrap(async (req, res) => {
  res.json(await getNoteFor(req.note.id, req.userId))
}))

// Saving requires the version the client last saw. If someone else saved in between, the
// stale write is rejected with 409 and the current note, so nothing is silently overwritten.
router.put('/:id', validateNote, withNote('editor'), wrap(async (req, res) => {
  const { title = 'Untitled', content = '', version } = req.body
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version is required' })
  const existing = req.note

  const conflict = async () =>
    res.status(409).json({ error: 'This note was changed by someone else', current: await getNoteFor(existing.id, req.userId) })
  if (existing.version !== version) return conflict()
  if (existing.title === title && existing.content === content) return res.json(await getNoteFor(existing.id, req.userId))

  await snapshot(existing, existing.updated_by !== req.userId)
  const updated = await query(
    'UPDATE notes SET title = $1, content = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $4 AND version = $5 RETURNING id',
    [title, content, req.userId, existing.id, version]
  )
  if (!updated.length) return conflict() // lost a race with a concurrent save
  res.json(await getNoteFor(existing.id, req.userId))
}))

router.get('/:id/history', withNote('viewer'), wrap(async (req, res) => {
  res.json(
    await query(
      `SELECT v.id, v.title, v.content, v.created_at AS "createdAt", u.username AS "editedBy"
       FROM note_versions v LEFT JOIN users u ON u.id = v.edited_by WHERE v.note_id = $1 ORDER BY v.id DESC`,
      [req.note.id]
    )
  )
}))

router.post('/:id/restore/:versionId', withNote('editor'), wrap(async (req, res) => {
  const versionId = /^\d{1,9}$/.test(req.params.versionId) ? Number(req.params.versionId) : null
  const [version] = versionId === null
    ? []
    : await query('SELECT title, content FROM note_versions WHERE id = $1 AND note_id = $2', [versionId, req.note.id])
  if (!version) return res.status(404).json({ error: 'Not found' })
  await snapshot(req.note, true)
  await query(
    'UPDATE notes SET title = $1, content = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $4',
    [version.title, version.content, req.userId, req.note.id]
  )
  res.json(await getNoteFor(req.note.id, req.userId))
}))

router.delete('/:id', withNote('owner'), wrap(async (req, res) => {
  await query('DELETE FROM notes WHERE id = $1', [req.note.id]) // versions and shares cascade
  res.json({ ok: true })
}))

// Move a note into one of your teams, or back to personal (teamId: null)
router.put('/:id/team', withNote('owner'), wrap(async (req, res) => {
  const { teamId = null } = req.body || {}
  if (teamId !== null) {
    const id = asId(teamId)
    const [member] = id === null ? [] : await query('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [id, req.userId])
    if (!member) return res.status(403).json({ error: 'You are not a member of that team' })
  }
  await query('UPDATE notes SET team_id = $1 WHERE id = $2', [teamId, req.note.id])
  res.json(await getNoteFor(req.note.id, req.userId))
}))

// ---------- Sharing (owner manages; a collaborator may remove themselves) ----------
router.get('/:id/shares', withNote('owner'), wrap(async (req, res) => {
  res.json(
    await query(
      'SELECT s.user_id AS "userId", u.username, s.role FROM note_shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = $1 ORDER BY u.username',
      [req.note.id]
    )
  )
}))

router.post('/:id/shares', withNote('owner'), wrap(async (req, res) => {
  const { username, role } = req.body || {}
  if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ error: 'Enter a username' })
  if (!['viewer', 'editor'].includes(role)) return res.status(400).json({ error: 'Role must be viewer or editor' })
  const [target] = await query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username.trim()])
  if (!target) return res.status(404).json({ error: `No user named "${username.trim()}"` })
  if (target.id === req.userId) return res.status(400).json({ error: "You already own this note" })
  await query(
    `INSERT INTO note_shares (note_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (note_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [req.note.id, target.id, role]
  )
  res.status(201).json({ userId: target.id, username: target.username, role })
}))

router.delete('/:id/shares/:userId', withNote('viewer'), wrap(async (req, res) => {
  const targetId = Number(req.params.userId)
  if (req.role !== 'owner' && targetId !== req.userId) return res.status(403).json({ error: 'Only the owner can remove other people' })
  const removed = await query('DELETE FROM note_shares WHERE note_id = $1 AND user_id = $2 RETURNING user_id', [req.note.id, targetId])
  if (!removed.length) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
}))

export default router
