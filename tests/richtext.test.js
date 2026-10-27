import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, signup } from './helpers.js'
import { cleanContent, toText } from '../server/sanitize.js'

let s, alice, bob
before(async () => {
  s = await startServer()
  alice = await signup(s.call, 'alice')
  bob = await signup(s.call, 'bob')
})
after(() => s.close())

const save = async (content, token = alice.token) => {
  const { body: note } = await s.call('POST', '/api/notes', { token, body: { title: 'Rich', content: '' } })
  const res = await s.call('PUT', `/api/notes/${note._id}`, { token, body: { title: 'Rich', content, version: note.version } })
  return { note, res }
}

test('keeps formatting and highlights', () => {
  const html = '<p>Hello <strong>bold</strong> and <mark data-color="#fde68a" style="background-color: #fde68a; color: inherit">marked</mark></p><ul><li><p>item</p></li></ul>'
  const out = cleanContent(html)
  assert.match(out, /<strong>bold<\/strong>/)
  assert.match(out, /<mark[^>]*data-color="#fde68a"/)
  assert.match(out, /background-color:\s*#fde68a/)
  assert.match(out, /<li>/)
})

test('strips scripts, event handlers, iframes and dangerous styles', () => {
  const out = cleanContent(
    '<p onclick="steal()">hi</p><script>alert(1)</script><img src=x onerror="alert(2)"><iframe src="//evil"></iframe>' +
    '<a href="javascript:alert(3)">link</a><mark style="background-color:url(javascript:alert(4));position:fixed">x</mark>'
  )
  assert.doesNotMatch(out, /script|onclick|onerror|iframe|javascript|<img|position|<a /i)
  assert.match(out, /hi/)
})

test('plain text is escaped and wrapped into paragraphs', () => {
  assert.equal(cleanContent('line one\nline <b>two</b> & more'.replace('<b>', '(').replace('</b>', ')')), '<p>line one</p><p>line (two) &amp; more</p>')
})

test('an empty editor and whitespace-only content normalise to empty', () => {
  assert.equal(cleanContent('<p></p>'), '')
  assert.equal(cleanContent('<p>  </p><p></p>'), '')
  assert.equal(cleanContent(''), '')
})

test('toText gives readable plain text without tags or entities', () => {
  assert.equal(toText('<h1>Title</h1><p>A &amp; B</p><ul><li><p>one</p></li><li><p>two</p></li></ul>'), 'Title A & B one two')
})

test('the API stores sanitized HTML, so other users never receive scripts', async () => {
  const { note, res } = await save('<p>safe</p><script>alert(1)</script><img src=x onerror=alert(2)>')
  assert.equal(res.status, 200)
  assert.equal(res.body.content, '<p>safe</p>')
  const fetched = await s.call('GET', `/api/notes/${note._id}`, { token: alice.token })
  assert.doesNotMatch(fetched.body.content, /script|onerror/)
})

test('search and previews use the text, not the markup', async () => {
  const { note } = await save('<h1>Quantum notes</h1><p>entanglement <mark data-color="#fde68a">spooky</mark></p>')
  const hit = await s.call('GET', '/api/notes?q=spooky', { token: alice.token })
  assert.ok(hit.body.some((n) => n._id === note._id))
  assert.equal(hit.body.find((n) => n._id === note._id).preview, 'Quantum notes entanglement spooky')
  // tag and attribute names must not be searchable
  const tagSearch = await s.call('GET', '/api/notes?q=data-color', { token: alice.token })
  assert.equal(tagSearch.body.length, 0)
  const markSearch = await s.call('GET', '/api/notes?q=%3Cmark', { token: alice.token })
  assert.equal(markSearch.body.length, 0)
})

test('history keeps the formatted versions and restore returns them', async () => {
  const { note, res: first } = await save('<p>first <mark data-color="#bbf7d0" style="background-color: #bbf7d0; color: inherit">green</mark></p>')
  // a different person overwriting always archives the previous version
  await s.call('POST', `/api/notes/${note._id}/shares`, { token: alice.token, body: { username: 'bob', role: 'editor' } })
  const second = await s.call('PUT', `/api/notes/${note._id}`, {
    token: bob.token, body: { title: 'Rich', content: '<p>second</p>', version: first.body.version },
  })
  assert.equal(second.status, 200)
  const history = (await s.call('GET', `/api/notes/${note._id}/history`, { token: alice.token })).body
  const old = history.find((v) => v.content.includes('green'))
  assert.ok(old)
  assert.equal(old.editedBy, 'alice')
  const restored = await s.call('POST', `/api/notes/${note._id}/restore/${old.id}`, { token: alice.token })
  assert.match(restored.body.content, /data-color="#bbf7d0"/)
  assert.equal((await s.call('GET', `/api/notes?q=green`, { token: alice.token })).body.some((n) => n._id === note._id), true)
})

test('a collaborator receives the same sanitized content', async () => {
  const { note } = await save('<p>for bob</p>')
  await s.call('POST', `/api/notes/${note._id}/shares`, { token: alice.token, body: { username: 'bob', role: 'viewer' } })
  const seen = await s.call('GET', `/api/notes/${note._id}`, { token: bob.token })
  assert.equal(seen.body.content, '<p>for bob</p>')
})
