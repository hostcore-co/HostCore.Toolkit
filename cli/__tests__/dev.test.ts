import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { hct, loadBundle } from './host'

const REPO = join(import.meta.dir, '..', '..')
// Inside examples/basic, so the copy resolves the packages basic has installed.
const TMP = join(REPO, 'examples', 'basic', '.test-tmp', `dev-${process.pid}`)
const TEMPLATE = join(TMP, 'basic')
const FIXTURES = join(REPO, 'contract', 'fixtures', '2026-11')

let proc: Subprocess<'ignore', 'pipe', 'pipe'>
let base = ''
let output = ''

async function readUntil(match: RegExp, timeout = 30_000): Promise<RegExpMatchArray> {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeout
  try {
    for (;;) {
      const found = output.match(match)
      if (found) return found
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${match}; output so far:\n${output}`)
      const { value, done } = await reader.read()
      if (done) throw new Error(`hct dev exited; output:\n${output}\n${await new Response(proc.stderr).text()}`)
      output += decoder.decode(value)
    }
  } finally {
    reader.releaseLock()
  }
}

async function get(path: string): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(`${base}${path.replace(/^\//, '')}`, { redirect: 'manual' })
  return { status: response.status, text: await response.text(), headers: response.headers }
}

/** The markup inside #hc-root. */
function root(page: string): string {
  const start = page.indexOf('<div id="hc-root">') + '<div id="hc-root">'.length
  const end = page.lastIndexOf('</div><div data-hc-dev-toolbar')
  return page.slice(start, end)
}

/** The __HC__ the page sets. */
function global(page: string): Record<string, any> {
  const m = /window\.__HC__ = (.*?)<\/script>/.exec(page)
  return JSON.parse(m![1]!) as Record<string, any>
}

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
  for (const entry of ['src', 'public', 'template.json', 'package.json']) {
    await cp(join(REPO, 'examples', 'basic', entry), join(TEMPLATE, entry), { recursive: true })
  }
  const payload = JSON.parse(await readFile(join(FIXTURES, 'catalog.group.json'), 'utf8'))
  payload.data.group.name = 'My Own Group'
  payload.data.group.marketing.title = ''
  payload.store.theme.border = '#333333'
  payload.store.theme.accent = '#34d0ff'
  await writeFile(join(TMP, 'payload.json'), JSON.stringify(payload))
  const { NODE_ENV: _test, ...env } = process.env
  proc = Bun.spawn([process.execPath, join(REPO, 'cli', 'index.ts'), 'dev', TEMPLATE, '--port', '0', '--payload', join(TMP, 'payload.json')], {
    cwd: REPO,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  base = (await readUntil(/hct dev: (http:\/\/127\.0\.0\.1:\d+\/)/))[1]!
}, 60_000)

afterAll(async () => {
  proc?.kill()
  await proc?.exited
  await rm(TMP, { recursive: true, force: true })
})

describe('hct dev', () => {
  it("writes the template's colours where the store has not changed its own", async () => {
    const page = await get('/page/home/home')
    expect(page.text).toContain('--hc-accent:#5b8cff')
    expect(page.text).toContain('--hc-background:#141517')
    expect(page.text).toContain('--hc-radius-md:0.5rem')
  })

  it('writes a colour the store has changed over the template', async () => {
    const page = await get('/page/_/payload')
    expect(page.text).toContain('--hc-border:#333333')
    expect(page.text).toContain('--hc-accent:#5b8cff')
  })

  it('lists every page id and every fixture for it', async () => {
    const index = await get('/')
    expect(index.status).toBe(200)
    for (const file of await readdir(FIXTURES)) {
      const name = file.replace(/\.json$/, '')
      const id = JSON.parse(await readFile(join(FIXTURES, file), 'utf8')).page.id as string
      expect(index.text).toContain(`href="/page/${encodeURIComponent(id)}/${encodeURIComponent(name)}"`)
    }
    for (const id of ['home', 'domains', 'catalog.group', 'catalog.service', 'not-found']) expect(index.text).toContain(`<code>${id}</code>`)
    expect(index.text).toContain('href="/page/checkout/home?variant=minimal"')
    expect(index.text).toContain('href="/page/_/payload"')
  })

  it("renders a page through the template's server entry and loads its client entry with the runtime", async () => {
    const page = await get('/page/catalog.group/catalog.group')
    expect(page.status).toBe(200)
    const g = global(page.text)
    expect(g).toMatchObject({ v: 2, mode: 'document', page: 'catalog.group', variant: 'default' })
    expect(g.defer).toBeUndefined()
    const fixture = JSON.parse(await readFile(join(FIXTURES, 'catalog.group.json'), 'utf8'))
    expect(g.payload).toEqual(fixture)
    const entry = /<script type="module" src="(\/_hc\/b\/dev\/client\/entry\.client\.[\w-]+\.js)"><\/script>/.exec(page.text)![1]!
    expect((await get(entry)).status).toBe(200)
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(page.text)![1]!)
    for (const file of Object.values(map.imports) as string[]) expect((await get(file)).status).toBe(200)
    const css = /<link rel="stylesheet" href="([^"]+)">/.exec(page.text)![1]!
    expect((await get(css)).headers.get('content-type')).toContain('text/css')
    // The fixture's store has the platform default accent, so the template's own accent shows.
    expect(page.text).toContain('--hc-accent:#5b8cff')
  })

  it('renders exactly what the server bundle renders', async () => {
    const built = join(TMP, 'built')
    const runtime = join(TMP, 'runtime')
    expect((await hct(['runtime', 'build', '--out', runtime, '--root', TEMPLATE])).code).toBe(0)
    expect((await hct(['build', TEMPLATE, '--local-paths', '--out', built, '--runtime', runtime])).code).toBe(0)
    const manifest = JSON.parse(await readFile(join(built, 'manifest.json'), 'utf8'))
    const bundle = loadBundle(runtime, join(built, manifest.entry.server))
    const page = await get('/page/catalog.service/catalog.service?variant=minimal')
    const g = global(page.text)
    expect(g.variant).toBe('minimal')
    const expected = JSON.parse(bundle.render(JSON.stringify({ kind: 'document', page: 'catalog.service', variant: 'minimal', payload: g.payload, env: g.env }))).html
    expect(root(page.text)).toBe(expected)
  }, 60_000)

  it('shows where the platform default page goes for a page the template does not implement', async () => {
    const page = await get('/page/domains/domains')
    expect(page.status).toBe(200)
    const html = root(page.text)
    expect(html).toContain("The platform's default page appears here")
    expect(html).toMatch(/<hc-outlet><div data-hc-dev-standin/)
    expect(html).toContain('<header')
    expect(global(page.text)).toMatchObject({ mode: 'composed', page: 'domains' })
  })

  it("draws the platform's own pages inside the minimal layout", async () => {
    const page = await get('/page/login/home?variant=minimal')
    expect(page.status).toBe(200)
    expect(root(page.text)).toContain("The platform's login page appears here")
    expect(global(page.text)).toMatchObject({ mode: 'composed', page: 'login', variant: 'minimal' })
    expect(global(page.text).payload.data).toBeUndefined()
  })

  it('previews a payload file', async () => {
    const page = await get('/page/_/payload')
    expect(page.status).toBe(200)
    expect(root(page.text)).toContain('My Own Group')
  })

  it('follows store links to the fixture for that page', async () => {
    const page = await get('/games/rust')
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe('/page/catalog.service/catalog.service')
    expect((await get('/images/grid.svg')).headers.get('content-type')).toBe('image/svg+xml')
  })

  it('rebuilds when a file changes and tells the browser to reload', async () => {
    const events = await fetch(`${base}_dev/events`)
    const reader = events.body!.getReader()
    const file = join(TEMPLATE, 'src', 'pages', 'catalog.service.tsx')
    await writeFile(file, (await readFile(file, 'utf8')).replace('Order\n', 'Order now, edited\n'))
    const decoder = new TextDecoder()
    let seen = ''
    while (!/data: \d+/.test(seen)) {
      const { value, done } = await reader.read()
      if (done) break
      seen += decoder.decode(value)
    }
    await reader.cancel()
    expect(seen).toMatch(/data: \d+/)
    expect((await get('/page/catalog.service/catalog.service')).text).toContain('Order now, edited')
  }, 30_000)
})
