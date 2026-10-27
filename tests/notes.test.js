import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, signup } from './helpers.js'

let s, alice, bob
before(async () => {
  s = await startServer()
  alice = await signup(s.call, 'alice')
  bob = await signup(s.call, 'bob')
})
after(() => s.close())

test('creates, lists, edits and deletes a note', async () => {
  const created = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'Plan', content: 'first' } })
  assert.equal(created.status, 201)
  const id = created.body._id
  const edited = await s.call('PUT', `/api/notes/${id}`, { token: alice.token, body: { title: 'Plan', content: 'second', version: created.body.version } })
  assert.equal(edited.body.content, 'second')
  const list = await s.call('GET', '/api/notes?q=SECOND', { token: alice.token })
  assert.equal(list.body.length, 1)
  assert.equal((await s.call('DELETE', `/api/notes/${id}`, { token: alice.token })).status, 200)
  assert.equal((await s.call('GET', '/api/notes', { token: alice.token })).body.length, 0)
})

test("users cannot see, edit, delete or read history of each other's notes", async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'Private', content: 'secret' } })
  const id = note._id
  assert.deepEqual((await s.call('GET', '/api/notes', { token: bob.token })).body, [])
  assert.equal((await s.call('PUT', `/api/notes/${id}`, { token: bob.token, body: { title: 'x', content: 'y', version: 1 } })).status, 404)
  assert.equal((await s.call('GET', `/api/notes/${id}/history`, { token: bob.token })).status, 404)
  assert.equal((await s.call('DELETE', `/api/notes/${id}`, { token: bob.token })).status, 404)
  const still = await s.call('GET', '/api/notes', { token: alice.token })
  assert.ok(still.body.some((n) => n._id === id && n.content === 'secret'))
})

test('rejects oversized and non-text input', async () => {
  const long = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'x'.repeat(201) } })
  assert.equal(long.status, 400)
  const wrongType = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 5, content: {} } })
  assert.equal(wrongType.status, 400)
  const badJson = await s.call('POST', '/api/notes', { token: alice.token, raw: '{not json' })
  assert.equal(badJson.status, 400)
})

test('non-numeric ids return 404, not a server error', async () => {
  assert.equal((await s.call('GET', '/api/notes/abc/history', { token: alice.token })).status, 404)
})

test('history keeps earlier versions and restore brings one back', async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'H', content: 'one' } })
  await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'H', content: 'two', version: note.version } })
  const history = await s.call('GET', `/api/notes/${note._id}/history`, { token: alice.token })
  assert.equal(history.body.length, 1)
  assert.equal(history.body[0].content, 'one')
  const restored = await s.call('POST', `/api/notes/${note._id}/restore/${history.body[0].id}`, { token: alice.token })
  assert.equal(restored.body.content, 'one')
})

test('a stale save is rejected with 409 and does not overwrite newer work', async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'C', content: 'base' } })
  const first = await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'C', content: 'first edit', version: note.version } })
  assert.equal(first.status, 200)
  assert.equal(first.body.version, note.version + 1)

  const stale = await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'C', content: 'stale edit', version: note.version } })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.current.content, 'first edit')
  assert.equal(stale.body.current.version, first.body.version)

  const after = await s.call('GET', `/api/notes/${note._id}`, { token: alice.token })
  assert.equal(after.body.content, 'first edit')
})

test('a save without a version is rejected', async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: {} })
  const res = await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'x', content: 'y' } })
  assert.equal(res.status, 400)
})

test('saving unchanged content does not bump the version', async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'U', content: 'same' } })
  const res = await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'U', content: 'same', version: note.version } })
  assert.equal(res.body.version, note.version)
})

test('notes record who last edited them', async () => {
  const { body: note } = await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'A', content: 'x' } })
  assert.equal(note.updatedBy, 'alice')
})
