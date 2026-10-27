import { Router } from 'express'
import { query } from '../db.js'
import { wrap } from '../middleware.js'

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
  const [note] = await query('SELECT id, title, content FROM notes WHERE id = $1 AND owner_id = $2', [noteId, userId])
  return note
}
// Aliases keep the client's note shape: _id, title, content, updatedAt
const cols = 'id AS "_id", title, content, updated_at AS "updatedAt"'

const router = Router()

// Every query is scoped to req.userId, so users can only touch their own notes
router.get('/', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  res.json(
    await query(
      `SELECT ${cols} FROM notes WHERE owner_id = $1 AND (title ILIKE $2 OR content ILIKE $2) ORDER BY updated_at DESC, id DESC`,
      [req.userId, q]
    )
  )
}))

router.post('/', wrap(async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const [note] = await query(
    `INSERT INTO notes (owner_id, title, content) VALUES ($1, $2, $3) RETURNING ${cols}`,
    [req.userId, String(title), String(content)]
  )
  res.status(201).json(note)
}))

router.put('/:id', wrap(async (req, res) => {
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

router.get('/:id/history', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json(await query('SELECT id, title, content, created_at AS "createdAt" FROM note_versions WHERE note_id = $1 ORDER BY id DESC', [note.id]))
}))

router.post('/:id/restore/:versionId', wrap(async (req, res) => {
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

router.delete('/:id', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  await query('DELETE FROM notes WHERE id = $1', [note.id]) // versions cascade
  res.json({ ok: true })
}))

export default router
