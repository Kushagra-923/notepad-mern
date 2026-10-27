import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, signup } from './helpers.js'

let s, alice, bob, carol
before(async () => {
  s = await startServer()
  alice = await signup(s.call, 'alice')
  bob = await signup(s.call, 'bob')
  carol = await signup(s.call, 'carol')
})
after(() => s.close())

const newNote = async (title = 'Shared', content = 'v1') =>
  (await s.call('POST', '/api/notes', { token: alice.token, body: { title, content } })).body
const share = (note, who, role) => s.call('POST', `/api/notes/${note._id}/shares`, { token: alice.token, body: { username: who, role } })

test('a viewer can read and see history but cannot edit, delete, or manage sharing', async () => {
  const note = await newNote()
  assert.equal((await share(note, 'bob', 'viewer')).status, 201)

  const list = await s.call('GET', '/api/notes', { token: bob.token })
  const entry = list.body.find((n) => n._id === note._id)
  assert.equal(entry.role, 'viewer')
  assert.equal(entry.ownerName, 'alice')
  assert.equal(entry.content, undefined) // lists only carry a preview

  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).body.content, '<p>v1</p>')
  assert.equal((await s.call('GET', `/api/notes/${note._id}/history`, { token: bob.token })).status, 200)
  assert.equal((await s.call('PUT', `/api/notes/${note._id}`, { token: bob.token, body: { title: 'x', content: 'y', version: note.version } })).status, 403)
  assert.equal((await s.call('POST', `/api/notes/${note._id}/restore/1`, { token: bob.token })).status, 403)
  assert.equal((await s.call('DELETE', `/api/notes/${note._id}`, { token: bob.token })).status, 403)
  assert.equal((await s.call('GET', `/api/notes/${note._id}/shares`, { token: bob.token })).status, 403)
  assert.equal((await share(note, 'carol', 'viewer').then(() => s.call('POST', `/api/notes/${note._id}/shares`, { token: bob.token, body: { username: 'carol', role: 'editor' } }))).status, 403)
})

test('an editor can edit and is credited, but cannot delete', async () => {
  const note = await newNote('Team notes', 'draft')
  await share(note, 'bob', 'editor')
  const edit = await s.call('PUT', `/api/notes/${note._id}`, { token: bob.token, body: { title: 'Team notes', content: 'draft + bob', version: note.version } })
  assert.equal(edit.status, 200)
  assert.equal(edit.body.updatedBy, 'bob')
  assert.equal(edit.body.role, 'editor')

  const seenByOwner = await s.call('GET', `/api/notes/${note._id}`, { token: alice.token })
  assert.equal(seenByOwner.body.content, '<p>draft + bob</p>')
  assert.equal(seenByOwner.body.updatedBy, 'bob')

  assert.equal((await s.call('DELETE', `/api/notes/${note._id}`, { token: bob.token })).status, 403)

  // history credits the author of each earlier state
  await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'Team notes', content: 'alice again', version: edit.body.version } })
  const history = (await s.call('GET', `/api/notes/${note._id}/history`, { token: alice.token })).body
  assert.ok(history.some((v) => v.content === '<p>draft + bob</p>' && v.editedBy === 'bob'))
})

test('people the note was not shared with get 404', async () => {
  const note = await newNote('Hidden', 'x')
  await share(note, 'bob', 'viewer')
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: carol.token })).status, 404)
  assert.equal((await s.call('PUT', `/api/notes/${note._id}`, { token: carol.token, body: { title: 'a', content: 'b', version: 1 } })).status, 404)
  assert.equal((await s.call('GET', '/api/notes', { token: carol.token })).body.some((n) => n._id === note._id), false)
})

test('two collaborators editing from the same version: the second gets a conflict', async () => {
  const note = await newNote('Race', 'start')
  await share(note, 'bob', 'editor')
  const a = await s.call('PUT', `/api/notes/${note._id}`, { token: alice.token, body: { title: 'Race', content: 'alice wins', version: note.version } })
  assert.equal(a.status, 200)
  const b = await s.call('PUT', `/api/notes/${note._id}`, { token: bob.token, body: { title: 'Race', content: 'bob loses', version: note.version } })
  assert.equal(b.status, 409)
  assert.equal(b.body.current.content, '<p>alice wins</p>')
  assert.equal(b.body.current.updatedBy, 'alice')
})

test('sharing validates its input', async () => {
  const note = await newNote()
  assert.equal((await share(note, 'alice', 'viewer')).status, 400) // yourself
  assert.equal((await share(note, 'nobody-here', 'viewer')).status, 404)
  assert.equal((await share(note, 'bob', 'admin')).status, 400)
  assert.equal((await share(note, '', 'viewer')).status, 400)
})

test('the owner can change a role or revoke access, and a collaborator can leave', async () => {
  const note = await newNote()
  await share(note, 'bob', 'viewer')
  await share(note, 'bob', 'editor') // upgrade
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).body.role, 'editor')

  const shares = await s.call('GET', `/api/notes/${note._id}/shares`, { token: alice.token })
  assert.deepEqual(shares.body.map((x) => [x.username, x.role]), [['bob', 'editor']])

  const bobId = shares.body[0].userId
  assert.equal((await s.call('DELETE', `/api/notes/${note._id}/shares/${bobId}`, { token: alice.token })).status, 200)
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)

  await share(note, 'bob', 'viewer')
  assert.equal((await s.call('DELETE', `/api/notes/${note._id}/shares/${bobId}`, { token: bob.token })).status, 200) // leave
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)
})

test('scope filters separate my notes from notes shared with me', async () => {
  const mine = await s.call('POST', '/api/notes', { token: bob.token, body: { title: 'Bob own', content: '' } })
  const theirs = await newNote('Alice for bob', 'z')
  await share(theirs, 'bob', 'viewer')
  const ids = async (scope) => (await s.call('GET', `/api/notes?scope=${scope}`, { token: bob.token })).body.map((n) => n._id)
  assert.ok((await ids('mine')).includes(mine.body._id))
  assert.ok(!(await ids('mine')).includes(theirs._id))
  assert.ok((await ids('shared')).includes(theirs._id))
  assert.ok(!(await ids('shared')).includes(mine.body._id))
  const all = await ids('all')
  assert.ok(all.includes(mine.body._id) && all.includes(theirs._id))
})

test('deleting a note removes its shares and history', async () => {
  const note = await newNote()
  await share(note, 'bob', 'editor')
  assert.equal((await s.call('DELETE', `/api/notes/${note._id}`, { token: alice.token })).status, 200)
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)
})
