import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import authRoutes from './routes/auth.js'
import noteRoutes from './routes/notes.js'
import { requireAuth, errorHandler } from './middleware.js'

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.use('/api/auth', authRoutes)
  app.use('/api/notes', requireAuth, noteRoutes)

  // Serve the built React app in production
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')
  app.use(express.static(dist))
  app.get('*', (req, res, next) =>
    req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html'), (err) => err && next())
  )

  app.use(errorHandler)
  return app
}
