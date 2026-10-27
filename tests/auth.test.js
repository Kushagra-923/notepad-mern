import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, signup } from './helpers.js'

let s
before(async () => { s = await startServer() })
after(() => s.close())

test('registers, logs in case-insensitively, and rejects wrong passwords', async () => {
  await signup(s.call, 'Dana@Example.com')
  const ok = await s.call('POST', '/api/auth/login', { body: { username: 'dana@example.com', password: 'secret1' } })
  assert.equal(ok.status, 200)
  assert.ok(ok.body.token)
  const bad = await s.call('POST', '/api/auth/login', { body: { username: 'dana@example.com', password: 'wrong-one' } })
  assert.equal(bad.status, 401)
})

test('rejects duplicate usernames regardless of case', async () => {
  await signup(s.call, 'taken')
  const dup = await s.call('POST', '/api/auth/register', { body: { username: 'TAKEN', password: 'secret1' } })
  assert.equal(dup.status, 409)
})

test('validates username and password', async () => {
  const shortPw = await s.call('POST', '/api/auth/register', { body: { username: 'someone', password: '123' } })
  assert.equal(shortPw.status, 400)
  const badName = await s.call('POST', '/api/auth/register', { body: { username: 'has space!', password: 'secret1' } })
  assert.equal(badName.status, 400)
})

test('stores passwords hashed, never in plain text', async () => {
  const { query } = await import('../server/db.js')
  await signup(s.call, 'hashcheck')
  const [row] = await query("SELECT password_hash FROM users WHERE username = 'hashcheck'")
  assert.notEqual(row.password_hash, 'secret1')
  assert.match(row.password_hash, /^\$2[aby]\$/)
})

test('notes API requires a valid token', async () => {
  assert.equal((await s.call('GET', '/api/notes')).status, 401)
  assert.equal((await s.call('GET', '/api/notes', { token: 'garbage' })).status, 401)
})

test('login is rate limited', async () => {
  const limited = await startServer({ authLimit: 3 })
  const codes = []
  for (let i = 0; i < 5; i++) {
    codes.push((await limited.call('POST', '/api/auth/login', { body: { username: 'nobody', password: 'secret1' } })).status)
  }
  await limited.close()
  assert.deepEqual(codes, [401, 401, 401, 429, 429])
})

test('unknown API routes return JSON 404', async () => {
  const res = await s.call('GET', '/api/does-not-exist')
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'Not found')
})
