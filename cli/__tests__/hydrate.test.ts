import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hct, loadBundle, type LoadedBundle } from './host'

/**
 * Hydrates server output with the built client entry in a simulated
 * browser. React's development build reports every hydration mismatch
 * through console.error, so a clean run means the client rebuilt exactly
 * the tree the server rendered.
 */

const REPO = join(import.meta.dir, '..', '..')
const FIXTURES = join(REPO, 'contract', 'fixtures', '2026-11')
const TMP = join(REPO, '.test-tmp', `hydrate-${process.pid}`)
const ENV = { build_id: 'b'.repeat(64), asset_base: '/_hc/b/test/client/', locale: 'en', currency: 'USD', mode: 'document' }

let bundle: LoadedBundle
let entryPath: string
let imports = 0
const errors: unknown[][] = []
const originalConsoleError = console.error

async function fixture(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(FIXTURES, `${name}.json`), 'utf8'))
}

function render(kind: string, payload: Record<string, any>): string {
  return (JSON.parse(bundle.render(JSON.stringify({ kind, page: payload.page.id, variant: 'default', payload, env: ENV }))) as { html: string }).html
}

/** Imports a fresh copy of the client entry and mounts it. */
async function mount(payload: Record<string, any>, rootHtml: string, mode: 'document' | 'composed', part?: string): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="hc-root">${rootHtml}</div>`
  ;(globalThis as any).__HC__ = { v: 2, payload, env: { ...ENV, mode }, mode, page: payload.page.id, defer: true }
  // A copy beside the original, so it imports the same chunks but runs its
  // own start-up.
  const copy = entryPath.replace(/\.js$/, `.copy${imports++}.js`)
  await copyFile(entryPath, copy)
  const client = (await import(pathToFileURL(copy).href)) as { mount(part?: string): Promise<void> }
  await client.mount(part)
  await new Promise((resolve) => setTimeout(resolve, 50))
  return document.getElementById('hc-root')!
}

function hydrated(el: Element | null): boolean {
  return el !== null && Object.keys(el).some((k) => k.startsWith('__reactFiber'))
}

beforeAll(async () => {
  const runtime = join(TMP, 'runtime')
  for (const args of [
    ['runtime', 'build', '--out', runtime],
    ['build', 'examples/basic', '--local-paths', '--out', join(TMP, 'basic'), '--runtime', runtime],
  ]) {
    const result = await hct(args)
    if (result.code !== 0) throw new Error(result.stderr)
  }
  const manifest = JSON.parse(await readFile(join(TMP, 'basic', 'manifest.json'), 'utf8'))
  bundle = loadBundle(runtime, join(TMP, 'basic', manifest.entry.server))
  entryPath = join(TMP, 'basic', manifest.entry.client_js)
  GlobalRegistrator.register({ url: 'https://acme.test/' })
  // React reports uncaught render errors through reportError, not console.error.
  ;(globalThis as any).reportError = (error: unknown) => errors.push(['reportError', error])
  window.addEventListener('error', (event) => errors.push(['error event', (event as ErrorEvent).error ?? event]))
  console.error = (...args: unknown[]) => {
    errors.push(args)
  }
}, 60_000)

afterAll(async () => {
  console.error = originalConsoleError
  await GlobalRegistrator.unregister()
  await rm(TMP, { recursive: true, force: true })
})

describe('the client entry', () => {
  it('hydrates a full page, layout and page together, without a mismatch', async () => {
    errors.length = 0
    const payload = await fixture('catalog.group')
    const root = await mount(payload, render('document', payload), 'document')
    expect(errors).toEqual([])
    expect(hydrated(root.querySelector('header'))).toBe(true)
    expect(hydrated(root.querySelector('hc-outlet section'))).toBe(true)
  })

  it('hydrates only the islands of an islands page', async () => {
    errors.length = 0
    const payload = await fixture('home')
    const root = await mount(payload, render('document', payload), 'document')
    expect(errors).toEqual([])
    expect(hydrated(root.querySelector('header'))).toBe(false)
    expect(hydrated(root.querySelector('section.hero h1'))).toBe(false)
    const faq = root.querySelector('hc-island[data-name="faq"] dl')
    expect(hydrated(faq)).toBe(true)
    // (The simulated DOM drops properties set on a <form>, so look inside it.)
    expect(hydrated(root.querySelector('hc-island[data-name="domain-search"] button'))).toBe(true)

    // The island works: its button toggles its answer.
    const button = faq!.querySelector('button')!
    expect(faq!.querySelector('dd')!.hidden).toBe(false)
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(faq!.querySelector('dd')!.hidden).toBe(true)
  })

  it('in composed mode hydrates the layout and leaves the outlet untouched', async () => {
    errors.length = 0
    const payload = await fixture('domains')
    const foreign = '<section id="platform-body"><h1>Domains</h1><button>Search</button></section>'
    const layout = render('layout', payload).replace('<hc-outlet></hc-outlet>', `<hc-outlet>${foreign}</hc-outlet>`)
    document.body.innerHTML = ''
    const root = await mount(payload, layout, 'composed')
    const body = root.querySelector('#platform-body')
    expect(errors).toEqual([])
    expect(hydrated(root.querySelector('header'))).toBe(true)
    expect(root.querySelector('hc-outlet')!.innerHTML).toBe(foreign)
    expect(hydrated(body)).toBe(false)
    expect(root.querySelector('#platform-body')).toBe(body)
  })

  it('hydrates only its page inside another layout when asked for the body', async () => {
    errors.length = 0
    const payload = await fixture('catalog.service')
    const root = await mount(
      payload,
      `<header id="platform-header">Store</header><main><hc-outlet>${render('body', payload)}</hc-outlet></main>`,
      'composed',
      'body',
    )
    expect(errors).toEqual([])
    expect(hydrated(root.querySelector('#platform-header'))).toBe(false)
    expect(hydrated(root.querySelector('hc-outlet section'))).toBe(true)
  })
})
