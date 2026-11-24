import type {
  DomainSearchAction,
  DomainSearchError,
  DomainSearchOutcome,
  DomainSearchResult,
  DomainTermPrice,
} from '../dist/ts/contract-2026-11'

/**
 * How a domain search's answer becomes a DomainSearchOutcome. The SDK's
 * searchDomains uses it when the page does not provide window.hc.searchDomains;
 * `fixtures/domain-search.json` holds its cases, for any other
 * implementation to match.
 *
 * The endpoint (`actions.domain_search`) takes `{ "query": "…" }` as JSON and
 * answers `{ "data": [{ "attributes": { "results": [...], "currency": "USD" } }] }`,
 * each result `{ domain, sld, tld, available, premium, reason?, register?,
 * transfer?, renew? }` with each price list an object of minor units by term
 * in years (`{ "1": 1299, "2": 2499 }`). A failure answers a non-2xx status
 * with `{ "error": { "message": "…" } }`.
 */

/** The codes this toolkit gives a DomainSearchError. */
export type DomainSearchErrorCode = 'invalid_query' | 'rate_limited' | 'unavailable' | 'failed'

const MESSAGES: Record<DomainSearchErrorCode, string> = {
  invalid_query: 'Enter a domain name or a word to search for.',
  rate_limited: 'Too many searches. Wait a minute and try again.',
  unavailable: 'Domain search is not available here.',
  failed: 'The search failed. Please try again.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A DomainSearchError with the given code, and the message given or the standard one. */
export function domainSearchError(code: DomainSearchErrorCode, message?: string): DomainSearchError {
  return { status: 'error', code, message: message && message.trim() !== '' ? message : MESSAGES[code] }
}

function terms(prices: unknown, currency: string): DomainTermPrice[] {
  if (!isRecord(prices)) return []
  return Object.entries(prices)
    .filter(([years, minor]) => /^[1-9][0-9]*$/.test(years) && typeof minor === 'number' && Number.isInteger(minor) && minor >= 0)
    .map(([years, minor]) => ({ years: Number(years), amount: (minor as number) / 100, amount_minor: minor as number, currency }))
    .sort((a, b) => a.years - b.years)
}

function actionOf(available: boolean, reason: string, register: DomainTermPrice[], transfer: DomainTermPrice[]): DomainSearchAction {
  if (available && register.length > 0) return 'register'
  if (!available && reason === '' && transfer.length > 0) return 'transfer'
  return 'none'
}

function result(raw: Record<string, unknown>, currency: string): DomainSearchResult | null {
  if (typeof raw.domain !== 'string' || typeof raw.available !== 'boolean') return null
  const register = terms(raw.register, currency)
  const transfer = terms(raw.transfer, currency)
  const reason = typeof raw.reason === 'string' ? raw.reason : ''
  const available = raw.available
  return {
    domain: raw.domain,
    sld: typeof raw.sld === 'string' ? raw.sld : '',
    tld: typeof raw.tld === 'string' ? raw.tld : '',
    available,
    premium: raw.premium === true,
    reason,
    action: actionOf(available, reason, register, transfer),
    register,
    transfer,
    renew: terms(raw.renew, currency),
  }
}

function codeFor(status: number): DomainSearchErrorCode {
  if (status === 400 || status === 422) return 'invalid_query'
  if (status === 429) return 'rate_limited'
  if (status === 404) return 'unavailable'
  return 'failed'
}

/**
 * The outcome of a domain search from the endpoint's HTTP status and its
 * parsed JSON body (null when the body was not JSON).
 */
export function domainSearchOutcome(status: number, body: unknown): DomainSearchOutcome {
  if (status < 200 || status > 299) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : undefined
    return domainSearchError(codeFor(status), message)
  }
  const first = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined
  const attributes = isRecord(first) ? first.attributes : undefined
  if (!isRecord(attributes) || !Array.isArray(attributes.results) || typeof attributes.currency !== 'string') {
    return domainSearchError('failed')
  }
  const currency = attributes.currency
  const results = attributes.results.flatMap((r) => {
    const parsed = isRecord(r) ? result(r, currency) : null
    return parsed ? [parsed] : []
  })
  return { status: 'ok', results, currency }
}
