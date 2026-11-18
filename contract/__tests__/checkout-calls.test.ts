import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHECKOUT_CALL_CASES, SIGN_IN_URL } from '../src/checkout-call-cases'
import { CHECKOUT_OUTCOME_TYPES, checkoutCallOutcome, parseDomainDraft, signInUrl, type CheckoutCall } from '../src/checkout-calls'
import { validateType } from '../src/validate'

const fixture = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'checkout-calls.json'), 'utf8')) as {
  sign_in_url: string
  cases: { name: string; call: CheckoutCall; status: number; body: unknown; outcome: unknown }[]
}

describe('fixtures/checkout-calls.json', () => {
  it('lists every case, with the sign-in link a signed-out outcome carries', () => {
    expect(fixture.sign_in_url).toBe(SIGN_IN_URL)
    expect(fixture.cases.map((c) => c.name)).toEqual(CHECKOUT_CALL_CASES.map((c) => c.name))
  })

  it('covers every call', () => {
    expect([...new Set(fixture.cases.map((c) => c.call as string))].sort()).toEqual(Object.keys(CHECKOUT_OUTCOME_TYPES).sort())
  })

  it('gives each answer the outcome the conversions give, of the contract type', () => {
    for (const c of fixture.cases) {
      expect([c.name, checkoutCallOutcome(c.call, c.status, c.body, fixture.sign_in_url)]).toEqual([c.name, c.outcome])
      expect([c.name, validateType('2026-11', CHECKOUT_OUTCOME_TYPES[c.call], c.outcome)]).toEqual([c.name, []])
    }
  })
})

describe('the sign-in link', () => {
  it('returns to the page and its query', () => {
    expect(signInUrl('/login', '/checkout/domains?domain=acme.example&action=register&years=1')).toBe(
      '/login?redirectTo=%2Fcheckout%2Fdomains%3Fdomain%3Dacme.example%26action%3Dregister%26years%3D1',
    )
  })
})

describe('parseDomainDraft', () => {
  it('takes a name, register or transfer, and 1 to 10 whole years, and nothing else', () => {
    expect(parseDomainDraft({ domain: ' Acme.Example ', action: 'register', years: 1 })).toEqual({ domain: 'acme.example', action: 'register', years: 1 })
    expect(parseDomainDraft({ domain: 'bücher.example', action: 'transfer', years: 10 })).toEqual({ domain: 'bücher.example', action: 'transfer', years: 10 })
    for (const bad of [
      { domain: 'acme', action: 'register', years: 1 },
      { domain: 'acme.example', action: 'renew', years: 1 },
      { domain: 'acme.example', action: 'register', years: 11 },
      { domain: 'acme.example', action: 'register', years: 1.5 },
      { domain: 'acme.example', action: 'register', years: 1, extra: true },
      null,
    ]) {
      expect(parseDomainDraft(bad)).toBeNull()
    }
  })
})
