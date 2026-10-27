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

const makeTeam = async (name = 'Study group') => (await s.call('POST', '/api/teams', { token: alice.token, body: { name } })).body
const addMember = (team, who, token = alice.token) => s.call('POST', `/api/teams/${team.id}/members`, { token, body: { username: who } })
const teamNote = async (team, token = alice.token, title = 'Team note') =>
  (await s.call('POST', '/api/notes', { token, body: { title, content: 'x', teamId: team.id } })).body

test('creating a team makes the creator its owner; members see the team and who is in it', async () => {
  const team = await makeTeam()
  assert.equal(team.role, 'owner')
  assert.equal((await addMember(team, 'bob')).status, 201)

  const bobTeams = (await s.call('GET', '/api/teams', { token: bob.token })).body
  const seen = bobTeams.find((t) => t.id === team.id)
  assert.equal(seen.role, 'member')
  assert.deepEqual(seen.members.map((m) => [m.username, m.role]), [['alice', 'owner'], ['bob', 'member']])
  assert.equal((await s.call('GET', '/api/teams', { token: carol.token })).body.some((t) => t.id === team.id), false)
})

test('team name and member input are validated', async () => {
  assert.equal((await s.call('POST', '/api/teams', { token: alice.token, body: { name: '   ' } })).status, 400)
  assert.equal((await s.call('POST', '/api/teams', { token: alice.token, body: { name: 'x'.repeat(61) } })).status, 400)
  const team = await makeTeam('Validation')
  assert.equal((await addMember(team, 'ghost-user')).status, 404)
  assert.equal((await addMember(team, '')).status, 400)
  await addMember(team, 'bob')
  assert.equal((await addMember(team, 'BOB')).status, 409)
})

test('only the team owner can add or remove members; non-members get 404', async () => {
  const team = await makeTeam('Owner only')
  await addMember(team, 'bob')
  assert.equal((await addMember(team, 'carol', bob.token)).status, 403)
  assert.equal((await addMember(team, 'carol', carol.token)).status, 404)
  const carolId = (await s.call('GET', '/api/teams', { token: alice.token })).body // sanity: still only alice+bob
  assert.equal(carolId.find((t) => t.id === team.id).members.length, 2)
})

test('members read and edit team notes but cannot delete or share them; outsiders see nothing', async () => {
  const team = await makeTeam('Notes team')
  await addMember(team, 'bob')
  const note = await teamNote(team)
  assert.equal(note.teamName, 'Notes team')

  const bobView = await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })
  assert.equal(bobView.status, 200)
  assert.equal(bobView.body.role, 'editor')

  const edit = await s.call('PUT', `/api/notes/${note._id}`, { token: bob.token, body: { title: 'Team note', content: 'bob was here', version: note.version } })
  assert.equal(edit.status, 200)
  assert.equal(edit.body.updatedBy, 'bob')

  assert.equal((await s.call('DELETE', `/api/notes/${note._id}`, { token: bob.token })).status, 403)
  assert.equal((await s.call('GET', `/api/notes/${note._id}/shares`, { token: bob.token })).status, 403)
  assert.equal((await s.call('PUT', `/api/notes/${note._id}/team`, { token: bob.token, body: { teamId: null } })).status, 403)

  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: carol.token })).status, 404)
  assert.equal((await s.call('PUT', `/api/notes/${note._id}`, { token: carol.token, body: { title: 'a', content: 'b', version: 1 } })).status, 404)
})

test('you cannot create a note in a team you do not belong to', async () => {
  const team = await makeTeam('Closed')
  const res = await s.call('POST', '/api/notes', { token: carol.token, body: { title: 'sneaky', teamId: team.id } })
  assert.equal(res.status, 403)
  assert.equal((await s.call('POST', '/api/notes', { token: carol.token, body: { title: 'x', teamId: 'abc' } })).status, 403)
})

test('the team owner can delete a members note in the team', async () => {
  const team = await makeTeam('Moderation')
  await addMember(team, 'bob')
  const note = await teamNote(team, bob.token, "Bob's team note")
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: alice.token })).body.role, 'owner')
  assert.equal((await s.call('DELETE', `/api/notes/${note._id}`, { token: alice.token })).status, 200)
})

test('the team scope lists only that teams notes, for members only', async () => {
  const team = await makeTeam('Scope team')
  const other = await makeTeam('Other team')
  await addMember(team, 'bob')
  const inTeam = await teamNote(team, alice.token, 'in scope')
  const elsewhere = await teamNote(other, alice.token, 'other team')
  const personal = (await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'personal' } })).body

  const ids = async (token, scope) => (await s.call('GET', `/api/notes?scope=${scope}`, { token })).body.map((n) => n._id)
  const aliceScoped = await ids(alice.token, `team:${team.id}`)
  assert.ok(aliceScoped.includes(inTeam._id))
  assert.ok(!aliceScoped.includes(elsewhere._id) && !aliceScoped.includes(personal._id))
  assert.ok((await ids(bob.token, `team:${team.id}`)).includes(inTeam._id))
  assert.deepEqual(await ids(carol.token, `team:${team.id}`), []) // non-member sees nothing even by guessing the scope
  assert.ok((await ids(bob.token, 'all')).includes(inTeam._id))
  assert.ok(!(await ids(bob.token, 'all')).includes(elsewhere._id))
})

test('removing a member, or the member leaving, ends their access', async () => {
  const team = await makeTeam('Leaving')
  await addMember(team, 'bob')
  await addMember(team, 'carol')
  const note = await teamNote(team)
  const members = (await s.call('GET', '/api/teams', { token: alice.token })).body.find((t) => t.id === team.id).members
  const idOf = (name) => members.find((m) => m.username === name).userId

  assert.equal((await s.call('DELETE', `/api/teams/${team.id}/members/${idOf('carol')}`, { token: bob.token })).status, 403) // member removing someone else
  assert.equal((await s.call('DELETE', `/api/teams/${team.id}/members/${idOf('bob')}`, { token: alice.token })).status, 200)
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)

  assert.equal((await s.call('DELETE', `/api/teams/${team.id}/members/${idOf('carol')}`, { token: carol.token })).status, 200) // leave
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: carol.token })).status, 404)

  assert.equal((await s.call('DELETE', `/api/teams/${team.id}/members/${idOf('alice')}`, { token: alice.token })).status, 400) // owner cannot leave
})

test('moving a note into a team and back out', async () => {
  const team = await makeTeam('Move target')
  await addMember(team, 'bob')
  const note = (await s.call('POST', '/api/notes', { token: alice.token, body: { title: 'movable', content: 'm' } })).body
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)

  const moved = await s.call('PUT', `/api/notes/${note._id}/team`, { token: alice.token, body: { teamId: team.id } })
  assert.equal(moved.body.teamName, 'Move target')
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 200)

  assert.equal((await s.call('PUT', `/api/notes/${note._id}/team`, { token: alice.token, body: { teamId: null } })).status, 200)
  assert.equal((await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })).status, 404)

  const foreign = await makeTeam('Not carols')
  const carolNote = (await s.call('POST', '/api/notes', { token: carol.token, body: { title: 'c' } })).body
  assert.equal((await s.call('PUT', `/api/notes/${carolNote._id}/team`, { token: carol.token, body: { teamId: foreign.id } })).status, 403)
})

test('deleting a team turns its notes into personal notes of their creators', async () => {
  const team = await makeTeam('Doomed')
  await addMember(team, 'bob')
  const aliceNote = await teamNote(team, alice.token, 'alice team note')
  const bobNote = await teamNote(team, bob.token, 'bob team note')

  assert.equal((await s.call('DELETE', `/api/teams/${team.id}`, { token: bob.token })).status, 403)
  assert.equal((await s.call('DELETE', `/api/teams/${team.id}`, { token: alice.token })).status, 200)

  assert.equal((await s.call('GET', `/api/notes/${aliceNote._id}`, { token: alice.token })).body.teamId, null)
  assert.equal((await s.call('GET', `/api/notes/${bobNote._id}`, { token: bob.token })).body.role, 'owner')
  assert.equal((await s.call('GET', `/api/notes/${bobNote._id}`, { token: alice.token })).status, 404)
})

test('an individual share still works on a team note for a non-member', async () => {
  const team = await makeTeam('Mixed access')
  const note = await teamNote(team)
  await s.call('POST', `/api/notes/${note._id}/shares`, { token: alice.token, body: { username: 'carol', role: 'viewer' } })
  const view = await s.call('GET', `/api/notes/${note._id}`, { token: carol.token })
  assert.equal(view.body.role, 'viewer')
  assert.equal((await s.call('PUT', `/api/notes/${note._id}`, { token: carol.token, body: { title: 'a', content: 'b', version: note.version } })).status, 403)
})
