import { scenario, signup, newNote, type, tokenOf, apiAs } from './helpers.mjs'

export default () => scenario('Errors, empty states and offline handling', 5094, async ({ url, check, newPage }) => {
  const a = await newPage()
  await signup(a, url, 'dana')

  await a.getByText('No notes yet.').waitFor({ timeout: 5000 })
  check('a new account shows an empty state', true)

  // --- login and signup failures ---
  const b = await newPage()
  await b.goto(url)
  const fields = b.locator('.auth input')
  await fields.nth(0).fill('dana')
  await fields.nth(1).fill('wrong-password')
  await b.getByRole('button', { name: 'Log in' }).click()
  await b.getByText('Invalid username or password').waitFor({ timeout: 5000 })
  check('wrong password shows a clear error', true)

  await b.getByRole('button', { name: /no account\? sign up/ }).click()
  await fields.nth(1).fill('123')
  await b.getByRole('button', { name: 'Sign up' }).click()
  await b.getByText('Password must be at least 6 characters').waitFor({ timeout: 5000 })
  check('short password is rejected before sending', true)
  await fields.nth(1).fill('secret1')
  await b.getByRole('button', { name: 'Sign up' }).click()
  await b.getByText('Username already taken').waitFor({ timeout: 5000 })
  check('duplicate username shows an error', true)
  await b.getByRole('button', { name: 'show' }).click()
  check('password can be revealed', (await fields.nth(1).getAttribute('type')) === 'text')

  // --- offline ---
  await newNote(a)
  await a.locator('.title').fill('Offline test')
  await type(a, 'written while online')
  await a.getByText('Saved').waitFor()
  await a.context().setOffline(true)
  await type(a, ' and then offline')
  await a.getByText('Not saved yet').waitFor({ timeout: 8000 })
  check('losing the connection is reported while editing', await a.locator('.error', { hasText: 'saved when you reconnect' }).isVisible())
  await a.context().setOffline(false)
  await a.getByText('Saved', { exact: true }).waitFor({ timeout: 15000 })
  await a.locator('.error').waitFor({ state: 'detached', timeout: 5000 })
  const api = apiAs(url, await tokenOf(a))
  const saved = (await api('GET', `/api/notes/${(await api('GET', '/api/notes')).body[0]._id}`)).body
  check('the edit made offline is saved automatically once back online', saved.content.includes('and then offline'))

  // --- expired / invalid session ---
  await a.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('session'))
    localStorage.setItem('session', JSON.stringify({ ...s, token: s.token.slice(0, -4) + 'xxxx' }))
  })
  await a.reload()
  await a.getByText('Your session expired. Please log in again.').waitFor({ timeout: 8000 })
  check('an invalid session returns to the login screen with a message', await a.locator('.auth').isVisible())

  // --- API contract for failures ---
  const bad = await fetch(url + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenOf(b).catch(() => 'x')}` }, body: '{' })
  check('malformed JSON gets a 4xx, not a crash', bad.status >= 400 && bad.status < 500)
  const missing = await fetch(url + '/api/nope')
  check('unknown API routes do not return the app shell', missing.status === 404 || (await missing.text()).startsWith('<!') === false)
})
