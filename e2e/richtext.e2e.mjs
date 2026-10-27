import { scenario, signup, newNote, type, tokenOf, apiAs } from './helpers.mjs'

export default () => scenario('Rich text and highlighting', 5093, async ({ url, check, newPage }) => {
  const a = await newPage(), b = await newPage()
  let alerted = false
  b.on('dialog', (d) => { alerted = true; d.dismiss() })
  await signup(b, url, 'bob')
  await signup(a, url, 'alice')

  await newNote(a)
  await a.locator('.title').fill('Cell division')
  await type(a, 'Mitosis has four phases')
  await a.keyboard.press('Enter')
  await a.keyboard.type('Meiosis makes gametes')
  await a.getByText('Saved').waitFor()

  await a.keyboard.press('Control+Home')
  await a.keyboard.press('Shift+End')
  await a.locator('.bubble').waitFor({ timeout: 5000 })
  check('selecting text shows the floating highlight menu', true)
  await a.locator('.fmtbar').getByRole('button', { name: 'Highlight yellow' }).click()
  await a.locator('.tiptap mark').first().waitFor()
  check('yellow highlight applied', (await a.locator('.tiptap mark').first().evaluate((m) => getComputedStyle(m).backgroundColor)) === 'rgb(253, 230, 138)')

  await a.keyboard.press('End'); await a.keyboard.press('ArrowDown'); await a.keyboard.press('Shift+Home')
  await a.locator('.fmtbar').getByRole('button', { name: 'Bold' }).click()
  await a.locator('.fmtbar').getByRole('button', { name: 'Highlight green' }).click()
  await a.getByText('Saved').waitFor()
  check('bold and a second highlight colour applied', (await a.locator('.tiptap strong').count()) === 1 && (await a.locator('.tiptap mark').count()) === 2)

  await a.waitForTimeout(800)
  await a.reload()
  await a.locator('aside li', { hasText: 'Cell division' }).click()
  await a.locator('.tiptap mark').first().waitFor()
  check('formatting persists after a reload', (await a.locator('.tiptap mark').count()) === 2)
  check('sidebar preview shows text, not tags', (await a.locator('aside li small').first().innerText()).startsWith('Mitosis has four phases'))

  await a.locator('.tiptap').click()
  await a.keyboard.press('Control+Home'); await a.keyboard.press('Shift+End')
  await a.locator('.fmtbar').getByRole('button', { name: 'Remove highlight' }).click()
  await a.getByText('Saved').waitFor()
  check('"clear" removes a highlight', (await a.locator('.tiptap mark').count()) === 1)

  await a.getByPlaceholder('Search notes…').fill('gametes')
  await a.locator('aside li', { hasText: 'Cell division' }).waitFor()
  check('search finds text inside formatted notes', true)
  await a.getByPlaceholder('Search notes…').fill('')

  await a.getByRole('button', { name: 'share', exact: true }).click()
  await a.getByPlaceholder('Their username').fill('bob')
  await a.locator('.share-add select').selectOption('viewer')
  await a.getByRole('button', { name: 'Share', exact: true }).click()
  await a.locator('.share-list li', { hasText: 'bob' }).waitFor()
  await a.locator('.dialog').getByRole('button', { name: 'close' }).click()
  await b.reload()
  await b.getByRole('button', { name: 'shared with me' }).click()
  await b.locator('aside li', { hasText: 'Cell division' }).click()
  await b.locator('.tiptap mark').first().waitFor()
  check('viewer sees the highlight but cannot edit or format', (await b.locator('.tiptap').getAttribute('contenteditable')) === 'false' && (await b.locator('.fmtbar').count()) === 0)

  // an injected script must neither be stored nor run in another user's browser
  const alice = apiAs(url, await tokenOf(a))
  const note = (await alice('GET', '/api/notes')).body[0]
  const full = (await alice('GET', `/api/notes/${note._id}`)).body
  await alice('PUT', `/api/notes/${note._id}`, { title: 'Cell division', content: '<p>x</p><img src=x onerror="alert(1)"><script>alert(2)</script>', version: full.version })
  await b.waitForTimeout(6000)
  check("injected script did not run in the viewer's browser", !alerted && (await b.locator('.tiptap img, .tiptap script').count()) === 0)
})
