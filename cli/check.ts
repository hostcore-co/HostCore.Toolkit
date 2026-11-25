import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { PAGES } from '../contract/dist/ts/registry'
import { TOOLKIT_CONTRACT_DIR } from '../contract/src/generate'
import { buildTemplate } from './build'
import { buildFormat2 } from './build-v2'
import { digest, type ManifestV2 } from './manifest'
import { buildRuntime, readRuntime, writeRuntime } from './runtime'
import { loadBundleSource, loadLegacyBundle, type LoadedBundle } from './sandbox'
import { isFormat2, loadTemplate } from './template'
import { CommandError, quietStdout, stringFlag, type Flags } from './commands'
import { scanBuiltStylesheets } from './validate'

/**
 * hct check — renders a build against every contract fixture, the way the
 * platform does before it accepts a build.
 *
 * A format-2 build renders every page it implements against every fixture
 * for that page, as a whole document: its layout with the page inside, in
 * the layout's minimal variant for a checkout page. A page it does not
 * implement is the platform's default template's, and is not rendered here.
 * A format-1 build renders every contract "1" fixture. Each render is
 * reported with the sha256 of its HTML, so two builds render the same when
 * their results have the same keys and hashes.
 *
 * Before anything is rendered, the build itself is checked: a format-2
 * build must hold exactly the files its manifest lists, each with the
 * listed digest and size, and no build's stylesheet may load from another
 * site. Each problem is a result of kind "build" (see CheckResult), and a
 * build with any is not rendered at all.
 */

/**
 * `build` is a problem with the build itself rather than a render: its
 * `page`, `fixture` and `variant` are "", and `error` starts with
 * HC_BUILD_FILES or HC_STYLESHEET_EXTERNAL.
 */
export type CheckKind = 'document' | 'legacy' | 'build'

/** One render, or one problem with the build. `variant` is the layout variant of a `document` render. */
export interface CheckResult {
  page: string
  fixture: string
  kind: CheckKind
  variant: string
  ok: boolean
  /** sha256 of the UTF-8 HTML, as 64 hex characters; "" when the render failed. */
  html_sha256: string
  /** Bytes of the UTF-8 HTML; 0 when the render failed. */
  bytes: number
  /** The render's error message; "" when it rendered. */
  error: string
}

export interface CheckSizes {
  /** The server bundle. */
  server: number
  /** Every JavaScript file the build sends to the browser, together. */
  client_js: number
  /** The stylesheet. */
  css: number
}

/** What `hct check --json` prints. */
export interface CheckReport {
  build_id: string
  contract: string
  protocol: number
  ok: boolean
  results: CheckResult[]
  sizes: CheckSizes
}

/**
 * Sizes `hct check` reports a build against. They are guidance for authors:
 * a build over budget is reported but still passes.
 */
export const DEFAULT_BUDGETS: CheckSizes = {
  server: 1024 * 1024,
  client_js: 250 * 1024,
  css: 100 * 1024,
}

/**
 * The environment every check render uses. It names no build, so two builds
 * of the same template render byte-identical HTML.
 */
export const CHECK_ASSET_BASE = '/_hc/check/'

const LEGACY_PAGE_IDS: Record<string, string> = {
  home: 'home',
  group: 'catalog.group',
  service: 'catalog.service',
  domains: 'domains',
  'not-found': 'not-found',
}

/** The build cannot be checked at all, as opposed to a render failing. */
export class CheckError extends CommandError {}

interface Fixture {
  name: string
  json: string
  value: Record<string, any>
}

/** The fixtures of one contract, sorted by name. */
export async function readFixtures(contract: string, contractDir = TOOLKIT_CONTRACT_DIR): Promise<Fixture[]> {
  const dir = join(contractDir, 'fixtures', contract)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort()
  } catch {
    throw new CheckError(`this toolkit has no fixtures for contract ${JSON.stringify(contract)}`)
  }
  return Promise.all(
    names.map(async (file) => {
      const json = await readFile(join(dir, `${file}.json`), 'utf8')
      return { name: file, json, value: JSON.parse(json) as Record<string, any> }
    }),
  )
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function rendered(base: Omit<CheckResult, 'ok' | 'html_sha256' | 'bytes' | 'error'>, render: () => string): CheckResult {
  try {
    const html = render()
    return { ...base, ok: true, html_sha256: sha256(html), bytes: Buffer.byteLength(html, 'utf8'), error: '' }
  } catch (e) {
    return { ...base, ok: false, html_sha256: '', bytes: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

function envFor(payload: Record<string, any>) {
  return {
    build_id: '',
    asset_base: CHECK_ASSET_BASE,
    locale: typeof payload.store?.locale === 'string' ? payload.store.locale : 'en',
    currency: typeof payload.store?.currency === 'string' ? payload.store.currency : 'USD',
  }
}

function htmlOf(output: string): string {
  const parsed = JSON.parse(output) as { html?: unknown }
  if (typeof parsed.html !== 'string') throw new Error('render() did not return {"html": "…"}')
  return parsed.html
}

/** The page's own markup in a render: what is inside the layout's outlet. */
function pageMarkup(html: string): string {
  const start = html.indexOf('<hc-outlet>')
  const end = html.lastIndexOf('</hc-outlet>')
  return start === -1 || end < start ? '' : html.slice(start + '<hc-outlet>'.length, end)
}

/**
 * Whether a page's markup is empty: nothing but HTML comments and
 * whitespace, as when the page component returns null, an empty fragment or
 * only empty strings. One element, even an empty one, or one character of
 * text makes a page that is not empty.
 */
export function isEmptyMarkup(markup: string): boolean {
  return markup.replace(/<!--[\s\S]*?-->/g, '').trim() === ''
}

/** The error of a page render whose page markup is empty. */
export function emptyRenderError(page: string, fixture: string, variant: string): string {
  return `HC_EMPTY_RENDER: page "${page}" rendered nothing for fixture "${fixture}" (variant ${variant}): a page must render at least one element or some text`
}

/** The layout variant a page is drawn in: `minimal` for a checkout page, `default` for the storefront. */
export function layoutVariantFor(page: string): 'default' | 'minimal' {
  return PAGES.find((p) => p.id === page)?.tier === 'checkout' ? 'minimal' : 'default'
}

/** Renders a loaded format-2 bundle against the fixtures. */
export function checkBundle(bundle: LoadedBundle, fixtures: Fixture[]): CheckResult[] {
  const results: CheckResult[] = []
  /** A document render that fails when the page's own markup is empty. */
  const renderPage = (page: string, fixture: string, variant: string, payload: Record<string, any>) => {
    const html = htmlOf(bundle.render(JSON.stringify({ kind: 'document', page, variant, payload, env: envFor(payload) })))
    if (isEmptyMarkup(pageMarkup(html))) throw new Error(emptyRenderError(page, fixture, variant))
    return html
  }

  for (const page of bundle.pages) {
    const variant = layoutVariantFor(page)
    for (const fixture of fixtures.filter((f) => f.value.page?.id === page)) {
      // Each render gets its own copy: a payload is never shared between renders.
      const payload = JSON.parse(fixture.json) as Record<string, any>
      results.push(rendered({ page, fixture: fixture.name, kind: 'document', variant }, () => renderPage(page, fixture.name, variant, payload)))
    }
  }
  return results
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  }
  return out.sort()
}

async function size(path: string): Promise<number> {
  return (await stat(path)).size
}

/** Where the runtime a format-2 check renders with comes from. */
export type RuntimeSource = { dir: string } | { root: string }

async function runtimeServerSource(source: RuntimeSource): Promise<{ id: string; server: string }> {
  if ('dir' in source) {
    const json = await readRuntime(source.dir)
    return { id: json.runtime_id, server: await readFile(join(source.dir, 'server.cjs'), 'utf8') }
  }
  const built = await buildRuntime(source.root)
  return { id: built.json.runtime_id, server: new TextDecoder().decode(built.files['server.cjs']) }
}

/** A result for a problem with the build itself. */
function buildProblem(error: string): CheckResult {
  return { page: '', fixture: '', kind: 'build', variant: '', ok: false, html_sha256: '', bytes: 0, error }
}

/** A path as a manifest must write it: relative, with "/" separators, inside the build. */
function isBuildPath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.includes('\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/**
 * Compares a format-2 build with its manifest: every listed file is
 * present with the listed digest and size, every file present is listed,
 * and the entries are among the listed files. Returns one message per
 * problem.
 */
export async function verifyBuildFiles(dist: string, manifest: ManifestV2): Promise<string[]> {
  const problems: string[] = []
  const listed = manifest.files && typeof manifest.files === 'object' ? manifest.files : {}
  const present = new Set<string>()
  for (const entry of await readdir(dist, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue
    const path = relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/')
    if (path === 'manifest.json') continue
    if (!entry.isFile()) problems.push(`${path} is in the build but is not a regular file`)
    else present.add(path)
  }
  for (const [path, file] of Object.entries(listed)) {
    if (!isBuildPath(path)) {
      problems.push(`manifest.json lists ${JSON.stringify(path)}, which is not a path inside the build`)
      continue
    }
    if (!present.has(path)) {
      problems.push(`${path} is listed in manifest.json but missing from the build`)
      continue
    }
    const bytes = await readFile(join(dist, path))
    const found = { integrity: digest(bytes), bytes: bytes.byteLength }
    if (found.integrity !== file?.integrity || found.bytes !== file?.bytes) {
      problems.push(
        `${path} does not match manifest.json: listed ${String(file?.integrity)} (${String(file?.bytes)} bytes), found ${found.integrity} (${found.bytes} bytes)`,
      )
    }
  }
  for (const path of [...present].sort()) {
    if (!Object.prototype.hasOwnProperty.call(listed, path)) problems.push(`${path} is in the build but not listed in manifest.json`)
  }
  const entry = manifest.entry ?? ({} as Partial<ManifestV2['entry']>)
  for (const [name, path] of [
    ['server', entry.server],
    ['client_js', entry.client_js],
    ['css', entry.css],
  ] as const) {
    if (name === 'css' && path === '') continue
    if (typeof path !== 'string' || !Object.prototype.hasOwnProperty.call(listed, path)) {
      problems.push(`manifest.json's entry.${name} ${JSON.stringify(path ?? null)} is not one of its files`)
    }
  }
  return problems.map((p) => `HC_BUILD_FILES: ${p}`)
}

/** The stylesheet rule applied to every .css file of a build. */
async function verifyStylesheets(dist: string): Promise<string[]> {
  return (await scanBuiltStylesheets(dist)).map((f) => `HC_STYLESHEET_EXTERNAL: ${f.file}${f.line > 0 ? `:${f.line}` : ''}: ${f.message}`)
}

export interface DistCheck {
  report: CheckReport
  /** template_id@version from the build's manifest. */
  label: string
  /** The runtime rendered with, when it is not the one the build names. */
  runtimeMismatch?: { build: string; used: string }
}

/** Checks an existing build directory. */
export async function checkDist(distDir: string, runtime: RuntimeSource): Promise<DistCheck> {
  const dist = resolve(distDir)
  let manifest: Record<string, any>
  try {
    manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8')) as Record<string, any>
  } catch {
    throw new CheckError(`no readable manifest.json in ${dist}`)
  }
  const label = `${manifest.template_id}@${manifest.version}`

  if (manifest.manifest_version === undefined) {
    const problems = await verifyStylesheets(dist)
    if (problems.length > 0) {
      return {
        label,
        report: { build_id: '', contract: '1', protocol: 1, ok: false, results: problems.map(buildProblem), sizes: { server: 0, client_js: 0, css: 0 } },
      }
    }
    const fixtures = await readFixtures('1')
    const bundle = loadLegacyBundle(join(dist, 'server', 'entry.server.cjs'))
    const results = fixtures.map((fixture) =>
      rendered(
        { page: LEGACY_PAGE_IDS[fixture.value.page_type] ?? String(fixture.value.page_type), fixture: fixture.name, kind: 'legacy', variant: '' },
        () => bundle.render(fixture.json),
      ),
    )
    const files = await listFiles(join(dist, 'client'))
    let clientJs = 0
    let css = 0
    for (const file of files) {
      if (file.endsWith('.js')) clientJs += await size(join(dist, 'client', file))
      else if (file.endsWith('.css')) css += await size(join(dist, 'client', file))
    }
    return {
      label,
      report: {
        build_id: '',
        contract: '1',
        protocol: 1,
        ok: results.every((r) => r.ok),
        results,
        sizes: { server: await size(join(dist, 'server', 'entry.server.cjs')), client_js: clientJs, css },
      },
    }
  }

  if (manifest.manifest_version !== 2) {
    throw new CheckError(`${join(dist, 'manifest.json')} has manifest_version ${JSON.stringify(manifest.manifest_version)}, which this toolkit does not know`)
  }
  const m = manifest as unknown as ManifestV2
  const problems = await verifyBuildFiles(dist, m)
  if (problems.length === 0) problems.push(...(await verifyStylesheets(dist)))
  if (problems.length > 0) {
    return {
      label,
      report: {
        build_id: typeof m.build_id === 'string' ? m.build_id : '',
        contract: typeof m.contract === 'string' ? m.contract : '',
        protocol: 2,
        ok: false,
        results: problems.map(buildProblem),
        sizes: { server: 0, client_js: 0, css: 0 },
      },
    }
  }
  const { id, server } = await runtimeServerSource(runtime)
  const bundle = loadBundleSource(server, await readFile(join(dist, m.entry.server), 'utf8'), m.entry.server)
  if (bundle.protocol !== 2) throw new CheckError(`${m.entry.server} exports protocol ${bundle.protocol}, not 2`)
  const results = checkBundle(bundle, await readFixtures(m.contract))
  let clientJs = 0
  for (const [path, file] of Object.entries(m.files)) {
    if (path.startsWith('client/') && path.endsWith('.js')) clientJs += file.bytes
  }
  return {
    label,
    ...(id !== m.runtime.id ? { runtimeMismatch: { build: m.runtime.id, used: id } } : {}),
    report: {
      build_id: m.build_id,
      contract: m.contract,
      protocol: 2,
      ok: results.every((r) => r.ok),
      results,
      sizes: {
        server: m.files[m.entry.server]?.bytes ?? 0,
        client_js: clientJs,
        css: m.entry.css ? (m.files[m.entry.css]?.bytes ?? 0) : 0,
      },
    },
  }
}

/**
 * Builds the template at `root` into a temporary directory and checks the
 * build. With `runtimeDir` the build and the renders use that runtime;
 * otherwise one is built from the template's own React.
 */
export async function checkTemplate(root: string, runtimeDir?: string): Promise<DistCheck> {
  const template = await loadTemplate(root)
  const scratch = await mkdtemp(join(tmpdir(), 'hct-check-'))
  try {
    const out = join(scratch, 'dist')
    if (isFormat2(template)) {
      let runtime = runtimeDir ? resolve(runtimeDir) : undefined
      if (!runtime) {
        runtime = join(scratch, 'runtime')
        await writeRuntime(await buildRuntime(template.root), runtime)
      }
      await buildFormat2(template, { outDir: out, localPaths: true, runtimeDir: runtime })
      return await checkDist(out, { dir: runtime })
    }
    await buildTemplate(template, { outDir: out, localPaths: true })
    return await checkDist(out, { root: template.root })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Reads a size such as `250000`, `250k`, `250kb` or `1.5mb` as bytes. */
export function parseBytes(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|k|kb|kib|m|mb|mib)?\s*$/i.exec(text)
  if (!match) return null
  const unit = (match[2] ?? 'b').toLowerCase()
  const factor = unit.startsWith('k') ? 1024 : unit.startsWith('m') ? 1024 * 1024 : 1
  return Math.round(Number(match[1]) * factor)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const SIZE_LABELS: Record<keyof CheckSizes, string> = {
  server: 'server bundle',
  client_js: 'client JavaScript',
  css: 'stylesheet',
}

/** The human-readable report: one line per failure, a summary, and sizes against budgets. */
export function formatCheck(check: DistCheck, budgets: CheckSizes): string {
  const { report } = check
  const lines: string[] = []
  const format = report.protocol === 2 ? `format 2, contract ${report.contract}` : 'format 1, contract 1'
  lines.push(`check ${check.label} (${format}${report.build_id ? `, build ${report.build_id.slice(0, 12)}` : ''})`)
  if (check.runtimeMismatch) {
    lines.push(`  note: rendered with runtime ${check.runtimeMismatch.used.slice(0, 12)}, the build names ${check.runtimeMismatch.build.slice(0, 12)}`)
  }
  const problems = report.results.filter((r) => r.kind === 'build')
  if (problems.length > 0) {
    for (const r of problems) lines.push(`  ✗ ${r.error}`)
    lines.push(`✗ the build failed ${problems.length} check(s) and was not rendered`)
    return `${lines.join('\n')}\n`
  }
  for (const r of report.results.filter((r) => !r.ok)) {
    lines.push(`  ✗ ${r.page}  fixture ${r.fixture}  ${r.kind}: ${r.error}`)
  }
  const failed = report.results.filter((r) => !r.ok).length
  if (report.results.length === 0) {
    lines.push('  the template implements no page: the platform\'s default template renders every page')
  } else {
    lines.push(`  ${report.results.length} renders, ${report.results.length - failed} ok, ${failed} failed`)
  }
  lines.push('sizes')
  for (const key of Object.keys(SIZE_LABELS) as (keyof CheckSizes)[]) {
    const over = report.sizes[key] > budgets[key]
    lines.push(
      `  ${SIZE_LABELS[key].padEnd(18)} ${formatBytes(report.sizes[key]).padStart(9)}   budget ${formatBytes(budgets[key])}${over ? '   OVER BUDGET' : ''}`,
    )
  }
  lines.push(report.ok ? '✓ every render succeeded' : `✗ ${failed} render(s) failed`)
  return `${lines.join('\n')}\n`
}

/** hct check [dir] [--dist <dir>] [--runtime <dir>] [--json] [--budget-* <size>] */
export async function checkCommand(root: string, flags: Flags): Promise<number> {
  const budgets = { ...DEFAULT_BUDGETS }
  for (const [flag, key] of [
    ['budget-server', 'server'],
    ['budget-client-js', 'client_js'],
    ['budget-css', 'css'],
  ] as const) {
    const raw = stringFlag(flags, flag)
    if (raw === undefined) continue
    const bytes = parseBytes(raw)
    if (bytes === null) throw new CommandError(`--${flag} needs a size such as 250000, 250kb or 1mb`)
    budgets[key] = bytes
  }
  const runtime = stringFlag(flags, 'runtime')
  const dist = stringFlag(flags, 'dist')
  const run = () =>
    dist ? checkDist(dist, runtime ? { dir: resolve(runtime) } : { root }) : checkTemplate(root, runtime)
  const json = flags.json === true
  const result = json ? await quietStdout(run) : await run()
  process.stdout.write(json ? `${JSON.stringify(result.report)}\n` : formatCheck(result, budgets))
  return result.report.ok ? 0 : 1
}
