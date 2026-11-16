import { watch, type FSWatcher } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'
import { matchPath, PAGES } from '../contract/dist/ts/registry'
import { validate } from '../contract/src/validate'
import { effectiveTokens, TOKENS } from '../contract/src/tokens'
import { buildFormat2 } from './build-v2'
import { readFixtures } from './check'
import { CommandError, stringFlag, type Flags } from './commands'
import type { ManifestV2 } from './manifest'
import { RUNTIME_CLIENT_FILES, buildRuntime, writeRuntime } from './runtime'
import { loadBundle, type LoadedBundle } from './sandbox'
import { TEMPLATE_PAGE_IDS } from './sources'
import { isFormat2, loadTemplate } from './template'

/**
 * hct dev — a local preview of a format-2 template.
 *
 * The template is built exactly as `hct build` builds it, its server bundle
 * is loaded in an empty context with the runtime's modules, and each page is
 * served as the platform composes it: the template's layout and page when it
 * has both, its layout around a stand-in for a page it leaves to the
 * platform, its page inside a stand-in layout when it has no layout. The
 * real client entry hydrates it, with React from the runtime through an
 * import map. Page data comes from the contract fixtures, or from a payload
 * file the author supplies.
 */

const BUILD_BASE = '/_hc/b/dev/client/'
const RUNTIME_BASE = '/_hc/rt/dev/'
const PAYLOAD_FIXTURE = 'payload'

export interface DevServerOptions {
  port?: number
  /** A 2026-11 page envelope to preview as well. */
  payloadFile?: string
  /** Called after each build with its outcome. */
  onBuild?: (result: { ok: boolean; message: string }) => void
}

export interface DevServer {
  url: string
  rebuild(): Promise<void>
  stop(): Promise<void>
}

interface Build {
  dir: string
  manifest: ManifestV2
  bundle: LoadedBundle
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

const STANDIN_STYLE =
  'margin:24px;padding:32px;border:2px dashed #8a8f98;border-radius:12px;font:15px/1.5 system-ui,sans-serif;color:#4a4f57;background:#f6f7f9;text-align:center'

function standIn(title: string, detail: string): string {
  return `<div data-hc-dev-standin style="${STANDIN_STYLE}"><strong>${escapeHtml(title)}</strong><br><span>${escapeHtml(detail)}</span></div>`
}

/** The design tokens as the rendering engine writes them, from the template's tokens and the payload's store theme. */
function tokensCss(templateTokens: Record<string, string>, payload: Record<string, any>): string {
  const values = effectiveTokens(templateTokens, payload.store?.theme)
  const declarations = TOKENS.filter((t) => t.name in values).map((t) => `${t.property}:${values[t.name]}`)
  return `:root,:host{${declarations.join(';')}}`
}

const TOOLBAR_STYLE =
  'position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:12px;align-items:center;padding:8px 12px;border-radius:10px;background:#111827;color:#f9fafb;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px #0004'

function toolbar(items: string[]): string {
  return `<div data-hc-dev-toolbar style="${TOOLBAR_STYLE}">${items.join('<span style="opacity:.4">|</span>')}</div>`
}

function link(href: string, text: string, current = false): string {
  return `<a href="${escapeHtml(href)}" style="color:${current ? '#93c5fd' : '#f9fafb'};${current ? 'font-weight:600;' : ''}text-decoration:none">${escapeHtml(text)}</a>`
}

const RELOAD = `<script>new EventSource('/_dev/events').onmessage = () => location.reload()</script>`

function page(title: string, head: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${head}</head><body>${body}${RELOAD}</body></html>`
}

function errorPage(title: string, message: string): string {
  return page(
    title,
    '',
    `<main style="font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 16px"><h1 style="color:#b91c1c">${escapeHtml(title)}</h1><pre style="white-space:pre-wrap;background:#f6f7f9;padding:16px;border-radius:8px">${escapeHtml(message)}</pre><p><a href="/">All pages</a> · this page reloads when you save a change.</p></main>`,
  )
}

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const types: Record<string, string> = {
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
  }
  return types[ext] ?? 'application/octet-stream'
}

/** A file under `dir`, or null when `rel` leaves it or names nothing. */
async function fileIn(dir: string, rel: string): Promise<Response | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  const path = normalize(join(dir, decoded))
  if (path !== dir && !path.startsWith(dir + sep)) return null
  try {
    if (!(await stat(path)).isFile()) return null
  } catch {
    return null
  }
  return new Response(Bun.file(path), { headers: { 'content-type': contentType(path), 'cache-control': 'no-store' } })
}

/** Starts the preview server for the format-2 template at `root`. */
export async function startDevServer(root: string, options: DevServerOptions = {}): Promise<DevServer> {
  const scratch = await mkdtemp(join(tmpdir(), 'hct-dev-'))
  const runtimeDir = join(scratch, 'runtime')
  await writeRuntime(await buildRuntime(root), runtimeDir)
  const fixtures = await readFixtures('2026-11')

  let build: Build | null = null
  let buildError = ''
  let tokens: Record<string, string> = {}
  let generation = 0
  const listeners = new Set<ReadableStreamDefaultController<string>>()

  async function rebuild(): Promise<void> {
    const n = ++generation
    const dir = join(scratch, `build-${n}`)
    try {
      const template = await loadTemplate(root)
      if (!isFormat2(template)) throw new CommandError('template.json no longer says "format": 2; restart hct dev')
      const { manifest } = await buildFormat2(template, { outDir: dir, localPaths: true, runtimeDir })
      const bundle = loadBundle(runtimeDir, join(dir, manifest.entry.server))
      const previous = build
      build = { dir, manifest, bundle }
      tokens = template.manifest.tokens
      buildError = ''
      if (previous) await rm(previous.dir, { recursive: true, force: true })
      options.onBuild?.({ ok: true, message: `built ${manifest.build_id.slice(0, 12)}` })
    } catch (e) {
      buildError = e instanceof Error ? e.message : String(e)
      await rm(dir, { recursive: true, force: true })
      options.onBuild?.({ ok: false, message: buildError })
    }
    for (const listener of listeners) {
      try {
        listener.enqueue(`data: ${n}\n\n`)
      } catch {
        listeners.delete(listener)
      }
    }
  }

  await rebuild()

  // Rebuild when the template changes, once a burst of saves is over.
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  const ignored = (file: string) => {
    const first = file.split(/[\\/]/)[0] ?? ''
    return first === 'node_modules' || first === 'dist' || first.startsWith('.') || file.split(/[\\/]/).includes('node_modules')
  }
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(root, { recursive: true }, (_event, file) => {
      if (file && ignored(String(file))) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        running = running.then(rebuild)
      }, 120)
    })
  } catch (e) {
    process.stderr.write(`hct dev: cannot watch ${root} for changes (${(e as Error).message}); reload by restarting\n`)
  }

  async function payloadFromFile(): Promise<{ payload: Record<string, any>; problems: string[] }> {
    const file = resolve(options.payloadFile!)
    let payload: Record<string, any>
    try {
      payload = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
    } catch (e) {
      throw new CommandError(`${file}: ${(e as Error).message}`)
    }
    const pageId = payload?.page?.id
    if (typeof pageId !== 'string') throw new CommandError(`${file} is not a page envelope: it has no page.id`)
    const problems = validate('2026-11', pageId, payload, { allowUnknownKeys: true }).map((e) => `${e.path}: ${e.message}`)
    return { payload, problems }
  }

  function indexPage(): string {
    const b = build
    const implemented = new Set(b?.bundle.pages ?? [])
    const hasLayout = (b?.bundle.layouts.length ?? 0) > 0
    const rows = TEMPLATE_PAGE_IDS.map((id) => {
      const names = fixtures.filter((f) => f.value.page?.id === id).map((f) => f.name)
      const status = implemented.has(id) ? 'your page' : 'the platform default page'
      return `<tr><td><code>${escapeHtml(id)}</code></td><td>${status}</td><td>${names
        .map((n) => `<a href="/page/${encodeURIComponent(id)}/${encodeURIComponent(n)}">${escapeHtml(n)}</a> <small>(<a href="/page/${encodeURIComponent(id)}/${encodeURIComponent(n)}?variant=minimal">minimal</a>)</small>`)
        .join('<br>')}</td></tr>`
    }).join('')
    const platform = PAGES.filter((p) => p.upstream !== 'engine')
      .map((p) => `<a href="/page/${encodeURIComponent(p.id)}/home?variant=minimal"><code>${escapeHtml(p.id)}</code></a>`)
      .join(' ')
    const own = options.payloadFile
      ? `<h2>Your payload</h2><p><a href="/page/_/${PAYLOAD_FIXTURE}">${escapeHtml(options.payloadFile)}</a> (<a href="/page/_/${PAYLOAD_FIXTURE}?variant=minimal">minimal</a>)</p>`
      : ''
    const status = buildError
      ? `<p style="color:#b91c1c"><strong>The last build failed</strong>; pages show its error until a change builds.</p>`
      : b
        ? `<p>Build <code>${b.manifest.build_id.slice(0, 12)}</code> · layout: ${hasLayout ? 'yours' : 'the platform default'} · islands: ${b.manifest.islands.join(', ') || 'none'}</p>`
        : ''
    return page(
      'hct dev',
      '',
      `<main style="font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 16px"><h1>${escapeHtml(b?.manifest.template_id ?? 'template')} — every page</h1>${status}${own}<h2>Storefront pages</h2><table cellpadding="6" style="border-collapse:collapse"><thead><tr><th align="left">page</th><th align="left">rendered by</th><th align="left">fixtures</th></tr></thead><tbody>${rows}</tbody></table><h2>Platform pages</h2><p>Checkout, login and the account area are the platform's own, drawn inside your layout's minimal variant: ${platform}</p></main>`,
    )
  }

  function preview(pageId: string, fixtureName: string, payload: Record<string, any>, variant: 'default' | 'minimal', problems: string[]): Response {
    const b = build!
    const implemented = b.bundle.pages.includes(pageId)
    const hasLayout = b.bundle.layouts.length > 0
    const platformPage = !TEMPLATE_PAGE_IDS.includes(pageId)
    const env = {
      build_id: b.manifest.build_id,
      asset_base: BUILD_BASE,
      locale: payload.store?.locale ?? 'en',
      currency: payload.store?.currency ?? 'USD',
      mode: (implemented && hasLayout ? 'document' : 'composed') as 'document' | 'composed',
    }
    const render = (kind: 'document' | 'layout' | 'body') =>
      (JSON.parse(b.bundle.render(JSON.stringify({ kind, page: pageId, variant, payload, env }))) as { html: string }).html

    const missing = platformPage
      ? standIn(`The platform's ${pageId} page appears here`, 'It is the platform\'s own page, drawn inside your layout\'s minimal variant.')
      : standIn("The platform's default page appears here", `This template does not implement ${pageId}; the platform's default template renders it.`)
    let rootHtml: string
    let script = ''
    let mount: string | null = null
    let shown: string
    try {
      if (implemented && hasLayout) {
        rootHtml = render('document')
        shown = 'your layout and page'
      } else if (hasLayout) {
        rootHtml = render('layout').replace('<hc-outlet></hc-outlet>', `<hc-outlet>${missing}</hc-outlet>`)
        shown = 'your layout, the platform page'
      } else if (implemented) {
        rootHtml = `${standIn("The platform's default layout appears here", 'This template has no src/layout.tsx.')}<hc-outlet>${render('body')}</hc-outlet>`
        mount = 'body'
        shown = 'the platform layout, your page'
      } else {
        rootHtml = missing
        shown = 'the platform renders all of it'
      }
    } catch (e) {
      return new Response(errorPage(`${pageId} / ${fixtureName} did not render`, (e as Error).message), {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    const hydrates = implemented || hasLayout
    if (hydrates) {
      const g = { v: 2, payload, env, mode: env.mode, page: pageId, variant, ...(mount ? { defer: true } : {}) }
      const entry = `${BUILD_BASE}${b.manifest.entry.client_js.replace(/^client\//, '')}`
      script = `<script>window.__HC__ = ${scriptJson(g)}</script>${
        mount ? `<script type="module">import { mount } from ${scriptJson(entry)}; mount(${scriptJson(mount)})</script>` : `<script type="module" src="${entry}"></script>`
      }`
    }
    const importMap = {
      imports: Object.fromEntries(Object.entries(RUNTIME_CLIENT_FILES).map(([spec, file]) => [spec, `${RUNTIME_BASE}${file}`])),
    }
    const css = b.manifest.entry.css ? `<link rel="stylesheet" href="${BUILD_BASE}${b.manifest.entry.css.replace(/^client\//, '')}">` : ''
    const head = `<style>${tokensCss(tokens, payload)} hc-outlet,hc-island{display:contents}</style>${css}<script type="importmap">${scriptJson(importMap)}</script>`
    const here = fixtureName === PAYLOAD_FIXTURE ? `/page/_/${PAYLOAD_FIXTURE}` : `/page/${encodeURIComponent(pageId)}/${encodeURIComponent(fixtureName)}`
    const variants = (['default', 'minimal'] as const).map((v) => link(v === 'minimal' ? `${here}?variant=minimal` : here, v, v === variant))
    const bar = toolbar([
      link('/', '← all pages'),
      `<span><code>${escapeHtml(pageId)}</code> · ${escapeHtml(fixtureName)} · ${escapeHtml(shown)}</span>`,
      `<span>layout: ${variants.join(' ')}</span>`,
      ...(problems.length > 0 ? [`<span title="${escapeHtml(problems.join('\n'))}" style="color:#fca5a5">${problems.length} contract problem(s) in the payload</span>`] : []),
    ])
    const title = typeof payload.meta?.title === 'string' && payload.meta.title !== '' ? payload.meta.title : pageId
    return new Response(page(title, head, `<div id="hc-root">${rootHtml}</div>${bar}${script}`), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const server = Bun.serve({
    port: options.port ?? 4173,
    hostname: '127.0.0.1',
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname
      const html = (body: string, status = 200) =>
        new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

      if (path === '/_dev/events') {
        let own: ReadableStreamDefaultController<string> | null = null
        const stream = new ReadableStream<string>({
          start(controller) {
            own = controller
            listeners.add(controller)
            controller.enqueue(': connected\n\n')
          },
          cancel() {
            if (own) listeners.delete(own)
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
      }
      if (path.startsWith(RUNTIME_BASE)) {
        return (await fileIn(runtimeDir, path.slice(RUNTIME_BASE.length))) ?? new Response('not found', { status: 404 })
      }
      if (path === '/' || path === '') return html(indexPage())
      if (buildError) return html(errorPage('The template did not build', buildError), 500)
      if (!build) return html(errorPage('Building…', 'The first build has not finished yet.'), 503)
      const clientDir = join(build.dir, 'client')
      if (path.startsWith(BUILD_BASE)) {
        return (await fileIn(clientDir, path.slice(BUILD_BASE.length))) ?? new Response('not found', { status: 404 })
      }

      const match = /^\/page\/([^/]+)\/([^/]+)$/.exec(path)
      if (match) {
        const variant = url.searchParams.get('variant') === 'minimal' ? 'minimal' : 'default'
        const pageId = decodeURIComponent(match[1]!)
        const fixtureName = decodeURIComponent(match[2]!)
        if (pageId === '_' && fixtureName === PAYLOAD_FIXTURE && options.payloadFile) {
          try {
            const { payload, problems } = await payloadFromFile()
            return preview(payload.page.id, PAYLOAD_FIXTURE, payload, variant, problems)
          } catch (e) {
            return html(errorPage('Your payload could not be read', (e as Error).message), 400)
          }
        }
        const fixture = fixtures.find((f) => f.name === fixtureName)
        const known = PAGES.some((p) => p.id === pageId)
        if (!fixture || !known) return html(errorPage('No such page', `${pageId} / ${fixtureName}`), 404)
        const payload = JSON.parse(fixture.json) as Record<string, any>
        if (!TEMPLATE_PAGE_IDS.includes(pageId)) {
          // A platform page: the layout gets the store, nav and settings, and no page data.
          payload.page = { id: pageId, params: {} }
          delete payload.data
        } else if (payload.page.id !== pageId) {
          return html(errorPage('No such page', `fixture ${fixtureName} is for ${payload.page.id}, not ${pageId}`), 404)
        }
        return preview(pageId, fixtureName, payload, variant, [])
      }
      // Root-absolute references to public files (url('/images/x.svg')).
      const file = await fileIn(clientDir, path.slice(1))
      if (file) return file
      // A store path, as the links in the fixtures are: shown with the fixture
      // for that page whose path parameters match, or its first fixture.
      const routed = matchPath(path)
      if (routed) {
        const candidates = fixtures.filter((f) => f.value.page?.id === routed.id)
        const exact = candidates.find((f) => JSON.stringify(f.value.page.params ?? {}) === JSON.stringify(routed.params))
        const fixture = exact ?? candidates[0] ?? fixtures.find((f) => f.name === 'home')
        if (fixture) {
          const target = `/page/${encodeURIComponent(routed.id)}/${encodeURIComponent(fixture.name)}${TEMPLATE_PAGE_IDS.includes(routed.id) ? '' : '?variant=minimal'}`
          return new Response(null, { status: 302, headers: { location: target } })
        }
      }
      return html(errorPage('No such page', `${path} is not a page of the fixtures`), 404)
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/`,
    rebuild: () => (running = running.then(rebuild)),
    async stop() {
      watcher?.close()
      if (timer) clearTimeout(timer)
      for (const listener of listeners) {
        try {
          listener.close()
        } catch {
          // Already closed by the browser.
        }
      }
      await server.stop(true)
      await rm(scratch, { recursive: true, force: true })
    },
  }
}

/** hct dev [dir] [--port <n>] [--payload <file>] */
export async function devCommand(root: string, flags: Flags): Promise<number> {
  const template = await loadTemplate(root)
  if (!isFormat2(template)) {
    // A format-1 template runs its own Vite config, which serves its dev
    // harness against its own fixtures.
    const proc = Bun.spawn(['bunx', 'vite'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] })
    return await proc.exited
  }
  const portFlag = stringFlag(flags, 'port')
  const port = portFlag === undefined ? 4173 : Number(portFlag)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CommandError(`--port must be a port number, got ${JSON.stringify(portFlag)}`)
  const payloadFile = stringFlag(flags, 'payload')
  const server = await startDevServer(root, {
    port,
    ...(payloadFile ? { payloadFile } : {}),
    onBuild: ({ ok, message }) => process.stdout.write(`${ok ? '✓' : '✗'} ${message}\n`),
  })
  process.stdout.write(`hct dev: ${server.url}\n`)
  const stop = async () => {
    await server.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  await new Promise(() => {})
  return 0
}
