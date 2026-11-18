import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckoutPlan } from '../../../contract/dist/ts/contract-2026-11'
import {
  checkoutActions,
  checkoutCustomer,
  displayCurrency,
  quoteCheckout,
  saveBillingAddress,
  setDisplayCurrency,
  startCheckout,
} from '../checkout/calls'
import {
  addonItem,
  bankTransferAllowed,
  billingAddressProblem,
  BLANK_DOMAIN_CONTACT,
  defaultCycle,
  defaultGateway,
  displayMoney,
  domainContactProblem,
  domainFromQuery,
  domainItem,
  initialOrderValues,
  orderOptionsMinor,
  planItem,
  planSelection,
  type AddonSelection,
} from '../checkout/flow'

const FIXTURES = join(import.meta.dir, '..', '..', '..', 'contract', 'fixtures', '2026-11')
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, any>

beforeAll(() => {
  GlobalRegistrator.register({ url: 'https://acme.test/checkout/rust/starter?ref=x' })
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
type Seen = { method: string; url: string; body: unknown }
let seen: Seen[] = []
afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as { hc?: unknown }).hc
  seen = []
})

/** Answers each request from a table of method and path → [status, body], in turn when a value is a list. */
function serve(table: Record<string, [number, unknown] | [number, unknown][]>): void {
  const turns: Record<string, number> = {}
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = url.split('?')[0]!
    seen.push({ method, url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const entry = table[`${method} ${path}`]
    if (!entry) return new Response('not found', { status: 404 })
    const answers = (Array.isArray(entry[0]) ? entry : [entry]) as [number, unknown][]
    const turn = turns[`${method} ${path}`] ?? 0
    turns[`${method} ${path}`] = turn + 1
    const [status, body] = answers[Math.min(turn, answers.length - 1)]!
    return new Response(body === null ? null : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

const planPage = load('checkout.plan')
const ctx = checkoutActions(planPage as never)
const plan = planPage.data.plan as CheckoutPlan

describe('the flow rules', () => {
  it('start on the first enabled cycle, the first answers and the gateway last by name', () => {
    expect(defaultCycle(plan)).toBe('month')
    expect(defaultCycle({ ...plan, cycles: [plan.cycles[2]!, plan.cycles[1]!] })).toBe('quarter')
    expect(defaultCycle({ ...plan, cycles: [] })).toBeNull()
    expect(initialOrderValues(plan.order_form)).toEqual({ server_name: '', backups: true, MAP_SIZE: '3000', location: 'us-west', slots: '50' })
    expect(defaultGateway(planPage.data.payment.gateways)).toBe('stripe')
  })

  it('price order-form options once per cycle, as the platform charges them', () => {
    const values = { ...initialOrderValues(plan.order_form), MAP_SIZE: '4500', slots: '100' }
    expect(orderOptionsMinor(plan.order_form, values)).toBe(200 + 300 + 500)
    expect(orderOptionsMinor(plan.order_form, { ...values, backups: false })).toBe(800)
  })

  it('allow bank transfer only when the store, the plan and every add-on allow it, with no domain', () => {
    const bt = load('checkout.plan.bank-transfer').data
    const backups = planSelection(bt.offers[0], 'pln_backups_50')!
    const bigBackups = planSelection(bt.offers[0], 'pln_backups_200')!
    const domain: AddonSelection = { kind: 'domain', offer_id: 'off_domain', domain: 'acme.example', action: 'register', years: 1, privacy: false, epp_code: '' }
    expect(bankTransferAllowed(bt.payment, bt.plan, [])).toBe(true)
    expect(bankTransferAllowed(bt.payment, bt.plan, [backups])).toBe(true)
    expect(bankTransferAllowed(bt.payment, bt.plan, [bigBackups])).toBe(false)
    expect(bankTransferAllowed(bt.payment, bt.plan, [domain])).toBe(false)
    expect(bankTransferAllowed(planPage.data.payment, bt.plan, [])).toBe(false)
    expect(bankTransferAllowed(bt.payment, { ...bt.plan, payment_type: 'free', allow_bank_transfer: false }, [backups])).toBe(true)
  })

  it('check the billing address and the domain contact with the platform\'s messages', () => {
    const address = { country: 'GB', state: '', address_line1: '1 Example Street', address_line2: '', city: 'London', postal_code: 'N1', tax_id: '' }
    expect(billingAddressProblem(address)).toBeNull()
    expect(billingAddressProblem({ ...address, city: ' ' })?.message).toBe('Fill in your billing address so we can invoice and tax the order correctly.')
    expect(billingAddressProblem({ ...address, country: 'GBR' })?.message).toBe('Pick your billing country.')
    expect(domainContactProblem(BLANK_DOMAIN_CONTACT)?.code).toBe('domain_contact_incomplete')
    const contact = { ...BLANK_DOMAIN_CONTACT, first_name: 'A', last_name: 'B', email: 'a@example.com', phone: '+1', address1: '1', city: 'C', postal_code: 'P', country_code: 'USA' }
    expect(domainContactProblem(contact)?.message).toBe('Country must be a two-letter code, e.g. US.')
  })

  it('build items as the platform\'s checkout does', () => {
    expect(planItem(plan, 'quarter', { a: 'b' })).toEqual({ kind: 'plan', service_id: 'svc_rust', plan_id: 'pln_rust_starter', order_config: { a: 'b' }, billing_interval: 'quarterly' })
    expect(planItem({ ...plan, payment_type: 'free_trial' }, 'month', {})).toEqual({ kind: 'plan', service_id: 'svc_rust', plan_id: 'pln_rust_starter', order_config: {} })
    expect(domainItem({ domain: 'acme.example', action: 'transfer', years: 1 })).toEqual({ kind: 'domain', domain: 'acme.example', action: 'transfer', years: 1 })
    const contact = { ...BLANK_DOMAIN_CONTACT, first_name: 'A' }
    expect(domainItem({ domain: 'acme.example', action: 'transfer', years: 1 }, { contact, privacy: true, epp_code: 'X' }).domain_config).toEqual({ contact, privacy: true, epp_code: 'X' })
    expect(domainItem({ domain: 'acme.example', action: 'register', years: 2 }, { contact, privacy: false, epp_code: 'X' }).domain_config).toEqual({ contact, privacy: false })
    const addon: AddonSelection = { kind: 'domain', offer_id: 'o', domain: 'acme.test', action: 'register', years: 1, privacy: true, epp_code: '' }
    expect(addonItem(addon)).toEqual({ kind: 'domain', domain: 'acme.test', action: 'register', years: 1 })
    expect(addonItem(addon, contact).domain_config).toEqual({ contact, privacy: true })
  })

  it('read a domain from the address, a year by default and ten at most', () => {
    expect(domainFromQuery(new URLSearchParams('domain=Acme.Example&action=register'))).toEqual({ domain: 'acme.example', action: 'register', years: 1 })
    expect(domainFromQuery(new URLSearchParams('domain=acme.example&action=transfer&years=25'))).toEqual({ domain: 'acme.example', action: 'transfer', years: 10 })
    expect(domainFromQuery(new URLSearchParams('domain=acme&action=register'))).toBeNull()
  })

  it('convert store prices for display by the ratio of the rates', () => {
    expect(displayMoney(1299, 'USD', 'EUR', { USD: 1, EUR: 0.92 })).toEqual({ amount: 11.95, amount_minor: 1195, currency: 'EUR' })
    expect(displayMoney(1299, 'USD', 'EUR', null)).toEqual({ amount: 12.99, amount_minor: 1299, currency: 'USD' })
  })
})

describe('the checkout calls without the page providing them', () => {
  it('read the customer, renewing an expired session once', async () => {
    serve({
      'GET /api/v1/user': [
        [401, null],
        [200, { data: [{ attributes: { country: 'us', state: 'OR', address_line1: '1 A St', address_line2: '', city: 'Eugene', postal_code: '97403', tax_id: '' } }] }],
      ],
      'POST /api/v1/auth/session/refresh': [204, null],
    })
    expect(await checkoutCustomer(ctx)).toEqual({
      status: 'signed_in',
      billing: { country: 'US', state: 'OR', address_line1: '1 A St', address_line2: '', city: 'Eugene', postal_code: '97403', tax_id: '' },
    })
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /api/v1/user', 'POST /api/v1/auth/session/refresh', 'GET /api/v1/user'])
  })

  it('report signed out, with a way back to this page, when the renewal fails', async () => {
    serve({ 'POST /api/v1/user/checkout/start': [401, null], 'POST /api/v1/auth/session/refresh': [401, null] })
    expect(await startCheckout(ctx, { items: [] })).toEqual({ status: 'signed_out', sign_in_url: '/login?redirectTo=%2Fcheckout%2Frust%2Fstarter%3Fref%3Dx' })
    expect(seen.map((s) => s.url)).toEqual(['/api/v1/user/checkout/start', '/api/v1/auth/session/refresh'])
  })

  it('save the billing address trimmed, and price with the quote action', async () => {
    serve({ 'PATCH /api/v1/user': [204, null], 'QUERY /api/v1/public/checkout/quote': [429, null] })
    const address = { country: ' gb ', state: '', address_line1: ' 1 Example Street ', address_line2: '', city: 'London', postal_code: 'N1', tax_id: '' }
    expect(await saveBillingAddress(ctx, address)).toEqual({ status: 'ok' })
    expect(seen[0]!.body).toEqual({ ...address, country: 'GB', address_line1: '1 Example Street' })
    expect(await quoteCheckout(ctx, { items: [], country: 'GB', state: '' })).toEqual({ status: 'error', code: 'failed', message: 'Could not price your order.' })
    expect(seen[1]!.method).toBe('QUERY')
  })

  it('say so when the page offers no such action', async () => {
    expect(await startCheckout(checkoutActions(load('home') as never), { items: [] })).toMatchObject({ status: 'error', code: 'unavailable' })
  })

  it('keep the visitor\'s currency only when the store has a rate for it', () => {
    setDisplayCurrency('eur')
    expect(document.cookie).toContain('currency=eur')
    expect(displayCurrency('usd', { USD: 1, EUR: 0.92 })).toBe('EUR')
    expect(displayCurrency('usd', { USD: 1 })).toBe('USD')
    expect(displayCurrency('usd', null)).toBe('USD')
  })
})

describe('the checkout calls on a page that provides window.hc.checkout', () => {
  it('use the page\'s implementation and make no request', async () => {
    serve({})
    const outcome = { status: 'paid' as const, order_id: '', subscription_id: 'sub_1' }
    const asked: unknown[] = []
    ;(globalThis as { hc?: unknown }).hc = {
      checkout: {
        start: async (request: unknown) => (asked.push(request), outcome),
        customer: async () => Promise.reject(new Error('down')),
      },
    }
    expect(await startCheckout(ctx, { items: [] })).toEqual(outcome)
    expect(asked).toEqual([{ items: [] }])
    expect(await checkoutCustomer(ctx)).toEqual({ status: 'error', code: 'failed', message: 'Could not load your account details.' })
    expect(seen).toEqual([])
  })
})
