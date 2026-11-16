import { readFileSync } from 'node:fs'
import type { NormalisedRegistry } from '../registry'
import { GENERATED_NOTICE } from './text'

/**
 * Modules copied verbatim into the generated registry module. Each has no
 * imports, so the generated file stays self-contained and runs exactly the
 * code the toolkit tests.
 */
export const EMBEDDED_MODULES = ['match.ts', 'settings.ts', 'tokens.ts'] as const

export function embeddedSource(file: string): string {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  if (/^\s*import\s/m.test(text)) throw new Error(`${file} must not import anything: it is embedded in generated code`)
  return text.trim()
}

function union(values: readonly string[]): string {
  return values.length === 0 ? 'never' : values.map((v) => `'${v}'`).join(' | ')
}

/** Renders the page registry, standard settings and design tokens as TypeScript. */
export function generateTsRegistry(registry: NormalisedRegistry): string {
  const ids = registry.pages.map((p) => p.id)
  const enginePages = registry.pages.filter((p) => p.upstream === 'engine').map((p) => p.id)
  const frontendPrefixes = registry.pages.filter((p) => p.upstream === 'frontend' && p.path !== null).map((p) => p.path!)

  const out: string[] = [
    `// ${GENERATED_NOTICE}`,
    '//',
    '// The page registry: every page a store domain serves, which part of the',
    '// platform serves it, who may see it and how long it may be cached. Also',
    '// the standard template settings and the design token table.',
    '',
    `/** PageId is any page in the registry. */`,
    `export type PageId = ${union(ids)}`,
    '',
    `/** EnginePageId is a page the rendering engine renders from a template. */`,
    `export type EnginePageId = ${union(enginePages)}`,
    '',
    `export type Tier = 'open' | 'guarded' | 'private' | 'staff'`,
    '',
    `export type Upstream = 'engine' | 'frontend'`,
    '',
    '/** CachePolicy is how long a rendered page may be served from cache, in seconds. */',
    'export interface CachePolicy {',
    '  /** Seconds a rendered page is fresh. */',
    '  ttl: number',
    '  /** Seconds a stale copy may be served while a fresh one renders. */',
    '  swr: number',
    '}',
    '',
    '/** RegistryPage is one page of the registry. */',
    'export interface RegistryPage {',
    '  id: PageId',
    '  /** Null for a page no path reaches. */',
    '  path: string | null',
    '  /** True when the page also owns every path below its own, on a "/" boundary. */',
    '  prefix: boolean',
    '  tier: Tier',
    '  upstream: Upstream',
    '  /** Set for engine pages. A store\'s own per-page setting overrides it. */',
    '  cache: CachePolicy | null',
    '  /** What a store must offer for the page to exist. */',
    "  requires: 'domains' | null",
    '}',
    '',
    `export const PAGES: readonly RegistryPage[] = ${JSON.stringify(registry.pages, null, 2)}`,
    '',
    '/** Path segments a store may not use as a group slug. */',
    `export const RESERVED_SLUGS: readonly string[] = ${JSON.stringify(registry.reserved_slugs, null, 2)}`,
    '',
    '/** The paths of every page the platform front end serves. */',
    `export const FRONTEND_PREFIXES: readonly string[] = ${JSON.stringify(frontendPrefixes, null, 2)}`,
    '',
    'export function isReservedSlug(slug: string): boolean {',
    '  return RESERVED_SLUGS.includes(slug)',
    '}',
    '',
    "/** The registry's cache policy for an engine page, or null for any other page. */",
    'export function defaultCachePolicy(id: PageId): CachePolicy | null {',
    '  return PAGES.find((p) => p.id === id)?.cache ?? null',
    '}',
    '',
    '/** Finds the registry page a pathname belongs to. See matchRoute for the rules. */',
    'export function matchPath(pathname: string): PathMatch<PageId> | null {',
    '  return matchRoute(PAGES, RESERVED_SLUGS, pathname) as PathMatch<PageId> | null',
    '}',
    '',
  ]

  for (const file of EMBEDDED_MODULES) {
    out.push(`// ─── ${file.replace(/\.ts$/, '')} ${'─'.repeat(Math.max(3, 70 - file.length))}`, '')
    out.push(embeddedSource(file), '')
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`
}
