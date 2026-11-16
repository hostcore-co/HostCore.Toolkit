import type { DomainSearchOutcome } from '../dist/ts/contract-2026-11'

/**
 * The cases of domainSearchOutcome, published as `fixtures/domain-search.json`:
 * the HTTP status and JSON body the domain search endpoint answers, and the
 * DomainSearchOutcome a template receives for it. `hct contract generate`
 * checks each case against domainSearchOutcome and the contract.
 */

export interface DomainSearchCase {
  name: string
  status: number
  body: unknown
  outcome: DomainSearchOutcome
}

const price = (years: number, minor: number) => ({ years, amount: minor / 100, amount_minor: minor, currency: 'USD' })

export const DOMAIN_SEARCH_CASES: readonly DomainSearchCase[] = [
  {
    name: 'an available name, a taken one, and one the store cannot sell',
    status: 200,
    body: {
      data: [
        {
          type: 'domain_search',
          id: 'store_acme',
          attributes: {
            currency: 'USD',
            results: [
              { domain: 'acme.example', sld: 'acme', tld: 'example', available: true, premium: false, register: { '2': 2398, '1': 1299 }, transfer: { '1': 1099 }, renew: { '1': 1399 } },
              { domain: 'acme.test', sld: 'acme', tld: 'test', available: false, premium: false, register: { '1': 999 }, transfer: { '1': 899 }, renew: { '1': 999 } },
              { domain: 'acme.invalid', sld: 'acme', tld: 'invalid', available: false, premium: false, reason: 'This extension is not sold here.' },
            ],
          },
          relationships: null,
        },
      ],
    },
    outcome: {
      status: 'ok',
      currency: 'USD',
      results: [
        { domain: 'acme.example', sld: 'acme', tld: 'example', available: true, premium: false, reason: '', action: 'register', register: [price(1, 1299), price(2, 2398)], transfer: [price(1, 1099)], renew: [price(1, 1399)] },
        { domain: 'acme.test', sld: 'acme', tld: 'test', available: false, premium: false, reason: '', action: 'transfer', register: [price(1, 999)], transfer: [price(1, 899)], renew: [price(1, 999)] },
        { domain: 'acme.invalid', sld: 'acme', tld: 'invalid', available: false, premium: false, reason: 'This extension is not sold here.', action: 'none', register: [], transfer: [], renew: [] },
      ],
    },
  },
  {
    name: 'an available premium name with no register terms cannot be bought',
    status: 200,
    body: { data: [{ attributes: { currency: 'USD', results: [{ domain: 'a.example', sld: 'a', tld: 'example', available: true, premium: true }] } }] },
    outcome: {
      status: 'ok',
      currency: 'USD',
      results: [{ domain: 'a.example', sld: 'a', tld: 'example', available: true, premium: true, reason: '', action: 'none', register: [], transfer: [], renew: [] }],
    },
  },
  {
    name: 'nothing matched',
    status: 200,
    body: { data: [{ attributes: { currency: 'EUR', results: [] } }] },
    outcome: { status: 'ok', currency: 'EUR', results: [] },
  },
  {
    name: 'a query the platform cannot search',
    status: 400,
    body: { error: { code: 'invalid_input', message: 'Enter a domain name.' } },
    outcome: { status: 'error', code: 'invalid_query', message: 'Enter a domain name.' },
  },
  {
    name: 'too many searches',
    status: 429,
    body: null,
    outcome: { status: 'error', code: 'rate_limited', message: 'Too many searches. Wait a minute and try again.' },
  },
  {
    name: 'a store that does not offer domain search',
    status: 404,
    body: { error: { code: 'not_found', message: '' } },
    outcome: { status: 'error', code: 'unavailable', message: 'Domain search is not available here.' },
  },
  {
    name: 'a failure on the platform',
    status: 502,
    body: { error: { code: 'upstream', message: 'The registrar did not answer.' } },
    outcome: { status: 'error', code: 'failed', message: 'The registrar did not answer.' },
  },
  {
    name: 'an answer in a form the page cannot read',
    status: 200,
    body: { results: [] },
    outcome: { status: 'error', code: 'failed', message: 'The search failed. Please try again.' },
  },
]
