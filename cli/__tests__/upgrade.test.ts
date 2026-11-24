import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { discoverSources } from '../sources'
import { STANDARD_SETTINGS } from '../../contract/src/settings'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
// Inside examples/basic, so an upgraded template resolves the format-2 toolchain basic has installed.
const TMP = join(REPO, 'examples', 'basic', '.test-tmp', `upgrade-${process.pid}`)
const MESSY = join(import.meta.dir, 'fixtures', 'upgrade-messy')

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')
    if (path.startsWith('node_modules/')) continue
    out[path] = await readFile(join(dir, path), 'utf8')
  }
  return out
}

async function copy(from: string, name: string): Promise<string> {
  const to = join(TMP, name)
  await cp(from, to, { recursive: true, filter: (src) => !relative(from, src).split(sep).includes('node_modules') })
  return to
}

/** The problems that make a template one format 2 cannot read (as opposed to policy findings). */
async function structural(dir: string): Promise<string[]> {
  const result = await hct(['validate', dir])
  const { problems } = await discoverSources(dir)
  return [...problems.map((p) => `${p.file}: ${p.message}`), ...(/template\.json:/.test(result.stderr) ? [result.stderr] : [])]
}

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
})

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('hct upgrade on examples/legacy', () => {
  let dir: string
  let output: string

  beforeAll(async () => {
    dir = await copy(join(REPO, 'examples', 'legacy'), 'legacy')
    const result = await hct(['upgrade', dir])
    if (result.code !== 0) throw new Error(result.stderr)
    output = result.stdout
  })

  it('writes one page file per page and removes App', async () => {
    const files = Object.keys(await tree(dir)).sort()
    expect(files).toEqual([
      'package.json',
      'src/pages/catalog.group.tsx',
      'src/pages/catalog.service.tsx',
      'src/pages/domains.tsx',
      'src/pages/home.tsx',
      'src/pages/not-found.tsx',
      'src/styles.css',
      'template.json',
    ])
    expect(await readFile(join(dir, 'src', 'pages', 'home.tsx'), 'utf8')).toBe(`import { useSetting, useStore } from '@hostcore/toolkit'
import '../styles.css'

export default function Home() {
  const store = useStore()
  const heroTitle = useSetting('hero.title')
  return (
    <main>
      <h1>{heroTitle}</h1>
      <p>{store.name}</p>
    </main>
  )
}
`)
    expect(await readFile(join(dir, 'src', 'pages', 'catalog.group.tsx'), 'utf8')).toContain('<h1>{page.data.group.name}</h1>')
    expect(await readFile(join(dir, 'src', 'pages', 'not-found.tsx'), 'utf8')).toContain("const page = usePage<'not-found'>()")
  })

  it('moves template.json and package.json to format 2', async () => {
    const manifest = JSON.parse(await readFile(join(dir, 'template.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'legacy', format: 2, contract: '2026-11', toolchain: 2, tokens: {} })
    expect(manifest.settings).toEqual([STANDARD_SETTINGS.find((s) => s.id === 'hero.title')])
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    expect(pkg.devDependencies).toMatchObject({ vite: '^8.3.8', '@vitejs/plugin-react': '^6.3.0' })
    expect(pkg.dependencies['@hostcore/toolkit']).toBe('workspace:*')
  })

  it('leaves a template that validates, checks and builds', async () => {
    expect(output).toContain('Left for you:')
    expect(output).not.toContain('Data access with no one-to-one mapping')
    expect((await hct(['validate', dir])).code).toBe(0)
    const check = await hct(['check', dir, '--json'])
    expect(check.code).toBe(0)
    expect(JSON.parse(check.stdout)).toMatchObject({ protocol: 2, ok: true })
  }, 60_000)

  it('refuses a template that is already format 2', async () => {
    const again = await hct(['upgrade', dir])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('already format 2')
  })
})

describe('hct upgrade on a messier template', () => {
  let dir: string
  let output: string

  beforeAll(async () => {
    dir = await copy(MESSY, 'messy')
    const result = await hct(['upgrade', dir])
    if (result.code !== 0) throw new Error(result.stderr)
    output = result.stdout
  })

  it('splits the page map, extracts the layout and moves format-1 files out of the way', async () => {
    const files = Object.keys(await tree(dir)).sort()
    expect(files).toEqual([
      'package.json',
      'src/components/Header.tsx',
      'src/layout.tsx',
      'src/pages/catalog.group.tsx',
      'src/pages/catalog.service.tsx',
      'src/pages/domains.tsx',
      'src/pages/home.tsx',
      'src/pages/not-found.tsx',
      'src/shared.tsx',
      'src/styles.css',
      'src/views/Group.tsx',
      'src/views/Home.tsx',
      'template.json',
      'vite.config.ts',
    ])
    expect(await readFile(join(dir, 'src', 'pages', 'home.tsx'), 'utf8')).toBe("export { HomeView as default } from '../views/Home'\n")
    expect(await readFile(join(dir, 'src', 'pages', 'catalog.service.tsx'), 'utf8')).toBe("export { ServiceView as default } from '../shared'\n")
    expect(await readFile(join(dir, 'src', 'pages', 'domains.tsx'), 'utf8')).toBe("export { NotFoundView as default } from '../shared'\n")
    const layout = await readFile(join(dir, 'src', 'layout.tsx'), 'utf8')
    expect(layout).toContain('<Outlet />')
    expect(layout).toContain("import { Footer } from './shared'")
    expect(layout).toContain("import './styles.css'")
    expect(layout).toContain('}, [page.meta.title, store.name])')
    expect(layout).toContain("{(nav.links.domains !== '') && <a href=\"/domains\">Find a domain</a>}")
    expect(await structural(dir)).toEqual([])
  })

  it('renames data access where the mapping is one to one', async () => {
    const home = await readFile(join(dir, 'src', 'views', 'Home.tsx'), 'utf8')
    expect(home).toContain("const heroTitle = useSetting('hero.title')")
    expect(home).toContain('<a href={heroPrimaryCta.href}>{heroPrimaryCta.label}</a>')
    expect(home).toContain('{nav.groups.map((g) => (')
    expect(home).not.toContain('useHC')
    const group = await readFile(join(dir, 'src', 'views', 'Group.tsx'), 'utf8')
    expect(group).toContain('{page.data.services.map(({ service, from: cheapest_plan }) => (')
    expect(group).toContain('{cheapest_plan.price.amount} {cheapest_plan.price.currency}')
    expect(group).toContain('{cheapest_plan.original_price && <s>{cheapest_plan.original_price.amount}</s>}')
    const header = await readFile(join(dir, 'src', 'components', 'Header.tsx'), 'utf8')
    expect(header).toStartWith("import { Link, useNav, useStore } from '@hostcore/toolkit'\n")
    expect(header).toContain('<Link href="/">{store.name}</Link>')
    const shared = await readFile(join(dir, 'src', 'shared.tsx'), 'utf8')
    expect(shared).toContain('<a href={nav.links.terms}>Terms</a>')
    expect(shared).toContain('{store.business.city}')
    expect(shared).toContain('{plan.name}: {plan.price.amount}')
  })

  it('declares the standard settings it reads and moves package.json to the format-2 ranges', async () => {
    const manifest = JSON.parse(await readFile(join(dir, 'template.json'), 'utf8'))
    expect(manifest.settings.map((s: { id: string }) => s.id)).toEqual(['hero.title', 'hero.subtitle', 'hero.primary_cta', 'faq.items'])
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toMatchObject({ clsx: '^2.1.1', react: '~19.3.1', 'react-dom': '~19.3.1' })
    expect(pkg.devDependencies).toMatchObject({ vite: '^8.3.8', '@vitejs/plugin-react': '^6.3.0', typescript: '~5.9.3' })
  })

  it('lists every hand-built URL, every access without a mapping and every setting to review', () => {
    const left = output.slice(output.indexOf('Left for you:'))
    for (const line of [
      'src/components/Header.tsx:12  `/${g.slug}` is built from slugs; use group.url',
      'src/components/Header.tsx:17  "/domains…" is built by hand; take it from the page data instead: useNav().links.domains',
      'src/components/Header.tsx:18  "/login…" is built by hand; take it from the page data instead: useNav().links.login',
      'src/layout.tsx:24  "/domains…" is built by hand; take it from the page data instead: useNav().links.domains',
      'src/views/Group.tsx:10  `/${page.data.group.slug}/${service.slug}` is built from slugs; use service.url',
      'src/views/Group.tsx:15  "/checkout…" is built by hand; take it from the page data instead: a plan\'s checkout_url',
      'src/shared.tsx:18  data: the page data is split up in format 2',
      'src/layout.tsx:18  data.page_type: page ids are named differently in format 2',
      "template.json  faq.items, hero.primary_cta, hero.subtitle, hero.title: declared with the platform's standard label, limits and default",
      'src/layout.tsx  the layout also wraps the platform\'s guarded pages (checkout, login, signup, forgotpassword, auth, connect, order)',
      'vite.config.ts  format 2 does not use it',
    ]) {
      expect(left).toContain(line)
    }
  })
})

describe('hct upgrade leaves nothing half done', () => {
  it('changes nothing with --dry-run', async () => {
    const dir = await copy(MESSY, 'dry')
    const before = await tree(dir)
    const result = await hct(['upgrade', dir, '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toStartWith('hct upgrade would make these changes (nothing was changed):\n')
    expect(result.stdout).toContain('src/pages → src/views')
    expect(await tree(dir)).toEqual(before)
  })

  it('changes nothing when it cannot convert App', async () => {
    const dir = await copy(MESSY, 'unknown-app')
    await writeFile(join(dir, 'src', 'App.tsx'), "import { useHC } from '@hostcore/toolkit'\nexport function App() {\n  const { data } = useHC()\n  return data.page_type === 'home' ? <h1>Home</h1> : <h1>Other</h1>\n}\n")
    const before = await tree(dir)
    const result = await hct(['upgrade', dir])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('App has neither a page switch')
    expect(await tree(dir)).toEqual(before)
    expect((await readdir(TMP)).filter((n) => n.startsWith('.'))).toEqual([])
  })
})
