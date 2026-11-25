import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchRoute, type PathMatch } from './match'

/**
 * The page registry: every page a store's domain serves, which part of the
 * platform serves it, who may see it, and how long it may be cached.
 */

/**
 * Who may see a page: `open` pages are the storefront; `checkout` pages are
 * the order flow, which a template may render; `guarded` pages (sign-in,
 * sign-up and the like), `private` pages (the account area) and `staff`
 * pages are the platform's own and show nothing of a template.
 */
export const TIERS = ['open', 'checkout', 'guarded', 'private', 'staff'] as const
export const UPSTREAMS = ['engine', 'frontend'] as const
export const REQUIREMENTS = ['domains'] as const

export type Tier = (typeof TIERS)[number]
export type Upstream = (typeof UPSTREAMS)[number]
export type Requirement = (typeof REQUIREMENTS)[number]

export interface CachePolicy {
  /** Seconds a rendered page is fresh. */
  ttl: number
  /** Seconds a stale copy may be served while a fresh one renders. */
  swr: number
}

export interface RegistryPage {
  id: string
  /** The page's path; null for a page no path reaches. A page with several paths gives `paths` instead. */
  path?: string | null
  /** Every path of a page reached by more than one, the canonical one first. */
  paths?: string[]
  prefix?: boolean
  tier: Tier
  upstream: Upstream
  /**
   * The part of the platform that serves the page when its upstream does not
   * for a store: a checkout page is rendered from the store's template when
   * the template implements it and the platform has it enabled for the
   * store, and otherwise by the platform's front end.
   */
  fallback?: Upstream
  cache?: CachePolicy
  requires?: Requirement
}

export interface Registry {
  pages: RegistryPage[]
  reserved_slugs: string[]
}

/** A registry page with every optional key spelled out. */
export interface NormalisedPage {
  id: string
  /** The canonical path: the first of `paths`, or null. */
  path: string | null
  /** Every path the page is reached by; empty for a page no path reaches. */
  paths: string[]
  prefix: boolean
  tier: Tier
  upstream: Upstream
  fallback: Upstream | null
  cache: CachePolicy | null
  requires: Requirement | null
}

export interface NormalisedRegistry {
  pages: NormalisedPage[]
  reserved_slugs: string[]
}

const PAGE_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/
const STATIC_SEGMENT = /^[a-z0-9][a-z0-9-]*$/
const PARAM_SEGMENT = /^\{[a-z][a-z0-9_]*\}$/
const RESERVED_SLUG = /^[a-z0-9_][a-z0-9_-]*$/
const PAGE_KEYS = new Set(['id', 'path', 'paths', 'prefix', 'tier', 'upstream', 'fallback', 'cache', 'requires'])

/** Every path of a registry page, as written: `paths`, or `path` alone, or none. */
export function pagePaths(page: { path?: string | null; paths?: string[] }): string[] {
  if (Array.isArray(page.paths)) return page.paths
  return typeof page.path === 'string' ? [page.path] : []
}

export function readRegistry(contractDir: string): Registry {
  return JSON.parse(readFileSync(join(contractDir, 'registry.json'), 'utf8')) as Registry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSeconds(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Checks a registry. Returns one message per problem. */
export function validateRegistry(raw: unknown): string[] {
  if (!isRecord(raw)) return ['registry must be an object']
  const errors: string[] = []
  for (const key of Object.keys(raw)) {
    if (key !== 'pages' && key !== 'reserved_slugs') errors.push(`unknown key ${key}`)
  }
  if (!Array.isArray(raw.pages)) return [...errors, 'pages must be an array']
  if (!Array.isArray(raw.reserved_slugs)) return [...errors, 'reserved_slugs must be an array']

  const reserved = new Set<string>()
  for (const slug of raw.reserved_slugs) {
    if (typeof slug !== 'string' || !RESERVED_SLUG.test(slug)) {
      errors.push(`reserved slug ${JSON.stringify(slug)} must match ${RESERVED_SLUG.source}`)
    } else if (reserved.has(slug)) {
      errors.push(`reserved slug ${slug} is listed twice`)
    } else {
      reserved.add(slug)
    }
  }

  const ids = new Set<string>()
  const shapes = new Map<string, string>()

  raw.pages.forEach((page: unknown, i: number) => {
    if (!isRecord(page)) {
      errors.push(`pages[${i}] must be an object`)
      return
    }
    const id = typeof page.id === 'string' ? page.id : `pages[${i}]`
    const at = `page ${id}`
    for (const key of Object.keys(page)) if (!PAGE_KEYS.has(key)) errors.push(`${at}: unknown key ${key}`)

    if (typeof page.id !== 'string' || !PAGE_ID.test(page.id)) errors.push(`${at}: id must match ${PAGE_ID.source}`)
    else if (ids.has(page.id)) errors.push(`${at}: id is used twice`)
    else ids.add(page.id)

    if (!TIERS.includes(page.tier as Tier)) errors.push(`${at}: tier must be one of ${TIERS.join(', ')}`)
    if (!UPSTREAMS.includes(page.upstream as Upstream)) {
      errors.push(`${at}: upstream must be one of ${UPSTREAMS.join(', ')}`)
    }
    if (page.prefix !== undefined && typeof page.prefix !== 'boolean') errors.push(`${at}: prefix must be a boolean`)
    if (page.requires !== undefined && !REQUIREMENTS.includes(page.requires as Requirement)) {
      errors.push(`${at}: requires must be one of ${REQUIREMENTS.join(', ')}`)
    }

    if (page.upstream === 'engine') {
      if (!isRecord(page.cache) || !isSeconds(page.cache.ttl) || !isSeconds(page.cache.swr)) {
        errors.push(`${at}: an engine page needs cache { ttl, swr } in whole seconds`)
      } else if (Object.keys(page.cache).some((k) => k !== 'ttl' && k !== 'swr')) {
        errors.push(`${at}: cache has only ttl and swr`)
      }
      if (page.prefix === true) errors.push(`${at}: an engine page cannot be a prefix page`)
    } else if (page.upstream === 'frontend') {
      if (page.cache !== undefined) errors.push(`${at}: a frontend page has no cache policy`)
      if (page.prefix !== true) errors.push(`${at}: a frontend page must be a prefix page`)
    }

    if (page.fallback !== undefined) {
      if (page.upstream !== 'engine' || page.fallback !== 'frontend') errors.push(`${at}: only an engine page has a fallback, and it is frontend`)
    }
    if ((page.tier === 'checkout') !== (page.fallback !== undefined)) {
      errors.push(`${at}: a checkout page, and only a checkout page, has a fallback`)
    }

    if (page.paths !== undefined && page.path !== undefined) errors.push(`${at}: give path or paths, not both`)
    if (page.paths !== undefined && (!Array.isArray(page.paths) || page.paths.length < 2)) {
      errors.push(`${at}: paths lists two or more paths; a page with one path gives path`)
      return
    }
    if (page.paths === undefined && page.path === null) {
      if (page.upstream !== 'engine') errors.push(`${at}: only an engine page may have no path`)
      return
    }
    const paths = page.paths ?? [page.path]
    for (const path of paths) {
      if (typeof path !== 'string' || !path.startsWith('/')) {
        errors.push(`${at}: path must start with /`)
        continue
      }
      if (path !== '/' && path.endsWith('/')) errors.push(`${at}: path ${path} must not end with /`)

      const segments = path === '/' ? [] : path.slice(1).split('/')
      const params = new Set<string>()
      segments.forEach((segment, j) => {
        if (PARAM_SEGMENT.test(segment)) {
          if (page.upstream === 'frontend') errors.push(`${at}: a frontend page path has no parameters`)
          if (params.has(segment)) errors.push(`${at}: parameter ${segment} is used twice`)
          params.add(segment)
        } else if (!STATIC_SEGMENT.test(segment)) {
          errors.push(`${at}: segment ${JSON.stringify(segment)} must match ${STATIC_SEGMENT.source} or be a {param}`)
        } else if (j === 0 && !reserved.has(segment)) {
          errors.push(`${at}: first segment ${segment} must be in reserved_slugs, or a store could create a group that shadows it`)
        }
      })

      const shape = `${page.prefix === true ? 'prefix' : 'exact'} ${segments.map((s) => (s.startsWith('{') ? '{}' : s)).join('/')}`
      const clash = shapes.get(shape)
      if (clash !== undefined) errors.push(`${at}: path ${path} matches exactly the same paths as page ${clash}`)
      else shapes.set(shape, id)
    }
  })

  return errors
}

export function normaliseRegistry(registry: Registry): NormalisedRegistry {
  return {
    pages: registry.pages.map((p) => ({
      id: p.id,
      path: pagePaths(p)[0] ?? null,
      paths: pagePaths(p),
      prefix: p.prefix ?? false,
      tier: p.tier,
      upstream: p.upstream,
      fallback: p.fallback ?? null,
      cache: p.cache ? { ttl: p.cache.ttl, swr: p.cache.swr } : null,
      requires: p.requires ?? null,
    })),
    reserved_slugs: [...registry.reserved_slugs].sort(),
  }
}

export function matchRegistryPath(registry: Registry, pathname: string): PathMatch | null {
  return matchRoute(
    registry.pages.map((p) => ({ id: p.id, paths: pagePaths(p), prefix: p.prefix ?? false })),
    pathname,
  )
}
