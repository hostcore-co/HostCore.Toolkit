import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
/** A second template that implements only catalog.service, to hydrate inside basic's layout. */
let shadowBundle: LoadedBundle
let shadowEntryPath: string
const SHADOW_ENV = { build_id: 'c'.repeat(64), asset_base: '/_hc/b/other/client/', locale: 'en', currency: 'USD', mode: 'composed' }

const SHADOW_PAGE = `import { useState } from 'react'
import { asset, useEnv, type PageProps } from '@hostcore/toolkit'

export default function Service({ data }: PageProps<'catalog.service'>) {
  const env = useEnv()
  const [picked, setPicked] = useState('')
  return (
    <section className="platform-body">
      <img src={asset('images/plan.svg')} alt="" />
      <h1 data-build={env.build_id}>{data.service.name}</h1>
      {data.plans.map((plan) => (
        <button key={plan.id} type="button" onClick={() => setPicked(plan.id)}>
          {plan.name}
        </button>
      ))}
      <p className="picked">{picked}</p>
    </section>
  )
}
`
let imports = 0
const errors: unknown[][] = []
const originalConsoleError = console.error

async function fixture(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(FIXTURES, `${name}.json`), 'utf8'))
}

function render(kind: string, payload: Record<string, any>): string {
  return (JSON.parse(bundle.render(JSON.stringify({ kind, page: payload.page.id, variant: 'default', payload, env: ENV }))) as { html: string }).html
}

/** Imports a fresh copy of a client entry, without mounting it. */
async function importEntry(path: string): Promise<{ mount(part?: string, options?: unknown): Promise<void> }> {
  const copy = path.replace(/\.js$/, `.copy${imports++}.js`)
  await copyFile(path, copy)
  return (await import(pathToFileURL(copy).href)) as { mount(part?: string, options?: unknown): Promise<void> }
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

  const shadowSource = join(TMP, 'shadow-src')
  await mkdir(join(shadowSource, 'src', 'pages'), { recursive: true })
  await writeFile(
    join(shadowSource, 'template.json'),
    JSON.stringify({ id: 'shadow', version: '1.0.0', name: 'Shadow', format: 2, contract: '2026-11', toolchain: 2 }),
  )
  await writeFile(join(shadowSource, 'src', 'pages', 'catalog.service.tsx'), SHADOW_PAGE)
  const shadowBuild = await hct(['build', shadowSource, '--local-paths', '--out', join(TMP, 'shadow'), '--runtime', runtime])
  if (shadowBuild.code !== 0) throw new Error(shadowBuild.stderr)
  const shadowManifest = JSON.parse(await readFile(join(TMP, 'shadow', 'manifest.json'), 'utf8'))
  shadowBundle = loadBundle(runtime, join(TMP, 'shadow', shadowManifest.entry.server))
  shadowEntryPath = join(TMP, 'shadow', shadowManifest.entry.client_js)
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

  it('hydrates its page into a root inside a shadow root, with its own env, while another layout hydrates around it', async () => {
    errors.length = 0
    const payload = await fixture('catalog.service')
    const body = (JSON.parse(
      shadowBundle.render(JSON.stringify({ kind: 'body', page: 'catalog.service', payload, env: SHADOW_ENV })),
    ) as { html: string }).html
    document.body.innerHTML = `<div id="hc-root">${render('layout', payload).replace(
      '<hc-outlet></hc-outlet>',
      '<hc-outlet><div id="body-host"></div></hc-outlet>',
    )}</div>`
    const host = document.getElementById('body-host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<div class="hc-body">${body}</div>`
    const bodyRoot = shadow.querySelector('.hc-body')!
    ;(globalThis as any).__HC__ = { v: 2, payload, env: { ...ENV, mode: 'composed' }, mode: 'composed', page: 'catalog.service', defer: true }

    const layoutClient = await importEntry(entryPath)
    const bodyClient = await importEntry(shadowEntryPath)
    await layoutClient.mount()
    await bodyClient.mount('body', { root: bodyRoot, env: SHADOW_ENV })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const root = document.getElementById('hc-root')!
    expect(errors).toEqual([])
    expect(hydrated(root.querySelector('header'))).toBe(true)
    // The layout left its outlet, and the shadow root inside it, alone.
    expect(document.getElementById('body-host')).toBe(host)
    expect(host.shadowRoot).toBe(shadow)
    // The page was rendered and hydrated with the env it was given.
    expect(shadow.querySelector('img')!.getAttribute('src')).toBe('/_hc/b/other/client/images/plan.svg')
    expect(shadow.querySelector('h1')!.getAttribute('data-build')).toBe(SHADOW_ENV.build_id)
    const button = shadow.querySelector('button')!
    expect(hydrated(button)).toBe(true)
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shadow.querySelector('.picked')!.textContent).toBe(payload.data.plans[0].id)

    // The same element is never hydrated twice.
    await bodyClient.mount('body', { root: bodyRoot, env: SHADOW_ENV })
    expect(errors).toEqual([['hostcore: that element has already been hydrated']])
  })

  it('refuses mount options for anything but the body', async () => {
    errors.length = 0
    const payload = await fixture('home')
    document.body.innerHTML = `<div id="hc-root">${render('document', payload)}</div>`
    ;(globalThis as any).__HC__ = { v: 2, payload, env: ENV, mode: 'document', page: 'home', defer: true }
    const client = await importEntry(entryPath)
    await client.mount('layout', { root: document.body })
    expect(errors).toEqual([['hostcore: mount options are only for mount("body", …), not "layout"']])
  })
})
