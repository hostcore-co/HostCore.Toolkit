import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useCheckoutCancel, useCheckoutDomains, useCheckoutPlan, useCheckoutSuccess } from '../checkout/hooks'
import { PageContext } from '../context'

const FIXTURES = join(import.meta.dir, '..', '..', '..', 'contract', 'fixtures', '2026-11')
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, any>
const ENV = { build_id: '', asset_base: '', locale: 'en', currency: 'USD' }

const PROFILE = { country: 'gb', state: '', address_line1: '1 Example Street', address_line2: '', city: 'London', postal_code: 'N1 9GU', tax_id: '' }
const CONTACT = {
  first_name: 'Ada', last_name: 'Lovelace', organization: '', email: 'ada@example.com', phone: '+44.2000000000',
  address1: '1 Example Street', address2: '', city: 'London', state: '', postal_code: 'N1 9GU', country_code: 'GB',
}
const QUOTE = (total: number, incomplete = false) => ({
  data: [{ attributes: { currency: 'USD', items: [{ kind: 'plan', label: 'Rust', cents: total }], subtotal_cents: total, tax_cents: 0, total_cents: total, tax_inclusive: false, incomplete } }],
})

let assigned: string[] = []
type Seen = { method: string; url: string; body: any }
let seen: Seen[] = []
let roots: Root[] = []
const realFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register({ url: 'https://acme.test/' })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots = []
  globalThis.fetch = realFetch
  assigned = []
  seen = []
  document.cookie = 'currency=; max-age=0; path=/'
})

function at(url: string): void {
  ;(globalThis as { happyDOM?: { setURL(url: string): void } }).happyDOM!.setURL(`https://acme.test${url}`)
  ;(globalThis as { location: { assign(url: string): void } }).location.assign = (u: string) => {
    assigned.push(u)
  }
}

function serve(table: Record<string, [number, unknown]>): void {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    seen.push({ method, url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const entry = table[`${method} ${url.split('?')[0]}`]
    if (!entry) return new Response(null, { status: 404 })
    return new Response(entry[1] === null ? null : JSON.stringify(entry[1]), { status: entry[0] })
  }) as unknown as typeof fetch
}

/** Renders a hook on a page and gives back its latest value. */
async function mount<T>(hook: () => T, payload: Record<string, any>): Promise<() => T> {
  let value: T
  function Probe() {
    value = hook()
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => {
    root.render(createElement(PageContext.Provider, { value: { payload: payload as never, env: ENV, defaults: {}, outlet: null } }, createElement(Probe)))
  })
  return () => value
}

async function run(work: () => unknown): Promise<void> {
  await act(async () => {
    await work()
  })
}

const signedIn = { 'GET /api/v1/user': [200, { data: [{ attributes: PROFILE }] }] } as Record<string, [number, unknown]>

describe('useCheckoutPlan', () => {
  it('prefills the billing address, starts on the defaults and quotes the order', async () => {
    at('/checkout/rust/starter')
    serve({ ...signedIn, 'QUERY /api/v1/public/checkout/quote': [200, QUOTE(1999)] })
    const c = await mount(useCheckoutPlan, load('checkout.plan'))
    expect(c().customer).toBe('signed_in')
    expect(c().address.country).toBe('GB')
    expect(c().cycle?.interval).toBe('month')
    expect(c().gateway).toBe('stripe')
    expect(c().gateways.map((g) => g.gateway)).toEqual(['stripe', 'paypal'])
    const quote = seen.filter((s) => s.method === 'QUERY').at(-1)!
    expect(quote.body).toEqual({
      items: [{ kind: 'plan', service_id: 'svc_rust', plan_id: 'pln_rust_starter', order_config: { server_name: '', backups: true, MAP_SIZE: '3000', location: 'us-west', slots: '50' }, billing_interval: 'monthly' }],
      country: 'GB',
      state: '',
    })
    expect(c().dueNow.amount_minor).toBe(1999)
    expect(c().cyclePrice(c().cycles[2]!).amount_minor).toBe(12999 + 200)
  })

  it('requotes when the cycle, an option, an add-on or the country changes', async () => {
    at('/checkout/rust/starter')
    serve({ ...signedIn, 'QUERY /api/v1/public/checkout/quote': [200, QUOTE(1999)] })
    const c = await mount(useCheckoutPlan, load('checkout.plan'))
    const quotes = () => seen.filter((s) => s.method === 'QUERY').length
    const before = quotes()
    await run(() => c().setCycle('year'))
    await run(() => c().setOrderValue('MAP_SIZE', '4500'))
    await run(() => c().offers[0]!.add())
    await run(() => c().setAddress({ country: 'FR' }))
    expect(quotes()).toBe(before + 4)
    const last = seen.filter((s) => s.method === 'QUERY').at(-1)!.body
    expect(last.items.map((i: any) => i.plan_id)).toEqual(['pln_rust_starter', 'pln_backups_50'])
    expect(last.items[0].billing_interval).toBe('annually')
    expect(last.country).toBe('FR')
  })

  it('stops with the platform\'s message before anything is sent, in the platform\'s order', async () => {
    at('/checkout/rust/starter')
    serve({ 'GET /api/v1/user': [200, { data: [{ attributes: { ...PROFILE, city: '' } }] }], 'QUERY /api/v1/public/checkout/quote': [200, QUOTE(1999, true)] })
    const c = await mount(useCheckoutPlan, load('checkout.plan'))
    await run(() => c().submit())
    expect(c().problem?.code).toBe('billing_address_incomplete')
    await run(() => c().setAddress({ city: 'London' }))
    await run(() => c().offers[1]!.pick({ domain: 'acme.example' } as never, 'transfer', 1))
    await run(() => c().submit())
    expect(c().problem?.code).toBe('domain_contact_incomplete')
    await run(() => c().setContact(CONTACT))
    await run(() => c().submit())
    expect(c().problem).toMatchObject({ code: 'epp_required', message: 'Enter the EPP/auth code for acme.example.' })
    await run(() => c().offers[1]!.setEppCode('EPP-1'))
    await run(() => c().submit())
    expect(c().problem?.code).toBe('order_form_incomplete')
    expect(seen.some((s) => s.url.includes('/checkout/start'))).toBe(false)
  })

  it('saves the address, starts the order with the gateway and display currency, and goes to payment', async () => {
    at('/checkout/rust/starter')
    document.cookie = 'currency=eur; path=/'
    serve({
      ...signedIn,
      'QUERY /api/v1/public/checkout/quote': [200, QUOTE(1999)],
      'PATCH /api/v1/user': [204, null],
      'POST /api/v1/user/checkout/start': [200, { data: [{ attributes: { order_id: 'ord_1', approval_url: 'https://pay.example.com/cs_1', paid: false } }] }],
    })
    const c = await mount(useCheckoutPlan, load('checkout.plan'))
    expect(c().currency).toBe('EUR')
    await run(() => c().setPromoCode(' SAVE10 '))
    await run(() => c().submit())
    const calls = seen.filter((s) => s.method !== 'QUERY' && s.method !== 'GET').map((s) => `${s.method} ${s.url}`)
    expect(calls).toEqual(['PATCH /api/v1/user', 'POST /api/v1/user/checkout/start'])
    const start = seen.find((s) => s.url === '/api/v1/user/checkout/start')!.body
    expect(start).toMatchObject({ promo_code: 'SAVE10', gateway: 'stripe', currency: 'EUR' })
    expect(start.items).toHaveLength(1)
    expect(assigned).toEqual(['https://pay.example.com/cs_1'])
  })

  it('places a bank-transfer order and shows its details, and drops the choice when the order stops allowing it', async () => {
    at('/checkout/rust/business')
    serve({
      ...signedIn,
      'QUERY /api/v1/public/checkout/quote': [200, QUOTE(4999)],
      'PATCH /api/v1/user': [204, null],
      'POST /api/v1/user/checkout/start': [
        200,
        { data: [{ attributes: { order_id: 'ord_2', paid: false, bank_transfer: { invoice_id: 'inv_2', invoice_number: 'INV-2', reference: 'HC-2', amount: { amount_cents: 4999, currency: 'USD' }, due_at: '2026-11-25T00:00:00Z' } } }] },
      ],
    })
    const c = await mount(useCheckoutPlan, load('checkout.plan.bank-transfer'))
    expect(c().bankTransferAllowed).toBe(true)
    await run(() => c().setGateway('bank_transfer'))
    await run(() => c().offers[1]!.pick({ domain: 'acme.example' } as never, 'register', 1))
    expect(c().bankTransferAllowed).toBe(false)
    expect(c().gateway).toBe('stripe')
    await run(() => c().offers[1]!.remove())
    await run(() => c().setGateway('bank_transfer'))
    await run(() => c().submit())
    const start = seen.find((s) => s.url === '/api/v1/user/checkout/start')!.body
    expect(start).toMatchObject({ method: 'bank_transfer', promo_code: '' })
    expect(start.gateway).toBeUndefined()
    expect(c().placed?.details.reference).toBe('HC-2')
    expect(assigned).toEqual([])
  })

  it('orders a free plan with no quote, address or payment, and goes to the success page', async () => {
    at('/checkout/rust/free')
    serve({ ...signedIn, 'POST /api/v1/user/checkout/start': [200, { data: [{ attributes: { subscription_id: 'sub_3', paid: true } }] }] })
    const c = await mount(useCheckoutPlan, load('checkout.plan.free'))
    expect(c().anyPaid).toBe(false)
    expect(c().dueNow.amount_minor).toBe(0)
    expect(seen.some((s) => s.method === 'QUERY')).toBe(false)
    await run(() => c().submit())
    expect(seen.some((s) => s.method === 'PATCH')).toBe(false)
    expect(seen.find((s) => s.url === '/api/v1/user/checkout/start')!.body).toEqual({
      items: [{ kind: 'plan', service_id: 'svc_rust', plan_id: 'pln_rust_free', order_config: {} }],
    })
    expect(assigned).toEqual(['/checkout/success'])
  })

  it('refuses add-ons with a free plan when nothing is paid', async () => {
    at('/checkout/rust/free')
    serve({ ...signedIn, 'QUERY /api/v1/public/checkout/quote': [200, QUOTE(0)] })
    const page = load('checkout.plan.free')
    page.data.offers[0].plans = [{ ...page.data.offers[0].plans[0], payment_type: 'free', cycles: [] }]
    const c = await mount(useCheckoutPlan, page)
    await run(() => c().offers[0]!.add())
    await run(() => c().submit())
    expect(c().problem?.code).toBe('addons_need_paid_item')
  })

  it('sends a signed-out customer to sign in and back', async () => {
    at('/checkout/rust/starter?x=1')
    serve({ 'GET /api/v1/user': [401, null], 'QUERY /api/v1/public/checkout/quote': [200, QUOTE(1999)] })
    const c = await mount(useCheckoutPlan, load('checkout.plan'))
    expect(c().customer).toBe('signed_out')
    expect(c().signInUrl).toBe('/login?redirectTo=%2Fcheckout%2Frust%2Fstarter%3Fx%3D1')
  })
})

describe('useCheckoutDomains', () => {
  it('takes the domain from the address, keeps it, quotes it, places the order and forgets it', async () => {
    at('/checkout/domains?domain=acme.example&action=transfer&years=2')
    serve({
      ...signedIn,
      'PUT /checkout/_draft': [204, null],
      'DELETE /checkout/_draft': [204, null],
      'QUERY /api/v1/public/checkout/quote': [200, QUOTE(2598)],
      'PATCH /api/v1/user': [204, null],
      'POST /api/v1/user/checkout/start': [200, { data: [{ attributes: { order_id: 'ord_5', approval_url: 'https://pay.example.com/cs_5', paid: false } }] }],
    })
    const c = await mount(useCheckoutDomains, load('checkout.domains'))
    expect(c().domain).toEqual({ domain: 'acme.example', action: 'transfer', years: 2 })
    expect(seen.find((s) => s.method === 'PUT')!.body).toEqual({ domain: 'acme.example', action: 'transfer', years: 2 })
    expect(seen.filter((s) => s.method === 'QUERY').at(-1)!.body.items).toEqual([{ kind: 'domain', domain: 'acme.example', action: 'transfer', years: 2 }])
    expect(c().promoEnabled).toBe(false)
    await run(() => c().setContact(CONTACT))
    await run(() => c().submit())
    expect(c().problem?.code).toBe('epp_required')
    await run(() => c().setEppCode('EPP-9'))
    await run(() => c().setPrivacy(true))
    await run(() => c().submit())
    const start = seen.find((s) => s.url === '/api/v1/user/checkout/start')!.body
    expect(start).toEqual({
      items: [{ kind: 'domain', domain: 'acme.example', action: 'transfer', years: 2, domain_config: { contact: CONTACT, privacy: true, epp_code: 'EPP-9' } }],
      gateway: 'stripe',
      currency: 'USD',
      promo_code: '',
    })
    expect(seen.at(-1)!.method).toBe('DELETE')
    expect(assigned).toEqual(['https://pay.example.com/cs_5'])
  })

  it('falls back to the saved pick, and to none', async () => {
    at('/checkout/domains')
    serve({ ...signedIn, 'GET /checkout/_draft': [200, { domain: 'acme.test', action: 'register', years: 1 }] })
    const c = await mount(useCheckoutDomains, load('checkout.domains.no-offers'))
    expect(c().domain).toEqual({ domain: 'acme.test', action: 'register', years: 1 })
    serve({ ...signedIn, 'GET /checkout/_draft': [204, null] })
    const none = await mount(useCheckoutDomains, load('checkout.domains.no-offers'))
    expect(none().domain).toBeNull()
  })
})

describe('useCheckoutSuccess and useCheckoutCancel', () => {
  it('confirm the payment the customer returns from, then forget the domain pick', async () => {
    at('/checkout/success?subscription_id=ord%3Aord_1&session_id=cs_1')
    serve({ 'GET /api/v1/user/checkout/success': [200, { data: [{ attributes: { status: 'processing' } }] }], 'DELETE /checkout/_draft': [204, null] })
    const s = await mount(useCheckoutSuccess, load('checkout.success'))
    expect(s().state).toBe('processing')
    expect(seen.map((x) => `${x.method} ${x.url}`)).toEqual([
      'GET /api/v1/user/checkout/success?subscription_id=ord%3Aord_1&session_id=cs_1',
      'DELETE /checkout/_draft',
    ])
  })

  it('show an order that needed no payment as paid, without a call', async () => {
    at('/checkout/success')
    serve({})
    const s = await mount(useCheckoutSuccess, load('checkout.success'))
    expect(s().state).toBe('paid')
    expect(seen).toEqual([])
  })

  it('send a signed-out customer to sign in and back to confirm', async () => {
    at('/checkout/success?subscription_id=ord%3Aord_1&token=EC-1')
    serve({ 'GET /api/v1/user/checkout/success': [401, null], 'POST /api/v1/auth/session/refresh': [401, null] })
    const s = await mount(useCheckoutSuccess, load('checkout.success'))
    expect(s().state).toBe('signed_out')
    expect(assigned).toEqual(['/login?redirectTo=%2Fcheckout%2Fsuccess%3Fsubscription_id%3Dord%253Aord_1%26token%3DEC-1'])
    expect(seen[0]!.url).toContain('session_id=EC-1')
  })

  it('cancel the order whose payment was abandoned', async () => {
    at('/checkout/cancel?subscription_id=ord%3Aord_1')
    serve({ 'GET /api/v1/user/checkout/cancel': [204, null] })
    const s = await mount(useCheckoutCancel, load('checkout.cancel'))
    expect(s().state).toBe('cancelled')
    expect(seen.map((x) => x.url)).toEqual(['/api/v1/user/checkout/cancel?subscription_id=ord%3Aord_1'])
  })
})
