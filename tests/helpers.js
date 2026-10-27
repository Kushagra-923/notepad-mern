import { once } from 'node:events'

// Each test file runs in its own process with a throwaway in-memory Postgres
process.env.JWT_SECRET ||= 'test-secret-test-secret'
process.env.PGLITE_DIR = 'memory://'
delete process.env.DATABASE_URL

const { initDb } = await import('../server/db.js')
const { schema } = await import('../server/schema.js')
const { createApp } = await import('../server/app.js')
await initDb(schema)

export async function startServer(options = { authLimit: 1000 }) {
  const server = createApp(options).listen(0)
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, url, { token, body, raw } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  return { base, call, close: () => new Promise((r) => server.close(r)) }
}

let counter = 0
export async function signup(call, name = `user${++counter}`) {
  const { status, body } = await call('POST', '/api/auth/register', { body: { username: name, password: 'secret1' } })
  if (status !== 201) throw new Error(`signup failed: ${status} ${JSON.stringify(body)}`)
  return { token: body.token, username: name }
}
