import { Router } from 'express'
import { query } from '../db.js'
import { wrap } from '../middleware.js'
import { withTeam } from '../access.js'

const router = Router()

// Teams the user belongs to, with their members
router.get('/', wrap(async (req, res) => {
  const teams = await query(
    `SELECT t.id, t.name, tm.role,
            (SELECT count(*)::int FROM notes n WHERE n.team_id = t.id) AS "noteCount"
     FROM teams t JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
     ORDER BY t.name`,
    [req.userId]
  )
  const members = teams.length
    ? await query(
        `SELECT tm.team_id AS "teamId", tm.user_id AS "userId", u.username, tm.role
         FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ANY($1::int[]) ORDER BY tm.role DESC, u.username`,
        [teams.map((t) => t.id)]
      )
    : []
  res.json(teams.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id) })))
}))

router.post('/', wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'Give the team a name' })
  if (name.length > 60) return res.status(400).json({ error: 'Team name is too long (max 60 characters)' })
  const [team] = await query('INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id, name', [name, req.userId])
  await query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [team.id, req.userId])
  res.status(201).json({ ...team, role: 'owner' })
}))

router.post('/:id/members', withTeam('owner'), wrap(async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  if (!username) return res.status(400).json({ error: 'Enter a username' })
  const [user] = await query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username])
  if (!user) return res.status(404).json({ error: `No user named "${username}"` })
  const added = await query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING RETURNING user_id",
    [req.team.id, user.id]
  )
  if (!added.length) return res.status(409).json({ error: `${user.username} is already in this team` })
  res.status(201).json({ userId: user.id, username: user.username, role: 'member' })
}))

// The owner can remove anyone; a member can remove themselves (leave). The owner must delete the team instead.
router.delete('/:id/members/:userId', withTeam('member'), wrap(async (req, res) => {
  const targetId = Number(req.params.userId)
  if (req.team.role !== 'owner' && targetId !== req.userId) return res.status(403).json({ error: 'Only the team owner can remove other members' })
  if (targetId === req.team.owner_id) return res.status(400).json({ error: 'The owner cannot leave. Delete the team instead.' })
  const removed = await query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING user_id', [req.team.id, targetId])
  if (!removed.length) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
}))

router.delete('/:id', withTeam('owner'), wrap(async (req, res) => {
  await query('DELETE FROM teams WHERE id = $1', [req.team.id]) // members cascade, notes become personal
  res.json({ ok: true })
}))

export default router
