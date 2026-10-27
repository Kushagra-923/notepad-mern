import { query } from './db.js'
import { wrap } from './middleware.js'

// owner > editor > viewer. Everything that touches a note goes through withNote().
export const RANK = { viewer: 1, editor: 2, owner: 3 }

export const asId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null)

// The shape sent to clients. $1 is always the requesting user's id.
// `full` includes the whole content; the list view only needs a short preview.
export const noteSelect = (full = true) => `
  SELECT n.id AS "_id", n.title, ${full ? 'n.content' : 'left(n.content, 200) AS preview'}, n.version,
         n.updated_at AS "updatedAt", uu.username AS "updatedBy", ou.username AS "ownerName",
         CASE WHEN n.owner_id = $1 THEN 'owner' ELSE s.role END AS role
  FROM notes n
  JOIN users ou ON ou.id = n.owner_id
  LEFT JOIN users uu ON uu.id = n.updated_by
  LEFT JOIN note_shares s ON s.note_id = n.id AND s.user_id = $1`

export const getNoteFor = async (noteId, userId) => (await query(`${noteSelect()} WHERE n.id = $2`, [userId, noteId]))[0]

export async function getAccess(noteId, userId) {
  const [row] = await query(
    `SELECT n.id, n.title, n.content, n.version, n.updated_by, n.owner_id, s.role AS share_role
     FROM notes n LEFT JOIN note_shares s ON s.note_id = n.id AND s.user_id = $2
     WHERE n.id = $1`,
    [noteId, userId]
  )
  if (!row) return null
  const role = row.owner_id === userId ? 'owner' : row.share_role
  return role ? { note: row, role } : null
}

// Route guard. No access at all -> 404 (don't reveal the note exists); not enough access -> 403.
export const withNote = (minRole = 'viewer') =>
  wrap(async (req, res, next) => {
    const id = asId(req.params.id)
    const access = id === null ? null : await getAccess(id, req.userId)
    if (!access) return res.status(404).json({ error: 'Not found' })
    if (RANK[access.role] < RANK[minRole]) {
      const action = { editor: 'edit this note', owner: 'do that. Only the owner can' }[minRole]
      return res.status(403).json({ error: `You don't have permission to ${action}` })
    }
    req.note = access.note
    req.role = access.role
    next()
  })
