import { query } from './db.js'
import { wrap } from './middleware.js'

// owner > editor > viewer. Everything that touches a note goes through withNote().
//
// A user's role on a note is the highest of:
//   - owner:   they created it, or they own the team the note belongs to
//   - editor:  they are a member of the note's team, or it was shared with them as an editor
//   - viewer:  it was shared with them as a viewer
export const RANK = { viewer: 1, editor: 2, owner: 3 }

export const asId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null)

// SQL for the role, given the joined aliases n (notes), s (note_shares) and tm (team_members for the user)
const ROLE_SQL = `CASE
    WHEN n.owner_id = $1 OR tm.role = 'owner' THEN 'owner'
    WHEN tm.user_id IS NOT NULL OR s.role = 'editor' THEN 'editor'
    ELSE s.role
  END`

const JOINS = `
  FROM notes n
  JOIN users ou ON ou.id = n.owner_id
  LEFT JOIN users uu ON uu.id = n.updated_by
  LEFT JOIN note_shares s ON s.note_id = n.id AND s.user_id = $1
  LEFT JOIN team_members tm ON tm.team_id = n.team_id AND tm.user_id = $1
  LEFT JOIN teams t ON t.id = n.team_id`

export const VISIBLE = '(n.owner_id = $1 OR s.user_id IS NOT NULL OR tm.user_id IS NOT NULL)'

// The shape sent to clients. $1 is always the requesting user's id.
// `full` includes the whole content; the list view only needs a short preview.
export const noteSelect = (full = true) => `
  SELECT n.id AS "_id", n.title, ${full ? 'n.content' : 'left(n.content_text, 200) AS preview'}, n.version,
         n.updated_at AS "updatedAt", uu.username AS "updatedBy", ou.username AS "ownerName",
         n.team_id AS "teamId", t.name AS "teamName", ${ROLE_SQL} AS role
  ${JOINS}`

export const getNoteFor = async (noteId, userId) => (await query(`${noteSelect()} WHERE n.id = $2`, [userId, noteId]))[0]

export async function getAccess(noteId, userId) {
  const [row] = await query(
    `SELECT n.id, n.title, n.content, n.version, n.updated_by, n.owner_id, n.team_id, ${ROLE_SQL} AS role
     ${JOINS}
     WHERE n.id = $2 AND ${VISIBLE}`,
    [userId, noteId]
  )
  return row ? { note: row, role: row.role } : null
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

// Team guard: not a member -> 404; member without enough rights -> 403
export const withTeam = (minRole = 'member') =>
  wrap(async (req, res, next) => {
    const id = asId(req.params.id)
    const [team] = id === null ? [] : await query(
      `SELECT t.id, t.name, t.owner_id, tm.role FROM teams t JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $2 WHERE t.id = $1`,
      [id, req.userId]
    )
    if (!team) return res.status(404).json({ error: 'Not found' })
    if (minRole === 'owner' && team.role !== 'owner') return res.status(403).json({ error: 'Only the team owner can do that' })
    req.team = team
    next()
  })
