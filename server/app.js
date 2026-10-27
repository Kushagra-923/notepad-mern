import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.js'
import noteRoutes from './routes/notes.js'
import teamRoutes from './routes/teams.js'
import { requireAuth, errorHandler } from './middleware.js'

export function createApp({ authLimit = Number(process.env.AUTH_RATE_LIMIT) || 20 } = {}) {
  const app = express()
  app.set('trust proxy', 1) // behind Render's proxy: use the real client IP for rate limiting
  app.use(express.json({ limit: '1mb' }))

  // Slow down password guessing: failed and successful attempts both count
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again in a few minutes.' },
  })
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }))

  app.use('/api/auth', authRoutes)
  app.use('/api/notes', requireAuth, noteRoutes)
  app.use('/api/teams', requireAuth, teamRoutes)

  // Serve the built React app in production
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')
  app.use(express.static(dist))
  app.get('*', (req, res, next) =>
    req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html'), (err) => err && next())
  )

  app.use(errorHandler)
  return app
}
