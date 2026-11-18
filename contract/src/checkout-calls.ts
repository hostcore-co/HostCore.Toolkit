import type {
  BillingAddress,
  CheckoutQuoteRequest,
  CheckoutStartRequest,
  CheckoutBankTransferDetails,
  CheckoutCancelOutcome,
  CheckoutConfirmOutcome,
  CheckoutCustomerOutcome,
  CheckoutError,
  CheckoutQuoteLine,
  CheckoutQuoteOutcome,
  CheckoutSaveOutcome,
  CheckoutSignedOut,
  CheckoutStartOutcome,
  DomainDraft,
  DomainDraftOutcome,
  Money,
} from '../dist/ts/contract-2026-11'

/**
 * How the answers of the checkout calls become typed outcomes. The SDK uses
 * these when the page does not provide `window.hc.checkout`, and
 * `fixtures/checkout-calls.json` holds their cases for any other
 * implementation to match.
 *
 * Each endpoint answers a JSON body `{ "data": [{ "attributes": … }] }` on
 * success and `{ "error": { "code": "…", "message": "…" } }` otherwise. A
 * call that needs a signed-in customer and gets 401 has already renewed the
 * session once and retried by the time its answer is converted, so 401 here
 * means signed out.
 */

/** The calls of the flow, as the fixtures name them. */
export type CheckoutCall =
  | 'customer'
  | 'save_billing_address'
  | 'quote'
  | 'start'
  | 'confirm'
  | 'cancel'
  | 'read_draft'
  | 'save_draft'
  | 'clear_draft'

/** What a customer reads when a call fails without a message of its own. */
export const CHECKOUT_FAILURES: Readonly<Record<CheckoutCall, string>> = {
  customer: 'Could not load your account details.',
  save_billing_address: 'Could not save your billing address.',
  quote: 'Could not price your order.',
  start: 'Could not place your order',
  confirm: 'We could not confirm your payment.',
  cancel: 'Could not cancel the order.',
  read_draft: 'Could not read your domain choice.',
  save_draft: 'Could not save your domain choice.',
  clear_draft: 'Could not clear your domain choice.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function cents(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
}

/** Minor units as Money, in the contract's convention: amount = minor / 100. */
export function money(minor: number, currency: string): Money {
  return { amount: minor / 100, amount_minor: minor, currency }
}

function attributes(body: unknown): Record<string, unknown> | null {
  const first = isRecord(body) && Array.isArray(body.data) ? body.data[0] : isRecord(body) && isRecord(body.data) ? body.data : undefined
  return isRecord(first) && isRecord(first.attributes) ? first.attributes : null
}

/** A CheckoutError from a failed answer: the platform's code and message, or "failed" and the call's own message. */
export function checkoutError(call: CheckoutCall, body: unknown, code?: string): CheckoutError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}
  const message = text(error.message).trim()
  return { status: 'error', code: code ?? (text(error.code) || 'failed'), message: message || CHECKOUT_FAILURES[call] }
}

function signedOut(signInUrl: string): CheckoutSignedOut {
  return { status: 'signed_out', sign_in_url: signInUrl }
}

function ok(status: number): boolean {
  return status >= 200 && status <= 299
}

/** The sign-in page with a return path: `<login>?redirectTo=<path and query>`. */
export function signInUrl(loginPath: string, returnTo: string): string {
  return `${loginPath}${loginPath.includes('?') ? '&' : '?'}redirectTo=${encodeURIComponent(returnTo)}`
}

/** A billing address from the customer's account. A country that is not a two-letter code is left empty. */
export function billingAddressFrom(user: Record<string, unknown>): BillingAddress {
  const country = text(user.country).trim()
  return {
    country: country.length === 2 ? country.toUpperCase() : '',
    state: text(user.state),
    address_line1: text(user.address_line1),
    address_line2: text(user.address_line2),
    city: text(user.city),
    postal_code: text(user.postal_code),
    tax_id: text(user.tax_id),
  }
}

/** GET of checkout_customer. */
export function checkoutCustomerOutcome(status: number, body: unknown, signIn: string): CheckoutCustomerOutcome {
  if (status === 401) return signedOut(signIn)
  if (!ok(status)) return checkoutError('customer', body)
  const user = attributes(body)
  if (!user) return checkoutError('customer', body, 'failed')
  return { status: 'signed_in', billing: billingAddressFrom(user) }
}

function saveOutcome(call: CheckoutCall, status: number, body: unknown, signIn: string): CheckoutSaveOutcome {
  if (status === 401) return signedOut(signIn)
  return ok(status) ? { status: 'ok' } : checkoutError(call, body)
}

/** PATCH of checkout_customer. */
export function checkoutSaveOutcome(status: number, body: unknown, signIn: string): CheckoutSaveOutcome {
  return saveOutcome('save_billing_address', status, body, signIn)
}

/** checkout_quote. */
export function checkoutQuoteOutcome(status: number, body: unknown): CheckoutQuoteOutcome {
  if (!ok(status)) return checkoutError('quote', body)
  const q = attributes(body)
  if (!q || !Array.isArray(q.items) || typeof q.currency !== 'string') return checkoutError('quote', body, 'failed')
  const currency = q.currency
  const lines: CheckoutQuoteLine[] = q.items.filter(isRecord).map((item) => ({
    kind: item.kind === 'domain' ? 'domain' : 'plan',
    label: text(item.label),
    price: money(cents(item.cents), currency),
    setup_fee: money(cents(item.setup_cents), currency),
    error: text(item.error),
    incomplete: item.incomplete === true,
  }))
  return {
    status: 'ok',
    currency,
    lines,
    subtotal: money(cents(q.subtotal_cents), currency),
    tax: money(cents(q.tax_cents), currency),
    total: money(cents(q.total_cents), currency),
    tax_inclusive: q.tax_inclusive === true,
    incomplete: q.incomplete === true,
  }
}

function bankTransferDetails(raw: Record<string, unknown>): CheckoutBankTransferDetails {
  const amount = isRecord(raw.amount) ? raw.amount : {}
  return {
    invoice_id: text(raw.invoice_id),
    invoice_number: text(raw.invoice_number),
    reference: text(raw.reference),
    amount: money(cents(amount.amount_cents), text(amount.currency)),
    due_at: text(raw.due_at),
    account_name: text(raw.account_name),
    bank_name: text(raw.bank_name),
    account_number: text(raw.account_number),
    sort_code: text(raw.sort_code),
    iban: text(raw.iban),
    swift: text(raw.swift),
    instructions: text(raw.instructions),
  }
}

/** checkout_start. */
export function checkoutStartOutcome(status: number, body: unknown, signIn: string): CheckoutStartOutcome {
  if (status === 401) return signedOut(signIn)
  if (!ok(status)) return checkoutError('start', body)
  const r = attributes(body)
  if (!r) return checkoutError('start', body, 'failed')
  const order_id = text(r.order_id)
  const subscription_id = text(r.subscription_id)
  if (isRecord(r.bank_transfer)) return { status: 'bank_transfer', order_id, subscription_id, details: bankTransferDetails(r.bank_transfer) }
  if (text(r.approval_url) !== '') return { status: 'redirect', url: text(r.approval_url), order_id, subscription_id }
  return { status: 'paid', order_id, subscription_id }
}

/** checkout_confirm. */
export function checkoutConfirmOutcome(status: number, body: unknown, signIn: string): CheckoutConfirmOutcome {
  if (status === 401) return signedOut(signIn)
  if (!ok(status)) return checkoutError('confirm', body)
  return { status: 'confirmed', payment: attributes(body)?.status === 'processing' ? 'processing' : 'paid' }
}

/** checkout_cancel. */
export function checkoutCancelOutcome(status: number, body: unknown, signIn: string): CheckoutCancelOutcome {
  if (status === 401) return signedOut(signIn)
  return ok(status) ? { status: 'cancelled' } : checkoutError('cancel', body)
}

/** A domain draft whose action is known to be register or transfer, as parseDomainDraft returns it. */
export type DomainPick = DomainDraft & { action: 'register' | 'transfer' }

/** The longest term a domain draft may hold. */
export const DRAFT_MAX_YEARS = 10

const DOMAIN_NAME = /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u

/**
 * A domain draft from untrusted input, or null when it is not one: exactly
 * the keys domain, action and years, a domain name (lowercased), register or
 * transfer, and 1 to 10 whole years.
 */
export function parseDomainDraft(raw: unknown): DomainPick | null {
  if (!isRecord(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 3 || !keys.every((k) => k === 'domain' || k === 'action' || k === 'years')) return null
  if (typeof raw.domain !== 'string') return null
  const domain = raw.domain.trim().toLowerCase()
  const action = raw.action
  const years = raw.years
  if (!DOMAIN_NAME.test(domain) || (action !== 'register' && action !== 'transfer')) return null
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > DRAFT_MAX_YEARS) return null
  return { domain, action, years }
}

/** GET of checkout_draft: the draft itself, or 204 when there is none. */
export function domainDraftOutcome(status: number, body: unknown): DomainDraftOutcome {
  if (status === 204 || status === 404) return { status: 'none' }
  if (!ok(status)) return checkoutError('read_draft', body)
  const draft = parseDomainDraft(body)
  return draft ? { status: 'found', draft } : { status: 'none' }
}

/** PUT or DELETE of checkout_draft. */
export function domainDraftSaveOutcome(call: 'save_draft' | 'clear_draft', status: number, body: unknown): CheckoutSaveOutcome {
  return ok(status) ? { status: 'ok' } : checkoutError(call, body)
}

/** The contract type each call's outcome has. */
export const CHECKOUT_OUTCOME_TYPES: Readonly<Record<CheckoutCall, string>> = {
  customer: 'CheckoutCustomerOutcome',
  save_billing_address: 'CheckoutSaveOutcome',
  quote: 'CheckoutQuoteOutcome',
  start: 'CheckoutStartOutcome',
  confirm: 'CheckoutConfirmOutcome',
  cancel: 'CheckoutCancelOutcome',
  read_draft: 'DomainDraftOutcome',
  save_draft: 'CheckoutSaveOutcome',
  clear_draft: 'CheckoutSaveOutcome',
}

/** The outcome of any call from its HTTP status and parsed JSON body (null when there was none). */
export function checkoutCallOutcome(call: CheckoutCall, status: number, body: unknown, signIn: string): unknown {
  switch (call) {
    case 'customer':
      return checkoutCustomerOutcome(status, body, signIn)
    case 'save_billing_address':
      return checkoutSaveOutcome(status, body, signIn)
    case 'quote':
      return checkoutQuoteOutcome(status, body)
    case 'start':
      return checkoutStartOutcome(status, body, signIn)
    case 'confirm':
      return checkoutConfirmOutcome(status, body, signIn)
    case 'cancel':
      return checkoutCancelOutcome(status, body, signIn)
    case 'read_draft':
      return domainDraftOutcome(status, body)
    case 'save_draft':
    case 'clear_draft':
      return domainDraftSaveOutcome(call, status, body)
  }
}

/**
 * What a checkout page offers as `window.hc.checkout`. The platform's own
 * script provides it on a live store, so the requests and answers of the
 * checkout calls can change with the platform rather than with a template's
 * bundle; the SDK's checkout calls use it when it is there and make the
 * requests themselves otherwise.
 *
 * Every method resolves and never rejects. A method that needs a signed-in
 * customer (customer, saveBillingAddress, start, confirm, cancel) that gets
 * 401 renews the session once (a POST of actions.session_refresh, shared by
 * calls made at the same time), retries once, and if that is 401 too, or the
 * renewal fails, resolves to CheckoutSignedOut whose sign_in_url is the
 * sign-in page (nav.links.login) with `redirectTo` set to the current path
 * and query. It does not navigate: the SDK decides whether to.
 */
export interface PageCheckout {
  /** GET of actions.checkout_customer. */
  customer(): Promise<CheckoutCustomerOutcome>
  /** PATCH of actions.checkout_customer with the address, trimmed and its country uppercased. */
  saveBillingAddress(address: BillingAddress): Promise<CheckoutSaveOutcome>
  /** actions.checkout_quote with the request as its JSON body. */
  quote(request: CheckoutQuoteRequest): Promise<CheckoutQuoteOutcome>
  /** POST of actions.checkout_start with the request as its JSON body. */
  start(request: CheckoutStartRequest): Promise<CheckoutStartOutcome>
  /** GET of actions.checkout_confirm with the query subscription_id and session_id. */
  confirm(reference: string, sessionId: string): Promise<CheckoutConfirmOutcome>
  /** GET of actions.checkout_cancel with the query subscription_id. */
  cancel(reference: string): Promise<CheckoutCancelOutcome>
  /** GET of actions.checkout_draft. */
  readDraft(): Promise<DomainDraftOutcome>
  /** PUT of actions.checkout_draft with the draft as its JSON body. */
  saveDraft(draft: DomainDraft): Promise<CheckoutSaveOutcome>
  /** DELETE of actions.checkout_draft. */
  clearDraft(): Promise<CheckoutSaveOutcome>
  /** The currency prices are shown in: the visitor's choice, else the store currency. Uppercase. */
  displayCurrency(): string
  /** Records the visitor's choice of currency for every page of the store. */
  setDisplayCurrency(code: string): void
}
