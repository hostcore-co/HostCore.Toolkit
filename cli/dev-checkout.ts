import { parseDomainDraft } from '../contract/src/checkout-calls'

/**
 * hct dev's stand-in for the platform's checkout endpoints, so a template's
 * checkout pages can be taken through the whole flow offline: a signed-in or
 * signed-out customer with a sample profile, quotes priced from the
 * fixtures, a domain search, the domain draft, and an order that ends the
 * way the author picks — on a stand-in payment page that returns to the
 * success or cancel page, with bank transfer details, or paid at once. Every
 * request is kept so the author can see what their page sent.
 */

export type StartMode = 'auto' | 'redirect' | 'bank_transfer' | 'paid'

export interface LoggedRequest {
  at: string
  method: string
  path: string
  status: number
  body: unknown
}

type Fixture = { name: string; value: Record<string, any> }

const SAMPLE_PROFILE = {
  id: 'usr_dev',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  country: 'GB',
  state: '',
  address_line1: '1 Example Street',
  address_line2: '',
  city: 'London',
  postal_code: 'N1 9GU',
  tax_id: '',
}

const INTERVALS: Record<string, string> = { monthly: 'month', quarterly: 'quarter', semiannually: 'semi_annual', annually: 'year' }

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px">${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

export class CheckoutSimulator {
  signedIn = true
  mode: StartMode = 'auto'
  profile: Record<string, string> = { ...SAMPLE_PROFILE }
  draft: unknown = null
  log: LoggedRequest[] = []
  private orders = 0
  private plans = new Map<string, Record<string, any>>()
  private tlds = new Map<string, Record<string, any>>()

  constructor(fixtures: Fixture[]) {
    for (const { value } of fixtures) {
      const data = value.data ?? {}
      if (data.plan) this.plans.set(data.plan.id, data.plan)
      for (const offer of data.offers ?? []) {
        for (const plan of offer.plans ?? []) this.plans.set(plan.id, plan)
        for (const tld of offer.tlds ?? []) this.tlds.set(tld.tld, tld)
      }
    }
  }

  private record(request: Request, url: URL, status: number, body: unknown): void {
    this.log.unshift({ at: new Date().toISOString(), method: request.method, path: `${url.pathname}${url.search}`, status, body })
    this.log.length = Math.min(this.log.length, 50)
  }

  /** Answers a request for one of the simulated endpoints, or null for any other. */
  async handle(request: Request, url: URL): Promise<Response | null> {
    const key = `${request.method} ${url.pathname}`
    const known = [
      'GET /api/v1/user',
      'PATCH /api/v1/user',
      'POST /api/v1/auth/session/refresh',
      'QUERY /api/v1/public/checkout/quote',
      'POST /api/v1/user/checkout/start',
      'GET /api/v1/user/checkout/success',
      'GET /api/v1/user/checkout/cancel',
      'GET /checkout/_draft',
      'PUT /checkout/_draft',
      'DELETE /checkout/_draft',
      'POST /api/v1/public/domains/search',
    ]
    if (url.pathname === '/_dev/pay') return this.payPage(url)
    if (url.pathname === '/login') return this.signInPage(url)
    if (!known.includes(key)) return null
    let body: unknown = null
    const text = await request.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const response = this.answer(key, url, body)
    this.record(request, url, response.status, body)
    return response
  }

  private answer(key: string, url: URL, body: any): Response {
    const session = (fn: () => Response) => (this.signedIn ? fn() : json(401, { error: { code: 'unauthorized', message: 'sign in required' } }))
    switch (key) {
      case 'GET /api/v1/user':
        return session(() => json(200, { data: [{ type: 'user', id: this.profile.id, attributes: this.profile }] }))
      case 'PATCH /api/v1/user':
        return session(() => {
          for (const field of ['country', 'state', 'address_line1', 'address_line2', 'city', 'postal_code', 'tax_id']) {
            if (typeof body?.[field] === 'string') this.profile[field] = body[field]
          }
          return json(204, null)
        })
      case 'POST /api/v1/auth/session/refresh':
        return session(() => json(204, null))
      case 'QUERY /api/v1/public/checkout/quote':
        return this.quote(body)
      case 'POST /api/v1/user/checkout/start':
        return session(() => this.start(body))
      case 'GET /api/v1/user/checkout/success':
        return session(() => json(200, { data: [{ type: 'checkout', id: url.searchParams.get('subscription_id') ?? '', attributes: { status: 'paid' } }] }))
      case 'GET /api/v1/user/checkout/cancel':
        return session(() => json(204, null))
      case 'GET /checkout/_draft':
        return this.draft ? json(200, this.draft) : json(204, null)
      case 'PUT /checkout/_draft': {
        const draft = parseDomainDraft(body)
        if (!draft) return json(400, { error: { code: 'invalid_input', message: 'not a domain pick' } })
        this.draft = draft
        return json(204, null)
      }
      case 'DELETE /checkout/_draft':
        this.draft = null
        return json(204, null)
      case 'POST /api/v1/public/domains/search':
        return this.search(body)
    }
    return json(404, null)
  }

  private domainPrices(domain: string): Record<string, any> {
    const tld = domain.slice(domain.indexOf('.') + 1)
    return this.tlds.get(tld) ?? { register: [{ years: 1, amount_minor: 1299 }], transfer: [{ years: 1, amount_minor: 1099 }], renew: [{ years: 1, amount_minor: 1399 }] }
  }

  private termMinor(terms: Array<{ years: number; amount_minor: number }>, years: number): number | null {
    return terms.find((t) => t.years === years)?.amount_minor ?? null
  }

  private quote(body: any): Response {
    const items: any[] = Array.isArray(body?.items) ? body.items : []
    if (items.length === 0) return json(400, { error: { code: 'invalid_input', message: 'the cart is empty' } })
    const lines = items.map((item) => {
      if (item?.kind === 'domain') {
        const prices = this.domainPrices(String(item.domain ?? ''))
        const minor = this.termMinor(prices[item.action === 'transfer' ? 'transfer' : 'register'] ?? [], Number(item.years))
        return minor === null
          ? { kind: 'domain', label: String(item.domain), cents: 0, error: `a ${item.years}-year ${item.action} is not offered` }
          : { kind: 'domain', label: `${item.domain} · ${item.action} ${item.years} year${item.years === 1 ? '' : 's'}`, cents: minor }
      }
      const plan = this.plans.get(String(item?.plan_id))
      if (!plan) return { kind: 'plan', label: String(item?.plan_id), cents: 0, error: 'plan is not purchasable' }
      const config = item.order_config ?? {}
      let options = 0
      let incomplete = false
      for (const c of plan.order_form ?? []) {
        const value = config[c.key]
        if (c.type === 'string' && c.required && String(value ?? '').trim() === '') incomplete = true
        if (c.type === 'checkbox' && value === true) options += c.price ?? 0
        for (const o of c.children ?? []) if (o.value === value) options += o.price
        for (const r of c.dropdown ?? []) for (const o of r.children) if (o.value === value) options += o.price
      }
      if (plan.payment_type !== 'recurring') return { kind: 'plan', label: plan.name, cents: 0, ...(incomplete ? { incomplete } : {}) }
      const cycle = plan.cycles.find((c: any) => c.interval === INTERVALS[item.billing_interval]) ?? plan.cycles[0]
      if (!cycle) return { kind: 'plan', label: plan.name, cents: 0, error: 'plan does not offer this billing interval' }
      return {
        kind: 'plan',
        label: `${plan.name} (${item.billing_interval ?? 'monthly'})`,
        cents: cycle.price.amount_minor + options,
        ...(cycle.setup_fee.amount_minor > 0 ? { setup_cents: cycle.setup_fee.amount_minor } : {}),
        ...(incomplete ? { incomplete } : {}),
      }
    })
    const subtotal = lines.reduce((sum, l: any) => sum + (l.error ? 0 : l.cents + (l.setup_cents ?? 0)), 0)
    const incomplete = lines.some((l: any) => l.incomplete === true)
    return json(200, {
      data: [
        {
          type: 'cart_quote',
          id: 'dev',
          attributes: { currency: 'USD', items: lines, subtotal_cents: subtotal, tax_cents: 0, total_cents: subtotal, tax_inclusive: false, incomplete },
        },
      ],
    })
  }

  private start(body: any): Response {
    const items: any[] = Array.isArray(body?.items) ? body.items : []
    if (items.length === 0) return json(400, { error: { code: 'invalid_input', message: 'the cart is empty' } })
    this.orders += 1
    const order = `ord_dev${this.orders}`
    const free = items.length === 1 && items[0]?.kind === 'plan' && this.plans.get(String(items[0].plan_id))?.payment_type !== 'recurring'
    const mode = this.mode === 'auto' ? (body.method === 'bank_transfer' ? 'bank_transfer' : free ? 'paid' : 'redirect') : this.mode
    if (mode === 'paid') return json(200, { data: [{ type: 'checkout', id: free ? 'sub_dev' : `ord:${order}`, attributes: { ...(free ? { subscription_id: 'sub_dev' } : { order_id: order }), paid: true } }] })
    if (mode === 'bank_transfer') {
      const due = new Date(Date.now() + 7 * 86400000).toISOString()
      return json(200, {
        data: [
          {
            type: 'checkout',
            id: `ord:${order}`,
            attributes: {
              order_id: order,
              paid: false,
              bank_transfer: {
                invoice_id: `inv_dev${this.orders}`,
                invoice_number: `DEV-${String(this.orders).padStart(4, '0')}`,
                reference: `HC-DEV-${this.orders}`,
                amount: { amount_cents: 4999, currency: 'USD' },
                due_at: due,
                account_name: 'Acme Hosting Ltd',
                bank_name: 'Example Bank',
                iban: 'GB00EXMP00000000000000',
                swift: 'EXMPGB2L',
                instructions: 'Quote the reference so we can match your payment.',
              },
            },
          },
        ],
      })
    }
    return json(200, { data: [{ type: 'checkout', id: `ord:${order}`, attributes: { order_id: order, approval_url: `/_dev/pay?ref=${encodeURIComponent(`ord:${order}`)}`, paid: false } }] })
  }

  private search(body: any): Response {
    const query = String(body?.query ?? '').trim().toLowerCase()
    if (!query) return json(400, { error: { code: 'invalid_input', message: 'Enter a domain name.' } })
    const sld = query.split('.')[0]!
    const tlds = query.includes('.') ? [query.slice(query.indexOf('.') + 1)] : [...this.tlds.keys(), ...(this.tlds.size === 0 ? ['example'] : [])]
    const toMap = (terms: Array<{ years: number; amount_minor: number }>) => Object.fromEntries((terms ?? []).map((t) => [String(t.years), t.amount_minor]))
    const results = tlds.map((tld) => {
      const prices = this.domainPrices(`${sld}.${tld}`)
      return {
        domain: `${sld}.${tld}`,
        sld,
        tld,
        available: !sld.startsWith('taken'),
        premium: false,
        register: toMap(prices.register),
        transfer: toMap(prices.transfer),
        renew: toMap(prices.renew),
      }
    })
    return json(200, { data: [{ type: 'domain_search', id: 'dev', attributes: { results, currency: 'USD' } }] })
  }

  private payPage(url: URL): Response {
    const ref = url.searchParams.get('ref') ?? ''
    const success = `/checkout/success?subscription_id=${encodeURIComponent(ref)}&session_id=dev_session`
    const cancel = `/checkout/cancel?subscription_id=${encodeURIComponent(ref)}`
    return page(
      'Payment (hct dev)',
      `<h1>Payment</h1><p>This stands in for the payment provider's page for order <code>${escapeHtml(ref)}</code>. On a store the customer pays there and comes back to one of these.</p><p><a href="${escapeHtml(success)}">Pay and return to the success page</a></p><p><a href="${escapeHtml(cancel)}">Abandon and return to the cancel page</a></p>`,
    )
  }

  private signInPage(url: URL): Response {
    const back = url.searchParams.get('redirectTo') ?? '/'
    const safe = back.startsWith('/') && !back.startsWith('//') ? back : '/'
    return page(
      'Sign in (hct dev)',
      `<h1>Sign in</h1><p>On a store this is the platform's sign-in page. It returns the customer to <code>${escapeHtml(safe)}</code>.</p><p><a href="/_dev/customer?state=signed_in&amp;back=${encodeURIComponent(safe)}">Sign in as the sample customer</a></p>`,
    )
  }

  /** The toolbar items of a checkout page's preview. */
  toolbar(here: string, link: (href: string, text: string, current?: boolean) => string): string[] {
    const back = encodeURIComponent(here)
    return [
      `<span>customer: ${link(`/_dev/customer?state=signed_in&back=${back}`, 'signed in', this.signedIn)} ${link(`/_dev/customer?state=signed_out&back=${back}`, 'signed out', !this.signedIn)}</span>`,
      `<span>order ends: ${(['auto', 'redirect', 'bank_transfer', 'paid'] as const)
        .map((m) => link(`/_dev/start?mode=${m}&back=${back}`, m === 'bank_transfer' ? 'bank transfer' : m, this.mode === m))
        .join(' ')}</span>`,
      link('/_dev/requests', `requests (${this.log.length})`),
    ]
  }

  /** The switches and the request log. */
  control(url: URL): Response | null {
    const back = url.searchParams.get('back') ?? '/'
    const safe = back.startsWith('/') && !back.startsWith('//') ? back : '/'
    if (url.pathname === '/_dev/customer') {
      this.signedIn = url.searchParams.get('state') !== 'signed_out'
      return new Response(null, { status: 302, headers: { location: safe } })
    }
    if (url.pathname === '/_dev/start') {
      const mode = url.searchParams.get('mode')
      if (mode === 'auto' || mode === 'redirect' || mode === 'bank_transfer' || mode === 'paid') this.mode = mode
      return new Response(null, { status: 302, headers: { location: safe } })
    }
    if (url.pathname === '/_dev/requests') {
      const rows = this.log
        .map((r) => `<li><code>${escapeHtml(`${r.method} ${r.path} → ${r.status}`)}</code><br><small>${escapeHtml(r.at)}</small>${r.body === null ? '' : `<pre style="background:#f6f7f9;padding:8px;border-radius:6px;white-space:pre-wrap">${escapeHtml(JSON.stringify(r.body, null, 2))}</pre>`}</li>`)
        .join('')
      return page('Checkout requests (hct dev)', `<h1>What your checkout pages sent</h1><p>Newest first. <a href="/">All pages</a></p><ol>${rows || '<li>Nothing yet.</li>'}</ol>`)
    }
    return null
  }
}
