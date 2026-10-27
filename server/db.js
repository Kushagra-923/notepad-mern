import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Replaced by initDb(). Always resolves to an array of rows.
export let query = async () => {
  throw new Error('Database not initialised: call initDb() first')
}

// Production: Postgres via DATABASE_URL (e.g. Neon).
// Without it: PGlite, an embedded Postgres stored in ./data (or in memory with PGLITE_DIR=memory://).
export async function initDb(statements) {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    pool.on('error', (e) => console.error('Idle database client error:', e.message))
    query = async (text, params) => (await pool.query(text, params)).rows
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = process.env.PGLITE_DIR || path.join(here, '../data/pgdata')
    if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true }) // PGlite does not create parent folders
    const lite = new PGlite(dir)
    await lite.waitReady
    query = async (text, params) => (await lite.query(text, params)).rows
  }
  for (const statement of statements) await query(statement)
}
