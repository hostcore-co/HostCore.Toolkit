import type {
  Action,
  Actions,
  BillingAddress,
  CheckoutCancelOutcome,
  CheckoutConfirmOutcome,
  CheckoutCustomerOutcome,
  CheckoutError,
  CheckoutQuoteOutcome,
  CheckoutQuoteRequest,
  CheckoutSaveOutcome,
  CheckoutStartOutcome,
  CheckoutStartRequest,
  DomainDraft,
  DomainDraftOutcome,
} from '../../../contract/dist/ts/contract-2026-11'
import {
  checkoutCancelOutcome,
  checkoutConfirmOutcome,
  checkoutCustomerOutcome,
  checkoutQuoteOutcome,
  checkoutSaveOutcome,
  checkoutStartOutcome,
  domainDraftOutcome,
  domainDraftSaveOutcome,
  signInUrl,
  type PageCheckout,
} from '../../../contract/src/checkout-calls'

export type { PageCheckout }

/**
 * What the checkout calls need from a checkout page's envelope: its actions
 * and the sign-in page a signed-out customer is sent to. checkoutActions(page)
 * builds it, and the checkout hooks use it themselves.
 */
export interface CheckoutActions {
  actions: Actions
  /** nav.links.login. */
  login: string
}

/** The checkout calls' view of a page envelope. */
export function checkoutActions(page: { actions: Actions; nav: { links: { login: string } } }): CheckoutActions {
  return { actions: page.actions, login: page.nav.links.login }
}

function pageCheckout(): PageCheckout | null {
  const hc = (globalThis as { hc?: { checkout?: Partial<PageCheckout> } }).hc
  const checkout = hc?.checkout
  return checkout && typeof checkout.start === 'function' ? (checkout as PageCheckout) : null
}

/** The page's own outcome, or a failure in its place when it rejects or answers something that is not one. */
async function viaPage<T extends { status: string }>(work: () => Promise<T>, fallback: string): Promise<T | CheckoutError> {
  try {
    const outcome = (await work()) as unknown
    if (typeof outcome === 'object' && outcome !== null && typeof (outcome as { status?: unknown }).status === 'string') return outcome as T
  } catch {
    // The page's checkout resolves by contract; a rejection is reported as a failure like any other.
  }
  return { status: 'error', code: 'failed', message: fallback }
}

function unavailable(name: string): CheckoutError {
  return { status: 'error', code: 'unavailable', message: `This page offers no ${name} action.` }
}

function here(): string {
  const location = (globalThis as { location?: { pathname: string; search: string } }).location
  return location ? `${location.pathname}${location.search}` : '/'
}

interface Answer {
  status: number
  body: unknown
}

async function send(action: Action, method: string, options: { body?: unknown; query?: Record<string, string> } = {}): Promise<Answer> {
  let url = action.url
  if (options.query) {
    const query = new URLSearchParams(options.query).toString()
    if (query) url += `${url.includes('?') ? '&' : '?'}${query}`
  }
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: options.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return { status: 0, body: null }
  }
}

let renewal: Promise<boolean> | null = null

/** Renews the session once for every call that needs it at the same time. */
function renewSession(actions: Actions): Promise<boolean> {
  const refresh = actions.session_refresh
  if (!refresh) return Promise.resolve(false)
  renewal ??= send(refresh, refresh.method)
    .then((answer) => answer.status >= 200 && answer.status <= 299)
    .finally(() => {
      renewal = null
    })
  return renewal
}

/** A request that needs the customer's session: on 401, one renewal and one retry. */
async function withSession(ctx: CheckoutActions, action: Action, method: string, options: { body?: unknown; query?: Record<string, string> } = {}): Promise<Answer> {
  const first = await send(action, method, options)
  if (first.status !== 401) return first
  if (!(await renewSession(ctx.actions))) return first
  return send(action, method, options)
}

/** The visitor as checkout sees them: signed in with their billing address, or signed out. */
export async function checkoutCustomer(ctx: CheckoutActions): Promise<CheckoutCustomerOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.customer(), 'Could not load your account details.')
  const action = ctx.actions.checkout_customer
  if (!action) return unavailable('checkout_customer')
  const answer = await withSession(ctx, action, 'GET')
  return checkoutCustomerOutcome(answer.status, answer.body, signInUrl(ctx.login, here()))
}

/** The billing address as it is saved: trimmed, the country uppercased. */
export function billingAddressToSave(address: BillingAddress): BillingAddress {
  return {
    country: address.country.trim().toUpperCase(),
    state: address.state.trim(),
    address_line1: address.address_line1.trim(),
    address_line2: address.address_line2.trim(),
    city: address.city.trim(),
    postal_code: address.postal_code.trim(),
    tax_id: address.tax_id.trim(),
  }
}

/** Saves the billing address to the customer's account; the order is taxed from it. */
export async function saveBillingAddress(ctx: CheckoutActions, address: BillingAddress): Promise<CheckoutSaveOutcome> {
  const saved = billingAddressToSave(address)
  const page = pageCheckout()
  if (page) return viaPage(() => page.saveBillingAddress(saved), 'Could not save your billing address.')
  const action = ctx.actions.checkout_customer
  if (!action) return unavailable('checkout_customer')
  const answer = await withSession(ctx, action, 'PATCH', { body: saved })
  return checkoutSaveOutcome(answer.status, answer.body, signInUrl(ctx.login, here()))
}

/** Prices an order for display. */
export async function quoteCheckout(ctx: CheckoutActions, request: CheckoutQuoteRequest): Promise<CheckoutQuoteOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.quote(request), 'Could not price your order.')
  const action = ctx.actions.checkout_quote
  if (!action) return unavailable('checkout_quote')
  const answer = await send(action, action.method, { body: request })
  return checkoutQuoteOutcome(answer.status, answer.body)
}

/** Places the order. */
export async function startCheckout(ctx: CheckoutActions, request: CheckoutStartRequest): Promise<CheckoutStartOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.start(request), 'Could not place your order')
  const action = ctx.actions.checkout_start
  if (!action) return unavailable('checkout_start')
  const answer = await withSession(ctx, action, action.method, { body: request })
  return checkoutStartOutcome(answer.status, answer.body, signInUrl(ctx.login, here()))
}

/** Confirms the payment the customer has returned from: what completes the order. */
export async function confirmCheckout(ctx: CheckoutActions, reference: string, sessionId: string): Promise<CheckoutConfirmOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.confirm(reference, sessionId), 'We could not confirm your payment.')
  const action = ctx.actions.checkout_confirm
  if (!action) return unavailable('checkout_confirm')
  const answer = await withSession(ctx, action, action.method, { query: { subscription_id: reference, session_id: sessionId } })
  return checkoutConfirmOutcome(answer.status, answer.body, signInUrl(ctx.login, here()))
}

/** Cancels the order whose payment the customer abandoned. */
export async function cancelCheckout(ctx: CheckoutActions, reference: string): Promise<CheckoutCancelOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.cancel(reference), 'Could not cancel the order.')
  const action = ctx.actions.checkout_cancel
  if (!action) return unavailable('checkout_cancel')
  const answer = await withSession(ctx, action, action.method, { query: { subscription_id: reference } })
  return checkoutCancelOutcome(answer.status, answer.body, signInUrl(ctx.login, here()))
}

/** The domain the visitor picked earlier on this device, if any. */
export async function readDomainDraft(ctx: CheckoutActions): Promise<DomainDraftOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.readDraft(), 'Could not read your domain choice.')
  const action = ctx.actions.checkout_draft
  if (!action) return unavailable('checkout_draft')
  const answer = await send(action, 'GET')
  return domainDraftOutcome(answer.status, answer.body)
}

/** Keeps a domain pick on this device, so it survives signing in. */
export async function saveDomainDraft(ctx: CheckoutActions, draft: DomainDraft): Promise<CheckoutSaveOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.saveDraft(draft), 'Could not save your domain choice.')
  const action = ctx.actions.checkout_draft
  if (!action) return unavailable('checkout_draft')
  const answer = await send(action, 'PUT', { body: draft })
  return domainDraftSaveOutcome('save_draft', answer.status, answer.body)
}

/** Forgets the domain pick, once the order is placed. */
export async function clearDomainDraft(ctx: CheckoutActions): Promise<CheckoutSaveOutcome> {
  const page = pageCheckout()
  if (page) return viaPage(() => page.clearDraft(), 'Could not clear your domain choice.')
  const action = ctx.actions.checkout_draft
  if (!action) return unavailable('checkout_draft')
  const answer = await send(action, 'DELETE')
  return domainDraftSaveOutcome('clear_draft', answer.status, answer.body)
}

/** The cookie the visitor's choice of currency is kept in, for every page of the store. */
export const CURRENCY_COOKIE = 'currency'

function cookieCurrency(): string {
  const document = (globalThis as { document?: { cookie: string } }).document
  const match = document?.cookie.split('; ').find((row) => row.startsWith(`${CURRENCY_COOKIE}=`))
  return match ? decodeURIComponent(match.slice(CURRENCY_COOKIE.length + 1)).trim().slice(0, 3).toUpperCase() : ''
}

/**
 * The currency prices are shown in, uppercase: the visitor's choice when the
 * store has a rate for it, else the store currency. A store with no exchange
 * rates shows its own currency only.
 */
export function displayCurrency(storeCurrency: string, rates: Readonly<Record<string, number>> | null): string {
  const store = storeCurrency.toUpperCase()
  if (!rates) return store
  const page = pageCheckout()
  const chosen = page ? page.displayCurrency().toUpperCase() : cookieCurrency()
  return chosen && rates[chosen] && rates[store] ? chosen : store
}

/** Records the visitor's choice of currency. The page shows it once it reloads. */
export function setDisplayCurrency(code: string): void {
  const page = pageCheckout()
  if (page) {
    page.setDisplayCurrency(code)
    return
  }
  const document = (globalThis as { document?: { cookie: string } }).document
  if (!document) return
  document.cookie = `${CURRENCY_COOKIE}=${encodeURIComponent(code.trim().slice(0, 3).toLowerCase())}; path=/; max-age=31536000; SameSite=Lax`
}
