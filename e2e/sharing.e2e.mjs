import { scenario, signup, newNote, type, tokenOf, apiAs, editorText } from './helpers.mjs'

export default () => scenario('Sharing, live editing, conflicts, history', 5091, async ({ url, check, newPage }) => {
  const a = await newPage()
  const b = await newPage()
  await signup(b, url, 'bob')
  await signup(a, url, 'alice')

  await newNote(a)
  await a.locator('.title').fill('Biology ch.4')
  await type(a, 'Cells divide by mitosis.')
  await a.getByText('Saved').waitFor()
  check('alice created and autosaved a note', true)

  await a.getByRole('button', { name: 'share', exact: true }).click()
  await a.getByPlaceholder('Their username').fill('nobodyhere')
  await a.getByRole('button', { name: 'Share', exact: true }).click()
  await a.getByText('No user named "nobodyhere"').waitFor({ timeout: 5000 })
  check('sharing with an unknown user shows an error', true)
  await a.getByPlaceholder('Their username').fill('bob')
  await a.getByRole('button', { name: 'Share', exact: true }).click()
  await a.locator('.share-list li', { hasText: 'bob' }).waitFor()
  await a.locator('.dialog').getByRole('button', { name: 'close' }).click()

  await b.reload()
  await b.getByRole('button', { name: 'shared with me' }).click()
  await b.locator('aside li', { hasText: 'Biology ch.4' }).waitFor()
  check('bob sees the note with an editor badge', await b.locator('.badge', { hasText: 'editor · from alice' }).isVisible())
  await b.locator('aside li', { hasText: 'Biology ch.4' }).click()
  await b.locator('.tiptap').getByText('Cells divide').waitFor()

  await type(b, ' Bob: meiosis makes gametes.')
  await b.getByText('Saved').waitFor()
  await a.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Bob: meiosis'), null, { timeout: 12000 })
  check("alice sees bob's edit without reloading", true)
  check('footer credits bob', await a.locator('.foot').getByText('by bob').isVisible())

  // conflict: bob saves through the API while alice's page still holds the old version
  const tokA = await tokenOf(a)
  const tokB = await tokenOf(b)
  const alice = apiAs(url, tokA)
  const bob = apiAs(url, tokB)
  const id = (await alice('GET', '/api/notes')).body[0]._id
  const cur = (await bob('GET', `/api/notes/${id}`)).body
  await bob('PUT', `/api/notes/${id}`, { title: cur.title, content: '<p>bob rewrote everything</p>', version: cur.version })
  await type(a, ' alice adds')
  await a.locator('.conflict').waitFor({ timeout: 8000 })
  check('conflict banner names bob', await a.locator('.conflict').getByText('bob').isVisible())
  await a.getByRole('button', { name: 'keep mine' }).click()
  await a.locator('.conflict').waitFor({ state: 'detached', timeout: 5000 })
  const finalNote = (await alice('GET', `/api/notes/${id}`)).body
  check('"keep mine" saved alice\'s text over bob\'s', finalNote.content.includes('alice adds') && finalNote.updatedBy === 'alice')

  await a.getByRole('button', { name: 'history', exact: true }).click()
  await a.locator('.versions li').first().waitFor()
  check('history credits bob', (await a.locator('.versions').innerText()).includes('bob'))
  await a.getByRole('button', { name: 'history', exact: true }).click()

  // downgrade to viewer
  await a.getByRole('button', { name: 'share', exact: true }).click()
  await a.locator('.share-list select').selectOption('viewer')
  await a.waitForTimeout(500)
  await a.locator('.dialog').getByRole('button', { name: 'close' }).click()
  await b.waitForFunction(() => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'false', null, { timeout: 12000 })
  check('bob becomes view-only after being downgraded', await b.locator('.notice').isVisible())

  // revoke
  await a.getByRole('button', { name: 'share', exact: true }).click()
  await a.locator('.share-list').getByRole('button', { name: 'remove' }).click()
  await a.getByText('Not shared with anyone yet.').waitFor()
  await a.locator('.dialog').getByRole('button', { name: 'close' }).click()
  await b.getByText('Nothing open.').waitFor({ timeout: 12000 })
  check('revoking access removes the note for bob with a message', await b.locator('.error').isVisible())

  const before = await a.evaluate(() => document.documentElement.dataset.theme)
  await a.locator('.side-head .text-btn').click()
  await a.reload()
  check('dark mode toggles and persists', (await a.evaluate(() => document.documentElement.dataset.theme)) !== before)
})
