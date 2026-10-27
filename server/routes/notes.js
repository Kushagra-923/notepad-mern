import { Router } from 'express'
import { query } from '../db.js'
import { wrap, validateNote } from '../middleware.js'

// Save the state a note had before an edit, credited to whoever wrote that state.
// Throttled so autosave doesn't create hundreds of versions.
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

const asId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null)

// Aliases give the client its note shape
const SELECT_NOTE = `
  SELECT n.id AS "_id", n.title, n.content, n.version, n.updated_at AS "updatedAt", uu.username AS "updatedBy"
  FROM notes n LEFT JOIN users uu ON uu.id = n.updated_by`
const getNote = async (id) => (await query(`${SELECT_NOTE} WHERE n.id = $1`, [id]))[0]

const ownNote = async (id, userId) => {
  const noteId = asId(id)
  if (noteId === null) return null
  const [note] = await query('SELECT id, title, content, version, updated_by FROM notes WHERE id = $1 AND owner_id = $2', [noteId, userId])
  return note
}

const router = Router()

// Every query is scoped to req.userId, so users can only touch their own notes
router.get('/', wrap(async (req, res) => {
  const q = `%${String(req.query.q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  res.json(
    await query(
      `${SELECT_NOTE} WHERE n.owner_id = $1 AND (n.title ILIKE $2 OR n.content ILIKE $2) ORDER BY n.updated_at DESC, n.id DESC`,
      [req.userId, q]
    )
  )
}))

router.post('/', validateNote, wrap(async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body
  const [{ id }] = await query(
    'INSERT INTO notes (owner_id, updated_by, title, content) VALUES ($1, $1, $2, $3) RETURNING id',
    [req.userId, title, content]
  )
  res.status(201).json(await getNote(id))
}))

router.get('/:id', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json(await getNote(note.id))
}))

// Saving requires the version the client last saw. If someone else saved in between, the
// stale write is rejected with 409 and the current note, so nothing is silently overwritten.
router.put('/:id', validateNote, wrap(async (req, res) => {
  const { title = 'Untitled', content = '', version } = req.body
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version is required' })
  const existing = await ownNote(req.params.id, req.userId)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const conflict = async () => res.status(409).json({ error: 'This note was changed by someone else', current: await getNote(existing.id) })
  if (existing.version !== version) return conflict()
  if (existing.title === title && existing.content === content) return res.json(await getNote(existing.id))

  await snapshot(existing)
  const updated = await query(
    'UPDATE notes SET title = $1, content = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $4 AND version = $5 RETURNING id',
    [title, content, req.userId, existing.id, version]
  )
  if (!updated.length) return conflict() // lost a race with a concurrent save
  res.json(await getNote(existing.id))
}))

router.get('/:id/history', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json(
    await query(
      `SELECT v.id, v.title, v.content, v.created_at AS "createdAt", u.username AS "editedBy"
       FROM note_versions v LEFT JOIN users u ON u.id = v.edited_by WHERE v.note_id = $1 ORDER BY v.id DESC`,
      [note.id]
    )
  )
}))

router.post('/:id/restore/:versionId', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  const versionId = asId(req.params.versionId)
  const [version] = note && versionId !== null
    ? await query('SELECT title, content FROM note_versions WHERE id = $1 AND note_id = $2', [versionId, note.id])
    : []
  if (!version) return res.status(404).json({ error: 'Not found' })
  await snapshot(note, true)
  await query(
    'UPDATE notes SET title = $1, content = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $4',
    [version.title, version.content, req.userId, note.id]
  )
  res.json(await getNote(note.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const note = await ownNote(req.params.id, req.userId)
  if (!note) return res.status(404).json({ error: 'Not found' })
  await query('DELETE FROM notes WHERE id = $1', [note.id]) // versions cascade
  res.json({ ok: true })
}))

export default router
