import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { buildId, canonicalJson, signingPayload, type ManifestV2 } from '../manifest'
import type { RuntimeJson } from '../runtime'
import { hct, loadBundle, runtimeModules, type LoadedBundle } from './host'

const REPO = join(import.meta.dir, '..', '..')
const FIXTURES = join(REPO, 'contract', 'fixtures', '2026-11')
// Scratch space inside the repository, two levels down like examples/<name>,
// so a copied example still finds the installed packages.
const TMP = join(REPO, '.test-tmp', `build-v2-${process.pid}`)
const RUNTIME = join(TMP, 'runtime')

const ENV = { build_id: 'b'.repeat(64), asset_base: '/_hc/b/test/client/', locale: 'en', currency: 'USD', mode: 'document' }

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  }
  return out.sort()
}

async function build(source: string, out: string, ...extra: string[]): Promise<ManifestV2> {
  const result = await hct(['build', source, '--local-paths', '--out', out, ...extra])
  if (result.code !== 0) throw new Error(`hct build ${source} failed:\n${result.stderr}`)
  return readJson<ManifestV2>(join(out, 'manifest.json'))
}

async function fixtures(): Promise<Array<{ name: string; payload: Record<string, any> }>> {
  const names = (await readdir(FIXTURES)).filter((f) => f.endsWith('.json')).sort()
  return Promise.all(names.map(async (f) => ({ name: f.replace(/\.json$/, ''), payload: await readJson<Record<string, any>>(join(FIXTURES, f)) })))
}

function request(kind: string, payload: Record<string, any>, page = payload.page.id as string, variant = 'default'): string {
  return JSON.stringify({ kind, page, variant, payload, env: ENV })
}

function html(output: string): string {
  const parsed = JSON.parse(output) as { html: unknown }
  expect(Object.keys(parsed)).toEqual(['html'])
  expect(typeof parsed.html).toBe('string')
  return parsed.html as string
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Every href the markup links to, unescaped. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'))
}

let runtime: RuntimeJson
let basic: ManifestV2
let basicBundle: LoadedBundle
const BASIC_OUT = join(TMP, 'basic')

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
  const result = await hct(['runtime', 'build', '--out', RUNTIME])
  if (result.code !== 0) throw new Error(result.stderr)
  runtime = await readJson<RuntimeJson>(join(RUNTIME, 'runtime.json'))
  basic = await build('examples/basic', BASIC_OUT)
  basicBundle = loadBundle(RUNTIME, join(BASIC_OUT, basic.entry.server))
}, 60_000)

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('hct runtime build', () => {
  it('writes the documented files, each listed with its digest and size', async () => {
    const files = await listFiles(RUNTIME)
    expect(files.filter((f) => !/^client\/chunk\.[\w-]+\.js$/.test(f))).toEqual([
      'client/react-dom-client.js',
      'client/react-dom.js',
      'client/react-jsx-runtime.js',
      'client/react.js',
      'runtime.json',
      'server.cjs',
    ])
    expect(Object.keys(runtime.files)).toEqual(files.filter((f) => f !== 'runtime.json'))
    for (const [path, entry] of Object.entries(runtime.files)) {
      const bytes = await readFile(join(RUNTIME, path))
      expect(entry).toEqual({ integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, bytes: bytes.length })
    }
    expect(runtime.runtime_id).toBe(createHash('sha256').update(canonicalJson(runtime.files)).digest('hex'))
    expect(runtime.toolchain).toEqual({ line: 2, revision: 0 })
    expect(runtime.inventory.map((p) => [p.name, p.in])).toEqual([
      ['react', ['runtime']],
      ['react-dom', ['runtime']],
      ['scheduler', ['runtime']],
    ])
  })

  it('exports exactly the three server modules, in a bare context', () => {
    expect(Object.keys(runtimeModules(RUNTIME)).sort()).toEqual(['react', 'react-dom/server', 'react/jsx-runtime'])
  })

  it('carries one renderer: renderToString, without the streaming one', async () => {
    expect(runtimeModules(RUNTIME)['react-dom/server']).toEqual(['renderToStaticMarkup', 'renderToString', 'version'])
    const server = await readFile(join(RUNTIME, 'server.cjs'), 'utf8')
    expect(server).not.toMatch(/(^|[^.\w$])require\s*\(/)
  })

  it('is deterministic', async () => {
    const again = join(TMP, 'runtime-again')
    const result = await hct(['runtime', 'build', '--out', again])
    expect(result.code).toBe(0)
    expect((await readJson<RuntimeJson>(join(again, 'runtime.json'))).runtime_id).toBe(runtime.runtime_id)
  }, 30_000)

  it('client files import only their own chunks', async () => {
    for (const path of Object.keys(runtime.files).filter((p) => p.startsWith('client/'))) {
      const code = await readFile(join(RUNTIME, path), 'utf8')
      for (const m of code.matchAll(/from\s*["']([^"']+)["']/g)) expect(m[1]).toStartWith('./chunk.')
    }
  })
})

describe('examples/basic', () => {
  it('lists every file of the build with its digest and size', async () => {
    const files = (await listFiles(BASIC_OUT)).filter((f) => f !== 'manifest.json')
    expect(Object.keys(basic.files)).toEqual(files)
    for (const path of files) {
      const bytes = await readFile(join(BASIC_OUT, path))
      expect(basic.files[path]).toEqual({
        integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
        bytes: bytes.length,
      })
    }
    expect(files).toContain('client/images/logo.svg')
    expect(basic.entry.server).toBe('server/entry.server.cjs')
    expect(basic.entry.client_js).toMatch(/^client\/entry\.client\.[\w-]+\.js$/)
    expect(basic.entry.css).toMatch(/^client\/assets\.[\w-]+\.css$/)
  })

  it('describes the template', () => {
    expect(basic.manifest_version).toBe(2)
    expect(basic.protocol).toBe(2)
    expect(basic.contract).toBe('2026-11')
    expect(basic.toolchain).toEqual({ line: 2, revision: 0 })
    expect(basic.runtime.id).toBe(runtime.runtime_id)
    expect(basic.pages).toEqual(['home', 'catalog.group', 'catalog.service', 'checkout.plan', 'checkout.domains', 'checkout.success', 'checkout.cancel'])
    expect(basic.layouts).toEqual(['default', 'minimal'])
    expect(basic.islands).toEqual(['checkout-cancel', 'checkout-domains', 'checkout-plan', 'checkout-success', 'domain-search', 'faq'])
    expect(basic.tokens['color.accent']).toBe('#5b8cff')
    expect(basic.settings.map((s) => (s as { id: string }).id)).toContain('footer.note')
    expect(basic.media_base).toBe('')
    expect(basic.signature).toBeUndefined()
    expect(basic.build_id).toMatch(/^[0-9a-f]{64}$/)
    expect(basic.build_id).toBe(buildId(basic))
  })

  it('takes its inventory from what was bundled', () => {
    const where = Object.fromEntries(basic.inventory.map((p) => [p.name, p.in]))
    expect(where.react).toEqual(['runtime'])
    expect(where['react-dom']).toEqual(['runtime'])
    expect(where.gsap).toEqual(['client'])
    expect(where['embla-carousel-react']).toEqual(['client'])
    expect(where['@hostcore/toolkit']).toEqual(['client', 'server'])
    expect(basic.inventory.find((p) => p.name === 'gsap')?.version).toMatch(/^3\.\d+\.\d+$/)
    // Sorted, so the manifest is the same however the bundler ordered modules.
    const names = basic.inventory.map((p) => p.name)
    expect(names).toEqual([...names].sort())
  })

  it('keeps client-only libraries out of the server bundle', async () => {
    const server = await readFile(join(BASIC_OUT, basic.entry.server), 'utf8')
    expect(basic.files[basic.entry.server]!.bytes).toBeLessThan(80_000)
    // gsap's own code names its company and its tween internals; the stand-in does not.
    expect(server).not.toContain('GreenSock')
    expect(server).not.toContain('_gsap')
    expect(server).not.toContain('emblaApi')
  })

  it('requires only the runtime modules', async () => {
    const server = await readFile(join(BASIC_OUT, basic.entry.server), 'utf8')
    const required = [...server.matchAll(/(?:^|[^.\w$])require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1])
    expect([...new Set(required)].sort()).toEqual(['react', 'react-dom/server', 'react/jsx-runtime'].filter((m) => required.includes(m)))
    expect(required.length).toBeGreaterThan(0)
  })

  it('writes relative URLs in its stylesheet', async () => {
    const css = await readFile(join(BASIC_OUT, basic.entry.css), 'utf8')
    expect(css).toContain('url(./images/grid.svg)')
    expect(css).not.toMatch(/url\(\s*['"]?\//)
  })

  it('splits the client into a chunk per page, layout and island', async () => {
    const entry = await readFile(join(BASIC_OUT, basic.entry.client_js), 'utf8')
    const chunks = Object.keys(basic.files).filter((f) => /^client\/chunk\./.test(f))
    expect(chunks.length).toBeGreaterThanOrEqual(6)
    expect(entry).toMatch(/import\s*\{[^}]*hydrateRoot[^}]*\}\s*from\s*["']react-dom\/client["']/)
    expect(entry).toMatch(/export\s*\{[^}]*\bmount\b/)
  })

  it('exports protocol 2 with its pages and layouts', () => {
    expect(basicBundle.protocol).toBe(2)
    expect(basicBundle.pages).toEqual(['home', 'catalog.group', 'catalog.service', 'checkout.plan', 'checkout.domains', 'checkout.success', 'checkout.cancel'])
    expect(basicBundle.layouts).toEqual(['default', 'minimal'])
  })

  it('renders every kind of every implemented page against every fixture', async () => {
    let rendered = 0
    for (const { name, payload } of await fixtures()) {
      const page = payload.page.id as string
      if (!basicBundle.pages.includes(page)) continue
      const body = html(basicBundle.render(request('body', payload)))
      const layout = html(basicBundle.render(request('layout', payload)))
      const document = html(basicBundle.render(request('document', payload)))
      expect(body.length, name).toBeGreaterThan(0)
      expect(body, name).not.toContain('<hc-outlet')
      expect(count(layout, '<hc-outlet></hc-outlet>'), name).toBe(1)
      expect(count(layout, '<hc-outlet'), name).toBe(1)
      expect(count(document, '<hc-outlet>'), name).toBe(1)
      expect(document, name).toContain(`<hc-outlet>${body}</hc-outlet>`)
      expect(document.replace(`<hc-outlet>${body}</hc-outlet>`, '<hc-outlet></hc-outlet>'), name).toBe(layout)
      rendered++
    }
    expect(rendered).toBe(24)
  })

  it('renders the minimal layout variant', async () => {
    const payload = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    const minimal = html(basicBundle.render(request('layout', payload, 'home', 'minimal')))
    const full = html(basicBundle.render(request('layout', payload, 'home', 'default')))
    expect(minimal).not.toContain('<footer')
    expect(full).toContain('<footer')
  })

  it('takes every link from the payload', async () => {
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    const homeLinks = hrefs(html(basicBundle.render(request('document', home))))
    for (const link of [home.nav.links.home, home.nav.links.login, home.nav.links.signup, home.nav.links.terms]) {
      expect(homeLinks).toContain(link)
    }
    for (const group of home.data.groups) expect(homeLinks).toContain(group.url)

    const service = await readJson<Record<string, any>>(join(FIXTURES, 'catalog.service.json'))
    const serviceLinks = hrefs(html(basicBundle.render(request('body', service))))
    for (const plan of service.data.plans) expect(serviceLinks).toContain(plan.checkout_url)

    const group = await readJson<Record<string, any>>(join(FIXTURES, 'catalog.group.json'))
    const groupLinks = hrefs(html(basicBundle.render(request('body', group))))
    for (const card of group.data.services) expect(groupLinks).toContain(card.service.url)

    // A store without domains has no domains link and no search.
    const noDomains = await readJson<Record<string, any>>(join(FIXTURES, 'home.no-domains.json'))
    const markup = html(basicBundle.render(request('document', noDomains)))
    expect(markup).not.toContain('Domains</a>')
    expect(markup).not.toContain('data-name="domain-search"')
  })

  it('resolves asset() against env.asset_base', async () => {
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    expect(html(basicBundle.render(request('layout', home)))).toContain('src="/_hc/b/test/client/images/logo.svg"')
  })

  it('uses a setting when the store has set it, and the declared default otherwise', async () => {
    const unset = await readJson<Record<string, any>>(join(FIXTURES, 'home.unset-settings.json'))
    const markup = html(basicBundle.render(request('body', unset)))
    expect(markup).toContain('Only the headline is set')
    expect(markup).toContain('Servers online in minutes, billed monthly, cancel any time.')
  })

  it('wraps islands with their name and JSON props', async () => {
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    const markup = html(basicBundle.render(request('body', home)))
    const match = /<hc-island data-name="faq" data-props="([^"]*)">/.exec(markup)
    expect(match).not.toBeNull()
    const props = JSON.parse(match![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    expect(props).toEqual({ items: home.settings['faq.items'] })
  })

  it('implements every part of the checkout pages', async () => {
    const body = async (name: string) => html(basicBundle.render(request('body', await readJson<Record<string, any>>(join(FIXTURES, `${name}.json`)))))
    const plan = await body('checkout.plan')
    for (const part of ['Monthly', 'Quarterly', 'Annually', 'Server name', 'Daily backups', 'Map size', 'Location', 'Slots', 'Add off-site backups', 'Add a domain', 'Billing address', 'Payment', 'Card (Stripe)', 'PayPal', 'Promo code', 'One-time setup fee', 'Pay &amp; complete order', 'Terms of Service']) {
      expect([part, plan.includes(part)]).toEqual([part, true])
    }
    expect(plan).not.toContain('Bank transfer')
    expect(await body('checkout.plan.bank-transfer')).toContain('Bank transfer')
    const free = await body('checkout.plan.free')
    expect(free).toContain('Start now')
    expect(free).not.toContain('Billing address')
    expect(await body('checkout.plan.free-trial')).toContain('Free for 7 days')
    expect(await body('checkout.domains')).toContain('Loading your domain')
    expect(await body('checkout.success')).toContain('Confirming your payment')
    expect(await body('checkout.cancel')).toContain('Checkout cancelled')
  })

  it('fails clearly for a page or layout variant it does not implement', async () => {
    const domains = await readJson<Record<string, any>>(join(FIXTURES, 'domains.json'))
    expect(() => basicBundle.render(request('body', domains))).toThrow(
      'HC_PAGE_NOT_IMPLEMENTED: this template does not implement page "domains" (it implements: home, catalog.group, catalog.service, checkout.plan, checkout.domains, checkout.success, checkout.cancel)',
    )
    const notFound = await readJson<Record<string, any>>(join(FIXTURES, 'not-found.json'))
    expect(() => basicBundle.render(request('document', notFound))).toThrow('HC_PAGE_NOT_IMPLEMENTED')
    // The layout alone renders for any page, including ones the template does not implement.
    expect(count(html(basicBundle.render(request('layout', notFound))), '<hc-outlet></hc-outlet>')).toBe(1)
  })

  it('rejects malformed requests', async () => {
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    expect(() => basicBundle.render('not json')).toThrow('HC_BAD_INPUT')
    expect(() => basicBundle.render(request('page', home))).toThrow('HC_BAD_INPUT: kind must be one of document, layout, body')
    expect(() => basicBundle.render(request('body', home, 'catalog.group'))).toThrow(
      'HC_BAD_INPUT: page is "catalog.group" but the payload is for "home"',
    )
    expect(() => basicBundle.render(request('layout', home, 'home', 'wide'))).toThrow('HC_BAD_INPUT: variant')
    const { data: _data, ...noData } = home
    expect(() => basicBundle.render(request('body', noData))).toThrow('HC_BAD_INPUT: the payload for page "home" carries no data')
  })

  it('builds the same build_id twice, from another directory, and with a media base', async () => {
    // Two levels below the repository, like examples/basic, so its links to
    // the installed packages still resolve.
    const copy = join(REPO, '.test-tmp', `basic-copy-${process.pid}`)
    await cp(join(REPO, 'examples', 'basic'), copy, { recursive: true, verbatimSymlinks: true, filter: (src) => !src.includes(`${sep}dist`) })
    const again = await build(copy, join(TMP, 'basic-again'), '--runtime', RUNTIME).finally(() =>
      rm(copy, { recursive: true, force: true }),
    )
    expect(again.build_id).toBe(basic.build_id)
    expect(again.files).toEqual(basic.files)

    const published = await hct(['build', 'examples/basic', '--out', join(TMP, 'basic-cdn'), '--media-base', 'https://cdn.example.com/builds/x/client', '--runtime', RUNTIME])
    expect(published.code).toBe(0)
    const cdn = await readJson<ManifestV2>(join(TMP, 'basic-cdn', 'manifest.json'))
    expect(cdn.media_base).toBe('https://cdn.example.com/builds/x/client')
    expect(cdn.build_id).toBe(basic.build_id)
  }, 60_000)

  it('signs the manifest when given a key', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const raw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64')
    const signed = await build('examples/basic', join(TMP, 'basic-signed'), '--sign', raw, '--runtime', RUNTIME)
    expect(signed.build_id).toBe(basic.build_id)
    const ok = verify(null, Buffer.from(signingPayload(signed)), createPublicKey(publicKey.export({ format: 'pem', type: 'spki' })), Buffer.from(signed.signature!, 'base64'))
    expect(ok).toBe(true)
  }, 30_000)

  it('fails when the built stylesheet loads from another site', async () => {
    const source = join(TMP, 'external-css')
    await mkdir(join(source, 'src'), { recursive: true })
    await writeFile(join(source, 'template.json'), JSON.stringify({ id: 'external-css', version: '1.0.0', name: 'External', format: 2, contract: '2026-11', toolchain: 2 }))
    await writeFile(join(source, 'src', 'layout.tsx'), "import './styles.css'\nexport default function Layout({ children }: any) { return <main>{children}</main> }\n")
    await writeFile(join(source, 'src', 'styles.css'), 'main { background: url("https://images.example.com/hero.jpg") }\n')

    const validated = await hct(['build', source, '--local-paths', '--out', join(TMP, 'external-css-out'), '--runtime', RUNTIME])
    expect(validated.code).toBe(1)
    expect(validated.stderr).toContain('src/styles.css:1  [stylesheet-external-url] url("https://images.example.com/hero.jpg") loads from another site.')

    // Without validation, the check on the built stylesheet still catches it.
    const built = await hct(['build', source, '--local-paths', '--out', join(TMP, 'external-css-out'), '--runtime', RUNTIME, '--skip-validation'])
    expect(built.code).toBe(1)
    expect(built.stderr).toStartWith('the built stylesheet loads from another site')
    expect(built.stderr).toMatch(/client\/assets\.[\w-]+\.css:1 {2}\[stylesheet-external-url\] url\("https:\/\/images\.example\.com\/hero\.jpg"\) loads from another site\./)
    expect(await Bun.file(join(TMP, 'external-css-out', 'manifest.json')).exists()).toBe(false)
  }, 30_000)

  it('needs --media-base or --local-paths', async () => {
    const result = await hct(['build', 'examples/basic', '--out', join(TMP, 'nowhere')])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--media-base')
  })
})

describe('examples/minimal', () => {
  it('builds from template.json alone, implementing nothing', async () => {
    const out = join(TMP, 'minimal')
    const manifest = await build('examples/minimal', out, '--runtime', RUNTIME)
    expect(manifest.pages).toEqual([])
    expect(manifest.layouts).toEqual([])
    expect(manifest.islands).toEqual([])
    expect(manifest.entry.css).toBe('')
    expect(manifest.tokens).toEqual({
      'color.accent': '#5b8cff',
      'color.accent-strong': '#3d6fe6',
      'radius.md': '0.75rem',
      'font.body': '"Inter", system-ui, sans-serif',
    })
    const bundle = loadBundle(RUNTIME, join(out, manifest.entry.server))
    expect(bundle.pages).toEqual([])
    expect(bundle.layouts).toEqual([])
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    expect(() => bundle.render(request('body', home))).toThrow('HC_PAGE_NOT_IMPLEMENTED: this template does not implement page "home" (it implements: no pages)')
    expect(() => bundle.render(request('layout', home))).toThrow('HC_LAYOUT_NOT_IMPLEMENTED')
    expect(() => bundle.render(request('document', home))).toThrow('HC_LAYOUT_NOT_IMPLEMENTED')
  }, 30_000)
})

describe('render-time errors', () => {
  const dir = join(TMP, 'broken')

  beforeAll(async () => {
    await mkdir(join(dir, 'src', 'pages'), { recursive: true })
    await mkdir(join(dir, 'src', 'islands'), { recursive: true })
    await writeFile(
      join(dir, 'template.json'),
      JSON.stringify({ id: 'broken', version: '1.0.0', name: 'Broken', format: 2, contract: '2026-11', toolchain: 2 }),
    )
    await writeFile(join(dir, 'src', 'islands', 'button.tsx'), 'export default function Button(props: { onPress: () => void }) { return <button onClick={props.onPress}>Go</button> }\n')
    await writeFile(
      join(dir, 'src', 'pages', 'home.tsx'),
      [
        "import { island } from '@hostcore/toolkit'",
        "import Button from '../islands/button'",
        'const ButtonIsland = island(Button)',
        'export default function Home() { return <ButtonIsland onPress={() => {}} /> }',
      ].join('\n'),
    )
    await writeFile(join(dir, 'src', 'pages', 'not-found.tsx'), "export default function NotFound() { throw new Error('nothing here') }\n")
    await writeFile(join(dir, 'src', 'layout.tsx'), 'export default function Layout({ children }: { children: unknown }) { return <div>{children as never}{children as never}</div> }\n')
  })

  it('names the prop an island cannot carry, the component that threw, and a layout without one outlet', async () => {
    const manifest = await build(dir, join(TMP, 'broken-out'), '--runtime', RUNTIME)
    const bundle = loadBundle(RUNTIME, join(TMP, 'broken-out', manifest.entry.server))
    const home = await readJson<Record<string, any>>(join(FIXTURES, 'home.json'))
    expect(() => bundle.render(request('body', home))).toThrow(
      'HC_ISLAND_PROPS: island "button": props.onPress is a function. Island props must be JSON values',
    )
    const notFound = await readJson<Record<string, any>>(join(FIXTURES, 'not-found.json'))
    expect(() => bundle.render(request('body', notFound))).toThrow('HC_RENDER_FAILED: body of page "not-found": nothing here')
    expect(() => bundle.render(request('layout', home))).toThrow(
      'HC_LAYOUT_OUTLET: the layout must render its children (or <Outlet/>) exactly once; it rendered them 2 times',
    )
  }, 30_000)
})

describe('--toolchain-revision', () => {
  it("records the build environment's revision in a build and a runtime", async () => {
    const revised = join(TMP, 'runtime-r3')
    const made = await hct(['runtime', 'build', '--out', revised, '--toolchain-revision', '3'])
    expect(made.code).toBe(0)
    const before = await readJson<RuntimeJson>(join(RUNTIME, 'runtime.json'))
    const after = await readJson<RuntimeJson>(join(revised, 'runtime.json'))
    expect(before.toolchain).toEqual({ line: 2, revision: 0 })
    expect(after.toolchain).toEqual({ line: 2, revision: 3 })
    // The same runtime files on another revision are the same runtime.
    expect(after.runtime_id).toBe(before.runtime_id)
    expect(after.files).toEqual(before.files)

    const plain = await build('examples/minimal', join(TMP, 'minimal-r0'), '--runtime', RUNTIME)
    const stamped = await build('examples/minimal', join(TMP, 'minimal-r3'), '--runtime', RUNTIME, '--toolchain-revision', '3')
    expect(plain.toolchain).toEqual({ line: 2, revision: 0 })
    expect(stamped.toolchain).toEqual({ line: 2, revision: 3 })
    expect(stamped.files).toEqual(plain.files)
    expect(stamped.build_id).not.toBe(plain.build_id)
    expect(stamped.build_id).toBe(buildId(stamped))
  }, 120_000)

  it('takes only a non-negative whole number', async () => {
    for (const value of ['-1', '1.5', 'two', '01']) {
      const result = await hct(['build', 'examples/minimal', '--local-paths', '--out', join(TMP, 'never'), '--toolchain-revision', value])
      expect([value, result.code]).toEqual([value, 1])
      expect(result.stderr).toContain('--toolchain-revision must be a non-negative whole number')
    }
    const runtime = await hct(['runtime', 'build', '--out', join(TMP, 'never-runtime'), '--toolchain-revision'])
    expect(runtime.code).toBe(1)
    expect(runtime.stderr).toContain('--toolchain-revision must be a non-negative whole number')
  }, 60_000)
})
