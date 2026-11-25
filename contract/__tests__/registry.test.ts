import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { matchPath, PAGES, RESERVED_SLUGS, defaultCachePolicy, isReservedSlug } from '../dist/ts/registry'
import { readRegistry, validateRegistry, type Registry } from '../src/registry'

const contractDir = join(import.meta.dir, '..')
const registry = readRegistry(contractDir)

function withPages(pages: unknown[], reserved = registry.reserved_slugs): unknown {
  return { pages, reserved_slugs: reserved }
}

const engine = (id: string, path: string | null) => ({ id, path, tier: 'open', upstream: 'engine', cache: { ttl: 1, swr: 1 } })
const frontend = (id: string, path: string) => ({ id, path, prefix: true, tier: 'guarded', upstream: 'frontend' })

describe('validateRegistry', () => {
  it('accepts the registry', () => {
    expect(validateRegistry(registry)).toEqual([])
  })

  it('rejects a duplicate id', () => {
    expect(validateRegistry(withPages([engine('home', '/'), engine('home', '/domains')]))).toContain(
      'page home: id is used twice',
    )
  })

  it('requires the first segment of every static path to be reserved', () => {
    const errors = validateRegistry(withPages([engine('pricing', '/pricing'), frontend('billing', '/billing')]))
    expect(errors.some((e) => e.includes('first segment pricing must be in reserved_slugs'))).toBe(true)
    expect(errors.some((e) => e.includes('first segment billing must be in reserved_slugs'))).toBe(true)
  })

  it('rejects two pages that match the same paths', () => {
    const errors = validateRegistry(withPages([engine('a', '/{group}'), engine('b', '/{other}')]))
    expect(errors).toContain('page b: path /{other} matches exactly the same paths as page a')
  })

  it('takes several paths for one page, and a fallback only on checkout pages', () => {
    const ok = validateRegistry(
      withPages([
        { id: 'x.y', paths: ['/checkout/{a}/{b}', '/checkout/{a}'], tier: 'checkout', upstream: 'engine', fallback: 'frontend', cache: { ttl: 1, swr: 1 } },
      ]),
    )
    expect(ok).toEqual([])
    const errors = validateRegistry(
      withPages([
        { id: 'p', paths: ['/checkout/{a}'], tier: 'checkout', upstream: 'engine', fallback: 'frontend', cache: { ttl: 1, swr: 1 } },
        { id: 'q', path: '/checkout/q', paths: ['/checkout/q', '/checkout/r'], tier: 'open', upstream: 'engine', cache: { ttl: 1, swr: 1 } },
        { id: 'r', path: '/checkout/s', tier: 'checkout', upstream: 'engine', cache: { ttl: 1, swr: 1 } },
        { id: 's', path: '/checkout/t', tier: 'open', upstream: 'frontend', fallback: 'frontend', prefix: true },
      ]),
    )
    expect(errors).toEqual([
      'page p: paths lists two or more paths; a page with one path gives path',
      'page q: give path or paths, not both',
      'page r: a checkout page, and only a checkout page, has a fallback',
      'page s: only an engine page has a fallback, and it is frontend',
      'page s: a checkout page, and only a checkout page, has a fallback',
    ])
  })

  it('enforces the shape of engine and frontend pages', () => {
    const errors = validateRegistry(
      withPages([
        { id: 'x', path: '/x', tier: 'open', upstream: 'engine' },
        { id: 'y', path: '/admin', tier: 'staff', upstream: 'frontend', cache: { ttl: 1, swr: 1 } },
        { id: 'z', path: null, tier: 'guarded', upstream: 'frontend', prefix: true },
        { id: 'w', path: '/admin/{id}', tier: 'nobody', upstream: 'frontend', prefix: true },
        { id: 'Bad Id', path: '/_hc', tier: 'open', upstream: 'engine', cache: { ttl: -1, swr: 0 } },
      ]),
    )
    expect(errors).toContain('page x: an engine page needs cache { ttl, swr } in whole seconds')
    expect(errors).toContain('page y: a frontend page has no cache policy')
    expect(errors).toContain('page z: only an engine page may have no path')
    expect(errors).toContain('page w: a frontend page path has no parameters')
    expect(errors).toContain('page w: tier must be one of open, checkout, guarded, private, staff')
    expect(errors.some((e) => e.startsWith('page Bad Id: id must match'))).toBe(true)
    expect(errors.some((e) => e.startsWith('page Bad Id: segment "_hc"'))).toBe(true)
  })

  it('rejects a reserved slug listed twice or an unknown key', () => {
    const errors = validateRegistry({ ...(registry as Registry), reserved_slugs: ['api', 'api'], extra: 1 })
    expect(errors).toContain('reserved slug api is listed twice')
    expect(errors).toContain('unknown key extra')
    expect(validateRegistry({ ...(registry as Registry), slots: [] })).toEqual(['unknown key slots'])
  })
})

describe('matchPath', () => {
  it('matches the engine pages', () => {
    expect(matchPath('/')).toEqual({ id: 'home', params: {} })
    expect(matchPath('/domains')).toEqual({ id: 'domains', params: {} })
    expect(matchPath('/games')).toEqual({ id: 'catalog.group', params: { group: 'games' } })
    expect(matchPath('/games/rust')).toEqual({ id: 'catalog.service', params: { group: 'games', service: 'rust' } })
  })

  it('prefers a static path over a parameter', () => {
    expect(matchPath('/domains')?.id).toBe('domains')
    expect(matchPath('/admin/settings')?.id).toBe('admin')
  })

  it('matches the checkout pages, static paths before the service and plan', () => {
    expect(matchPath('/checkout/rust/starter')).toEqual({ id: 'checkout.plan', params: { service: 'rust', plan: 'starter' } })
    expect(matchPath('/checkout/rust')).toEqual({ id: 'checkout.plan', params: { service: 'rust' } })
    expect(matchPath('/checkout/domains')).toEqual({ id: 'checkout.domains', params: {} })
    expect(matchPath('/checkout/success')).toEqual({ id: 'checkout.success', params: {} })
    expect(matchPath('/checkout/cancel')).toEqual({ id: 'checkout.cancel', params: {} })
    expect(matchPath('/checkout')).toEqual({ id: 'checkout', params: {} })
    expect(matchPath('/checkout/a/b/c')).toEqual({ id: 'checkout', params: {} })
    expect(matchPath('/checkout/_draft')).toBeNull()
    const plan = PAGES.find((p) => p.id === 'checkout.plan')!
    expect(plan).toMatchObject({ path: '/checkout/{service}/{plan}', paths: ['/checkout/{service}/{plan}', '/checkout/{service}'], tier: 'checkout', upstream: 'engine', fallback: 'frontend' })
    expect(PAGES.find((p) => p.id === 'checkout')).toMatchObject({ upstream: 'frontend', fallback: null, prefix: true })
  })

  it('matches prefix pages on a / boundary only', () => {
    expect(matchPath('/order')?.id).toBe('order')
    expect(matchPath('/order/123/pay')?.id).toBe('order')
    expect(matchPath('/orders')).toEqual({ id: 'catalog.group', params: { group: 'orders' } })
    expect(matchPath('/authors/jo')).toEqual({ id: 'catalog.service', params: { group: 'authors', service: 'jo' } })
  })

  it('never matches a segment starting with _', () => {
    expect(matchPath('/_hc')).toBeNull()
    expect(matchPath('/_hc/b/abc/client/x.js')).toBeNull()
    expect(matchPath('/games/_private')).toBeNull()
    expect(matchPath('/checkout/_x')).toBeNull()
  })

  it('never captures the first segment of a page as the first parameter', () => {
    expect(matchPath('/domains/acme')).toBeNull()
    expect(matchPath('/domains')?.id).toBe('domains')
    expect(matchPath('/checkout')?.id).toBe('checkout')
    expect(matchPath('/games/status')?.id).toBe('catalog.service')
  })

  it('still matches a group whose slug is reserved but owned by no page', () => {
    for (const slug of ['support', 'blog', 'api', 'status']) {
      expect(RESERVED_SLUGS).toContain(slug)
      expect(PAGES.some((p) => p.path === `/${slug}` || p.path?.startsWith(`/${slug}/`))).toBe(false)
      expect(matchPath(`/${slug}`)).toEqual({ id: 'catalog.group', params: { group: slug } })
      expect(matchPath(`/${slug}/rust`)).toEqual({ id: 'catalog.service', params: { group: slug, service: 'rust' } })
    }
    expect(isReservedSlug('support')).toBe(true)
  })

  it('matches nothing for a segment starting with _, reserved or not', () => {
    expect(matchPath('/_hc')).toBeNull()
    expect(matchPath('/_hc/boot.js')).toBeNull()
    expect(matchPath('/games/_x')).toBeNull()
  })

  it('ignores one trailing slash and rejects empty segments', () => {
    expect(matchPath('/games/')?.id).toBe('catalog.group')
    expect(matchPath('/games//rust')).toBeNull()
    expect(matchPath('games')).toBeNull()
    expect(matchPath('/a/b/c')).toBeNull()
  })

  it('never matches the not-found page', () => {
    expect(PAGES.find((p) => p.id === 'not-found')?.path).toBeNull()
  })
})

describe('the generated registry module', () => {
  it('exposes reserved slugs and cache policy', () => {
    expect(RESERVED_SLUGS).toContain('_hc')
    expect([...RESERVED_SLUGS]).toEqual([...RESERVED_SLUGS].sort())
    expect(isReservedSlug('checkout')).toBe(true)
    expect(isReservedSlug('games')).toBe(false)
    expect(defaultCachePolicy('home')).toEqual({ ttl: 3600, swr: 86400 })
    expect(defaultCachePolicy('not-found')).toEqual({ ttl: 0, swr: 0 })
    expect(defaultCachePolicy('dashboard')).toBeNull()
  })
})
