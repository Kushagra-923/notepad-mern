import 'dotenv/config'

const secret = process.env.JWT_SECRET
if (!secret || secret.length < 16) {
  console.error('Set JWT_SECRET (16+ chars) in .env')
  process.exit(1)
}

// Imported after the env check because middleware reads JWT_SECRET at load time
const { initDb } = await import('./db.js')
const { schema } = await import('./schema.js')
const { createApp } = await import('./app.js')

await initDb(schema)
const port = process.env.PORT || 5000
createApp().listen(port, () => console.log(`Server on http://localhost:${port}`))
