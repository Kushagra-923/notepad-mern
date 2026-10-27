import jwt from 'jsonwebtoken'
import { query } from './db.js'

export const SECRET = process.env.JWT_SECRET

// Express 4 does not catch rejected promises from async handlers
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next)

export const sign = (user) => jwt.sign({ sub: user.id, username: user.username }, SECRET, { expiresIn: '7d' })

// A valid signature is not enough: the account must still exist. After a database reset or restore,
// old tokens would otherwise pass and then fail on foreign keys. They get a 401 so the client signs out.
export const requireAuth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  let payload
  try {
    payload = jwt.verify(token, SECRET)
  } catch {
    return res.status(401).json({ error: 'Please log in' })
  }
  const [user] = await query('SELECT id, username FROM users WHERE id = $1', [payload.sub])
  if (!user) return res.status(401).json({ error: 'Please log in' })
  req.userId = user.id
  req.username = user.username
  next()
})

export const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' })
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
  console.error(err)
  res.status(500).json({ error: 'Server error' })
}

export const LIMITS = { title: 200, content: 200_000 }

export const validateNote = (req, res, next) => {
  const { title = 'Untitled', content = '' } = req.body || {}
  if (typeof title !== 'string' || typeof content !== 'string')
    return res.status(400).json({ error: 'Title and content must be text' })
  if (title.length > LIMITS.title) return res.status(400).json({ error: `Title is too long (max ${LIMITS.title} characters)` })
  if (content.length > LIMITS.content) return res.status(400).json({ error: `Note is too long (max ${LIMITS.content} characters)` })
  next()
}
