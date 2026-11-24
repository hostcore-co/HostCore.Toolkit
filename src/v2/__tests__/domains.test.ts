import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateType } from '../../../contract/src/validate'
import { searchDomains } from '../domains'

const ACTION = { method: 'POST' as const, url: '/api/v1/public/domains/search' }
const CASES = JSON.parse(readFileSync(join(import.meta.dir, '../../../contract/fixtures/domain-search.json'), 'utf8')) as {
  name: string
  status: number
  body: unknown
  outcome: unknown
}[]

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as { hc?: unknown }).hc
})

/** Replaces fetch with one answering `status` and `body`, recording each request. */
function answer(status: number, body: unknown): { url: string; init: RequestInit }[] {
  const seen: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return new Response(body === null ? 'not json' : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return seen
}

describe('searchDomains() without the page providing it', () => {
  it('posts the query to the action and resolves to each fixture outcome', async () => {
    for (const c of CASES) {
      const seen = answer(c.status, c.body)
      const outcome = await searchDomains(ACTION, 'acme')
      expect([c.name, outcome] as unknown[]).toEqual([c.name, c.outcome])
      expect(validateType('2026-11', 'DomainSearchOutcome', outcome)).toEqual([])
      expect(seen).toHaveLength(1)
      expect(seen[0]!.url).toBe(ACTION.url)
      expect(seen[0]!.init.method).toBe('POST')
      expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ query: 'acme' })
    }
  })

  it('resolves to a failure when the request cannot be made', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    expect(await searchDomains(ACTION, 'acme')).toMatchObject({ status: 'error', code: 'failed' })
  })

  it('resolves to unavailable for a store with no domain search', async () => {
    expect(await searchDomains(undefined, 'acme')).toEqual({ status: 'error', code: 'unavailable', message: 'Domain search is not available here.' })
  })
})

describe('searchDomains() on a page that provides window.hc.searchDomains', () => {
  it("uses the page's search and makes no request of its own", async () => {
    const seen = answer(500, null)
    const queries: string[] = []
    const outcome = { status: 'ok' as const, results: [], currency: 'USD' }
    ;(globalThis as { hc?: unknown }).hc = { searchDomains: async (q: string) => (queries.push(q), outcome) }
    expect(await searchDomains(ACTION, 'acme')).toEqual(outcome)
    expect(queries).toEqual(['acme'])
    expect(seen).toEqual([])
  })

  it('turns a page search that rejects or answers something else into a failure', async () => {
    ;(globalThis as { hc?: unknown }).hc = { searchDomains: async () => Promise.reject(new Error('no')) }
    expect(await searchDomains(ACTION, 'acme')).toMatchObject({ status: 'error', code: 'failed' })
    ;(globalThis as { hc?: unknown }).hc = { searchDomains: async () => ({ data: [] }) }
    expect(await searchDomains(ACTION, 'acme')).toMatchObject({ status: 'error', code: 'failed' })
  })
})
