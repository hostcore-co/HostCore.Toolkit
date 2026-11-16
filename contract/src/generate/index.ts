import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkContract, type Contract } from '../dsl'
import { contract1 } from '../contract-1'
import { contract202611 } from '../contract-2026-11'
import { downgrade } from '../downgrade'
import { LINK_CASES } from '../link-cases'
import { normaliseRegistry, readRegistry, validateRegistry } from '../registry'
import { linkValueError } from '../settings'
import { TOKEN_CASES } from '../token-cases'
import { effectiveTokens } from '../tokens'
import { validate } from '../validate'
import { generateGoContract } from './go'
import { generateGoFrontendPrefixes, generateGoRegistry } from './go-registry'
import { generateJsonSchema } from './json-schema'
import { generateTsRegistry } from './ts-registry'
import { generateTypeScript } from './typescript'

export const DEFAULT_GO_PACKAGE = 'contract'

/** The contract directory of this toolkit checkout. */
export const TOOLKIT_CONTRACT_DIR = join(dirname(new URL(import.meta.url).pathname), '..', '..')

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
    for (const page of registry.pages.filter((p) => p.upstream === 'engine')) {
      if (!contract.pages[page.id]) errors.push(`contract ${contract.version} has no data type for engine page ${page.id}`)
    }
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
 * Every generated file, keyed by path relative to the contract directory:
 * `dist/`, the contract "1" fixtures, which are the reference downgrade of
 * the "2026-11" fixtures, and the tables of rules other implementations test
 * against (`fixtures/links.json`, `fixtures/tokens.json`).
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
