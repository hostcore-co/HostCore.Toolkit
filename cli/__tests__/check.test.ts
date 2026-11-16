import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CheckReport } from '../check'
import { parseBytes } from '../check'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
const TMP = join(REPO, '.test-tmp', `check-${process.pid}`)
const RUNTIME = join(TMP, 'runtime')
const FIXTURES = join(REPO, 'contract', 'fixtures')

let basic: CheckReport

async function fixturesFor(contract: string): Promise<Array<{ name: string; page: string }>> {
  const names = (await readdir(join(FIXTURES, contract))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
  return Promise.all(
    names.map(async (name) => ({ name, page: JSON.parse(await readFile(join(FIXTURES, '2026-11', `${name}.json`), 'utf8')).page.id as string })),
  )
}

function parse(stdout: string): CheckReport {
  expect(stdout.trim().split('\n')).toHaveLength(1)
  return JSON.parse(stdout) as CheckReport
}

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
  const runtime = await hct(['runtime', 'build', '--out', RUNTIME])
  if (runtime.code !== 0) throw new Error(runtime.stderr)
  const result = await hct(['check', 'examples/basic', '--runtime', RUNTIME, '--json'])
  if (result.code !== 0) throw new Error(result.stderr)
  basic = parse(result.stdout)
}, 60_000)

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('hct check --json', () => {
  it('prints exactly the documented keys', () => {
    expect(Object.keys(basic)).toEqual(['build_id', 'contract', 'protocol', 'ok', 'results', 'sizes'])
    expect(basic.build_id).toMatch(/^[0-9a-f]{64}$/)
    expect(basic.contract).toBe('2026-11')
    expect(basic.protocol).toBe(2)
    expect(basic.ok).toBe(true)
    expect(Object.keys(basic.sizes)).toEqual(['server', 'client_js', 'css'])
    for (const r of basic.results) {
      expect(Object.keys(r)).toEqual(['page', 'fixture', 'kind', 'variant', 'ok', 'html_sha256', 'bytes', 'error'])
      expect(r.ok).toBe(true)
      expect(r.html_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(r.bytes).toBeGreaterThan(0)
      expect(r.error).toBe('')
    }
  })

  it('renders every implemented page against every fixture for it, as a document and a body, and the layout per variant', async () => {
    const expected: string[] = ['home/home/layout/default', 'home/home/layout/minimal']
    for (const f of await fixturesFor('2026-11')) {
      if (!['home', 'catalog.group', 'catalog.service'].includes(f.page)) continue
      expected.push(`${f.page}/${f.name}/document/`, `${f.page}/${f.name}/body/`)
    }
    const keys = basic.results.map((r) => `${r.page}/${r.fixture}/${r.kind}/${r.variant}`)
    expect(keys.sort()).toEqual(expected.sort())
  })

  it('reports the sizes of the build', () => {
    expect(basic.sizes.server).toBeGreaterThan(1000)
    expect(basic.sizes.client_js).toBeGreaterThan(basic.sizes.server)
    expect(basic.sizes.css).toBeGreaterThan(0)
  })

  it('checks an existing build with --dist, and two builds of the same source render the same', async () => {
    const built = await hct(['build', 'examples/basic', '--local-paths', '--out', join(TMP, 'dist'), '--runtime', RUNTIME])
    expect(built.code).toBe(0)
    const result = await hct(['check', '--dist', join(TMP, 'dist'), '--runtime', RUNTIME, '--json'])
    expect(result.code).toBe(0)
    const dist = parse(result.stdout)
    expect(dist.build_id).toBe(basic.build_id)
    const hashes = (r: CheckReport) => Object.fromEntries(r.results.map((x) => [`${x.page}/${x.fixture}/${x.kind}/${x.variant}`, x.html_sha256]))
    expect(hashes(dist)).toEqual(hashes(basic))
  })

  it('renders a format-1 build against the contract 1 fixtures as kind legacy', async () => {
    const result = await hct(['check', 'examples/legacy', '--json'])
    expect(result.code).toBe(0)
    const report = parse(result.stdout)
    expect(report).toMatchObject({ build_id: '', contract: '1', protocol: 1, ok: true })
    const fixtures = await fixturesFor('1')
    expect(report.results.map((r) => `${r.page}/${r.fixture}`)).toEqual(fixtures.map((f) => `${f.page}/${f.name}`))
    expect(new Set(report.results.map((r) => r.kind))).toEqual(new Set(['legacy']))
    expect(report.results.every((r) => r.variant === '' && r.ok)).toBe(true)
  }, 60_000)

  it('passes a template that implements nothing', async () => {
    const result = await hct(['check', 'examples/minimal', '--runtime', RUNTIME, '--json'])
    expect(result.code).toBe(0)
    expect(parse(result.stdout)).toMatchObject({ ok: true, results: [] })
  })
})

describe('hct check on a page that fails', () => {
  const broken = join(TMP, 'broken')

  beforeAll(async () => {
    await mkdir(join(broken, 'src', 'pages'), { recursive: true })
    await writeFile(join(broken, 'template.json'), JSON.stringify({ id: 'broken', version: '1.0.0', name: 'Broken', format: 2, contract: '2026-11', toolchain: 2 }))
    // Assumes every group has a service, which catalog.group.empty does not.
    await writeFile(
      join(broken, 'src', 'pages', 'catalog.group.tsx'),
      `import type { PageProps } from '@hostcore/toolkit'
export default function Group({ data }: PageProps<'catalog.group'>) {
  return <h1>{data.services[0]!.service.name}</h1>
}
`,
    )
  })

  it('reports the failure with its page, fixture and kind, and exits 1', async () => {
    const json = await hct(['check', broken, '--runtime', RUNTIME, '--json'])
    expect(json.code).toBe(1)
    const report = parse(json.stdout)
    expect(report.ok).toBe(false)
    const failed = report.results.filter((r) => !r.ok)
    expect(failed.map((r) => `${r.page}/${r.fixture}/${r.kind}`)).toEqual(['catalog.group/catalog.group.empty/body'])
    expect(failed[0]).toMatchObject({ html_sha256: '', bytes: 0 })
    expect(failed[0]!.error).toStartWith('HC_RENDER_FAILED: ')

    const human = await hct(['check', broken, '--runtime', RUNTIME])
    expect(human.code).toBe(1)
    expect(human.stdout).toContain('✗ catalog.group  fixture catalog.group.empty  body: HC_RENDER_FAILED')
    expect(human.stdout).toContain('1 failed')
  })

  it('prints sizes against budgets, which can be overridden', async () => {
    const human = await hct(['check', 'examples/basic', '--runtime', RUNTIME, '--budget-css', '1kb'])
    expect(human.code).toBe(0)
    expect(human.stdout).toMatch(/server bundle\s+[\d.]+ KB\s+budget 1\.00 MB\n/)
    expect(human.stdout).toMatch(/stylesheet\s+[\d.]+ KB\s+budget 1\.0 KB\s+OVER BUDGET/)
    const bad = await hct(['check', 'examples/basic', '--budget-css', 'lots'])
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('--budget-css needs a size')
  })

  it('reads sizes in bytes, kb and mb', () => {
    expect(parseBytes('2048')).toBe(2048)
    expect(parseBytes('250kb')).toBe(256000)
    expect(parseBytes('1.5MB')).toBe(1572864)
    expect(parseBytes('a lot')).toBeNull()
  })
})
