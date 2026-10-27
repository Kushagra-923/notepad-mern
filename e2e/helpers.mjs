import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'

// Runs one scenario against a fresh server (in-memory Postgres) and the built client in client/dist
export async function scenario(name, port, fn) {
  const server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'e2e-secret-e2e-secret', PGLITE_DIR: 'memory://', AUTH_RATE_LIMIT: '1000', DATABASE_URL: '' },
  })
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  const url = `http://localhost:${port}`
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${url}/api/auth/config`).catch(() => null))?.ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  let failed = 0
  const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++ }
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { console.log(`  FAIL page error: ${e.message}`); failed++ })
    return page
  }
  console.log(name)
  try {
    await fn({ url, check, newPage })
  } catch (e) {
    console.log(`  FAIL ${e.message.split('\n')[0]}`)
    failed++
  } finally {
    await browser.close()
    server.kill()
  }
  return failed
}

export async function signup(page, url, name) {
  await page.goto(url)
  await page.getByRole('button', { name: /no account\? sign up/ }).click()
  const inputs = page.locator('.auth input')
  await inputs.nth(0).fill(name)
  await inputs.nth(1).fill('secret1')
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByRole('button', { name: /New (team )?note/ }).waitFor()
}

export const tokenOf = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('session'))).token

export const apiAs = (url, token) => async (method, route, body) => {
  const res = await fetch(url + route, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// Click "New note" and wait until the new note is open, so typing goes into it
export async function newNote(page, button = 'New note') {
  await page.getByRole('button', { name: button }).click()
  await page.waitForFunction(() => document.querySelector('.title')?.value === 'Untitled')
}

export const type = async (page, text) => {
  await page.locator('.tiptap').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

export const editorText = (page) => page.locator('.tiptap').innerText().then((t) => t.trim())
