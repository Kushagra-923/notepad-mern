import jwt from 'jsonwebtoken'

export const SECRET = process.env.JWT_SECRET

// Express 4 does not catch rejected promises from async handlers
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next)

export const sign = (user) => jwt.sign({ sub: user.id, username: user.username }, SECRET, { expiresIn: '7d' })

export const requireAuth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  try {
    const payload = jwt.verify(token, SECRET)
    req.userId = payload.sub
    req.username = payload.username
    next()
  } catch {
    res.status(401).json({ error: 'Please log in' })
  }
}

export const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' })
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
  console.error(err)
  res.status(500).json({ error: 'Server error' })
}
