import type { Action, DomainSearchOutcome } from '../../contract/dist/ts/contract-2026-11'
import { domainSearchError, domainSearchOutcome } from '../../contract/src/domain-search'

/**
 * What a store page offers for domain search, as `window.hc.searchDomains`.
 * The platform's own script provides it on a live store, so the request and
 * the answer can change with the platform rather than with a template's
 * bundle. It takes the visitor's query and resolves to a
 * DomainSearchOutcome; it never rejects.
 */
export interface PageDomainSearch {
  searchDomains(query: string): Promise<DomainSearchOutcome>
}

function isOutcome(value: unknown): value is DomainSearchOutcome {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.status === 'ok') return Array.isArray(v.results) && typeof v.currency === 'string'
  return v.status === 'error' && typeof v.code === 'string' && typeof v.message === 'string'
}

function pageSearch(): PageDomainSearch['searchDomains'] | null {
  const hc = (globalThis as { hc?: Partial<PageDomainSearch> }).hc
  return hc && typeof hc.searchDomains === 'function' ? hc.searchDomains.bind(hc) : null
}

/**
 * Searches for domains with the store's domain search action, from
 * `useAction('domain_search')`, and resolves to the results or a typed
 * failure; it never rejects. `undefined` for the action (a store that sells
 * no domains) resolves to the error `unavailable`.
 *
 * On a store page it asks the page's own `window.hc.searchDomains(query)`;
 * where the page has none, as in hct dev, it requests the action itself.
 * Either way a template never sees the endpoint's request or answer.
 */
export async function searchDomains(action: Action | undefined, query: string): Promise<DomainSearchOutcome> {
  if (!action) return domainSearchError('unavailable')
  const page = pageSearch()
  if (page) {
    try {
      const outcome: unknown = await page(query)
      if (isOutcome(outcome)) return outcome
    } catch {
      // The page's search follows the same contract: a failure is an outcome.
    }
    return domainSearchError('failed')
  }
  let response: Response
  try {
    response = await fetch(action.url, {
      method: action.method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
  } catch {
    return domainSearchError('failed', 'The search could not be reached. Check your connection and try again.')
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return domainSearchOutcome(response.status, body)
}
