import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { query } from '../db.js'
import { wrap, sign } from '../middleware.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

const credentials = (req, res, next) => {
  const { username, password } = req.body || {}
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.@+-]{3,60}$/.test(username))
    return res.status(400).json({ error: 'Use 3-60 characters: letters, numbers or . _ @ + -' })
  if (typeof password !== 'string' || password.length < 6 || password.length > 72)
    return res.status(400).json({ error: 'Password must be 6-72 characters' })
  next()
}

const router = Router()

router.post('/register', credentials, wrap(async (req, res) => {
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

router.post('/login', credentials, wrap(async (req, res) => {
  const { username, password } = req.body
  const [user] = await query('SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)', [username])
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Invalid username or password' })
  res.json({ token: sign(user), username: user.username })
}))

router.get('/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }))

router.post('/google', wrap(async (req, res) => {
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

export default router
