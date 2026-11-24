import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkContract, type Contract } from '../dsl'
import { contract1 } from '../contract-1'
import { contract202611 } from '../contract-2026-11'
import { downgrade } from '../downgrade'
import { LINK_CASES } from '../link-cases'
import { DOMAIN_SEARCH_CASES } from '../domain-search-cases'
import { CHECKOUT_CALL_CASES, SIGN_IN_URL } from '../checkout-call-cases'
import { CHECKOUT_OUTCOME_TYPES, checkoutCallOutcome } from '../checkout-calls'
import { domainSearchOutcome } from '../domain-search'
import { normaliseRegistry, readRegistry, validateRegistry } from '../registry'
import { linkValueError } from '../settings'
import { contractSurface, diffSurface, type ContractChange, type ContractSurface } from '../surface'
import { TOKEN_CASES } from '../token-cases'
import { effectiveTokens, TOKEN_PATTERNS, TOKENS } from '../tokens'
import { STANDARD_SETTINGS } from '../settings'
import { validate, validateType } from '../validate'
import { generateGoContract } from './go'
import { generateGoFrontendPrefixes, generateGoRegistry } from './go-registry'
import { generateJsonSchema } from './json-schema'
import { generateTsRegistry } from './ts-registry'
import { generateTypeScript } from './typescript'

export const DEFAULT_GO_PACKAGE = 'contract'

/** The contract directory of this toolkit checkout. */
export const TOOLKIT_CONTRACT_DIR = fileURLToPath(new URL('../..', import.meta.url))

export class ContractError extends Error {}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function goFileName(contract: Contract): string {
  return `v${contract.version.replace(/[^0-9]/g, '')}.go`
}

function loadCheckedRegistry(contractDir: string) {
  const registry = readRegistry(contractDir)
  const errors = validateRegistry(registry)
  for (const contract of [contract1, contract202611]) {
    errors.push(...checkContract(contract).map((e) => `contract ${contract.version}: ${e}`))
  }
  // The newest contract describes every engine page; an older one only those it was cut with.
  for (const page of registry.pages.filter((p) => p.upstream === 'engine')) {
    if (!contract202611.pages[page.id]) errors.push(`contract ${contract202611.version} has no data type for engine page ${page.id}`)
  }
  for (const contract of [contract1, contract202611]) {
    for (const page of Object.keys(contract.pages)) {
      if (!registry.pages.some((p) => p.id === page && p.upstream === 'engine')) {
        errors.push(`contract ${contract.version} describes ${page}, which is not an engine page in the registry`)
      }
    }
  }
  if (errors.length > 0) throw new ContractError(`the contract is invalid:\n  ${errors.join('\n  ')}`)
  return normaliseRegistry(registry)
}

/** Every Go file of the contract package, keyed by file name. */
export function generateGoFiles(contractDir: string, packageName = DEFAULT_GO_PACKAGE): Record<string, string> {
  const registry = loadCheckedRegistry(contractDir)
  return {
    [goFileName(contract1)]: generateGoContract(contract1, packageName),
    [goFileName(contract202611)]: generateGoContract(contract202611, packageName),
    'registry.go': generateGoRegistry(registry, packageName),
  }
}

export function generateFrontendPrefixes(contractDir: string, packageName: string): string {
  return generateGoFrontendPrefixes(loadCheckedRegistry(contractDir), packageName)
}

/**
 * The link rule's cases as `fixtures/links.json`, each checked against
 * linkValueError first.
 */
function linkFixture(): string {
  const wrong = LINK_CASES.filter((c) => (linkValueError(c.kind, c.value) === null) !== c.ok)
  if (wrong.length > 0) {
    throw new ContractError(
      `the link rule disagrees with its cases:\n  ${wrong.map((c) => `${c.kind} ${JSON.stringify(c.value)} should be ${c.ok ? 'accepted' : 'refused'}`).join('\n  ')}`,
    )
  }
  const rows = LINK_CASES.map((c) => `  ${JSON.stringify({ kind: c.kind, value: c.value, ok: c.ok })}`)
  return `[\n${rows.join(',\n')}\n]\n`
}

/** JSON with every object's keys sorted, to compare values whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  )
}

function sameEntries(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k])
}

/**
 * The cases of effectiveTokens as `fixtures/tokens.json`, each checked
 * against it first. `tokens` is written in the order of the token table.
 */
function tokenFixture(): string {
  const cases = TOKEN_CASES.map((c) => {
    const tokens = effectiveTokens(c.template, c.theme)
    if (!sameEntries(tokens, c.tokens)) {
      throw new ContractError(`effectiveTokens disagrees with the case "${c.name}": got ${JSON.stringify(tokens)}`)
    }
    return { name: c.name, template: c.template, theme: c.theme, tokens }
  })
  return json(cases)
}

/**
 * The cases of domainSearchOutcome as `fixtures/domain-search.json`, each
 * checked against it and against the contract's DomainSearchOutcome first.
 */
function domainSearchFixture(): string {
  const errors: string[] = []
  const cases = DOMAIN_SEARCH_CASES.map((c) => {
    const got = domainSearchOutcome(c.status, c.body)
    if (canonical(got) !== canonical(c.outcome)) errors.push(`"${c.name}": domainSearchOutcome gives ${JSON.stringify(got)}`)
    errors.push(...validateType('2026-11', 'DomainSearchOutcome', c.outcome).map((e) => `"${c.name}" outcome ${e.path}: ${e.message}`))
    return { ...c, outcome: got }
  })
  if (errors.length > 0) throw new ContractError(`the domain search cases are wrong:\n  ${errors.join('\n  ')}`)
  return json(cases)
}

/**
 * The cases of the checkout calls as `fixtures/checkout-calls.json`, each
 * checked against the conversions and the contract's outcome type first.
 */
function checkoutCallsFixture(): string {
  const errors: string[] = []
  const cases = CHECKOUT_CALL_CASES.map((c) => {
    const got = checkoutCallOutcome(c.call, c.status, c.body, SIGN_IN_URL)
    if (canonical(got) !== canonical(c.outcome)) errors.push(`"${c.name}": ${c.call} gives ${JSON.stringify(got)}`)
    errors.push(...validateType('2026-11', CHECKOUT_OUTCOME_TYPES[c.call], c.outcome).map((e) => `"${c.name}" outcome ${e.path}: ${e.message}`))
    return { name: c.name, call: c.call, status: c.status, body: c.body, outcome: got }
  })
  if (errors.length > 0) throw new ContractError(`the checkout call cases are wrong:\n  ${errors.join('\n  ')}`)
  return json({ sign_in_url: SIGN_IN_URL, cases })
}

/**
 * Every generated file, keyed by path relative to the contract directory:
 * `dist/`, the contract "1" fixtures, which are the reference downgrade of
 * the "2026-11" fixtures, and the tables of rules other implementations test
 * against (`fixtures/links.json`, `fixtures/tokens.json`, `fixtures/domain-search.json`, `fixtures/checkout-calls.json`).
 */
export function generateAll(contractDir: string): Record<string, string> {
  const registry = loadCheckedRegistry(contractDir)
  const files: Record<string, string> = {}

  files['dist/ts/contract-1.ts'] = generateTypeScript(
    contract1,
    'Contract "1": the page data a format-1 template is rendered with. Frozen: nothing here is ever renamed, retyped or removed.',
  )
  files['dist/ts/contract-2026-11.ts'] = generateTypeScript(
    contract202611,
    'Contract "2026-11": every page response is a PageEnvelope whose data depends on the page id.',
  )
  files['dist/ts/registry.ts'] = generateTsRegistry(registry)

  for (const [name, content] of Object.entries(generateGoFiles(contractDir))) files[`dist/go/contract/${name}`] = content

  files['dist/json-schema/1.json'] = json(generateJsonSchema(contract1))
  files['dist/json-schema/2026-11.json'] = json(generateJsonSchema(contract202611))
  files['dist/registry.json'] = json(registry)
  files['fixtures/links.json'] = linkFixture()
  files['fixtures/tokens.json'] = tokenFixture()
  files['fixtures/domain-search.json'] = domainSearchFixture()
  files['fixtures/checkout-calls.json'] = checkoutCallsFixture()

  const sourceDir = join(contractDir, 'fixtures', '2026-11')
  const fixtureErrors: string[] = []
  for (const name of readdirSync(sourceDir).filter((f) => f.endsWith('.json')).sort()) {
    const envelope = JSON.parse(readFileSync(join(sourceDir, name), 'utf8'))
    const pageId = envelope?.page?.id
    const errors = validate('2026-11', pageId, envelope)
    if (errors.length > 0) {
      fixtureErrors.push(...errors.map((e) => `fixtures/2026-11/${name} ${e.path}: ${e.message}`))
      continue
    }
    // A page contract "1" does not have is served only to 2026-11 templates.
    if (!contract1.pages[pageId]) continue
    const legacy = downgrade(envelope)
    const legacyErrors = validate('1', pageId, legacy)
    fixtureErrors.push(...legacyErrors.map((e) => `fixtures/1/${name} ${e.path}: ${e.message}`))
    files[`fixtures/1/${name}`] = json(legacy)
  }
  if (fixtureErrors.length > 0) throw new ContractError(`fixtures are invalid:\n  ${fixtureErrors.join('\n  ')}`)

  return files
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

/** Lists generated files that are missing, differ, or exist without a source. */
export function staleFiles(contractDir: string): string[] {
  const files = generateAll(contractDir)
  const stale: string[] = []
  for (const [path, content] of Object.entries(files)) {
    const target = join(contractDir, path)
    if (!existsSync(target)) stale.push(`${path} (missing)`)
    else if (readFileSync(target, 'utf8') !== content) stale.push(`${path} (out of date)`)
  }
  for (const dir of ['dist', 'fixtures/1']) {
    for (const path of listFiles(join(contractDir, dir))) {
      const rel = `${dir}/${path}`
      if (!(rel in files)) stale.push(`${rel} (not generated by anything)`)
    }
  }
  return stale
}

function listFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

// ─── Baselines ─────────────────────────────────────────────────────────────

/** The contract versions in order, each with what its templates can observe of the platform. */
const VERSIONS = [contract1, contract202611] as const

/**
 * The current surface of every contract version, by version. Contract "1"
 * is used by format-1 templates, which see only its types; the newest
 * contract's surface also carries the registry, tokens, standard settings
 * and link rule.
 */
export function currentSurfaces(contractDir: string): Record<string, ContractSurface> {
  const registry = loadCheckedRegistry(contractDir)
  const sources = { registry, tokens: TOKENS, tokenPatterns: TOKEN_PATTERNS, settings: STANDARD_SETTINGS, links: LINK_CASES }
  return Object.fromEntries(
    VERSIONS.map((c) => [c.version, contractSurface(c, c === contract202611 ? sources : undefined)]),
  )
}

export function baselinePath(contractDir: string, version: string): string {
  return join(contractDir, 'baselines', `${version}.json`)
}

export interface BaselineReport {
  version: string
  /** False when the version has no baseline yet. */
  hasBaseline: boolean
  changes: ContractChange[]
}

/** Compares every contract version with its frozen baseline. */
export function baselineReports(contractDir: string): BaselineReport[] {
  const surfaces = currentSurfaces(contractDir)
  return Object.entries(surfaces).map(([version, surface]) => {
    const path = baselinePath(contractDir, version)
    if (!existsSync(path)) return { version, hasBaseline: false, changes: [] }
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as ContractSurface
    return { version, hasBaseline: true, changes: diffSurface(baseline, surface) }
  })
}

/**
 * Records the current surface of every version whose differences from its
 * baseline are all additive, and of every version with no baseline yet.
 * Throws, writing nothing, when any difference is breaking.
 */
export function acceptBaselines(contractDir: string): BaselineReport[] {
  const reports = baselineReports(contractDir)
  const breaking = reports.flatMap((r) => r.changes.filter((c) => c.kind === 'breaking').map((c) => `contract ${r.version}: ${c.at}: ${c.what}`))
  if (breaking.length > 0) {
    throw new ContractError(`these changes break templates and cannot be accepted:\n  ${breaking.join('\n  ')}\n${NEW_VERSION_ADVICE}`)
  }
  const surfaces = currentSurfaces(contractDir)
  for (const r of reports) {
    if (r.hasBaseline && r.changes.length === 0) continue
    const path = baselinePath(contractDir, r.version)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, json(surfaces[r.version]))
  }
  return reports
}

/** What to do about a breaking change. */
export const NEW_VERSION_ADVICE =
  'A breaking change needs a new contract version, with a downgrade that gives templates on the old version exactly what they had; the old version stays frozen (see contract/README.md, "Cutting a new contract version").'
