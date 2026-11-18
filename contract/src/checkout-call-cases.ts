import type { CheckoutCall } from './checkout-calls'

/**
 * The cases of the checkout calls, published as `fixtures/checkout-calls.json`:
 * for each call, an HTTP status and JSON body its endpoint answers (after the
 * one session renewal and retry a 401 gets), and the outcome a page receives.
 * A call that needs a signed-in customer reports signed_out with
 * SIGN_IN_URL, the sign-in page returning to the checkout page the call was
 * made from. `hct contract generate` checks each case against the
 * conversions and the contract.
 */

export interface CheckoutCallCase {
  name: string
  call: CheckoutCall
  status: number
  body: unknown
  outcome: unknown
}

export const SIGN_IN_URL = '/login?redirectTo=%2Fcheckout%2Frust%2Fstarter'

const usd = (minor: number) => ({ amount: minor / 100, amount_minor: minor, currency: 'USD' })
const signedOut = { status: 'signed_out', sign_in_url: SIGN_IN_URL }
const error = (code: string, message: string) => ({ status: 'error', code, message })

export const CHECKOUT_CALL_CASES: readonly CheckoutCallCase[] = [
  {
    name: 'a signed-in customer with a billing address',
    call: 'customer',
    status: 200,
    body: {
      data: [
        {
          type: 'user',
          id: 'usr_1',
          attributes: {
            id: 'usr_1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', country: 'gb', state: '',
            address_line1: '1 Example Street', address_line2: '', city: 'London', postal_code: 'N1 9GU', tax_id: 'GB123456789',
          },
        },
      ],
    },
    outcome: {
      status: 'signed_in',
      billing: { country: 'GB', state: '', address_line1: '1 Example Street', address_line2: '', city: 'London', postal_code: 'N1 9GU', tax_id: 'GB123456789' },
    },
  },
  {
    name: 'a customer whose country is not a two-letter code',
    call: 'customer',
    status: 200,
    body: { data: [{ attributes: { country: 'United Kingdom', state: 'Greater London', address_line1: '', address_line2: '', city: '', postal_code: '', tax_id: '' } }] },
    outcome: { status: 'signed_in', billing: { country: '', state: 'Greater London', address_line1: '', address_line2: '', city: '', postal_code: '', tax_id: '' } },
  },
  { name: 'a visitor who is not signed in', call: 'customer', status: 401, body: { error: { code: 'unauthorized', message: 'sign in required' } }, outcome: signedOut },
  { name: 'reading the customer fails', call: 'customer', status: 500, body: null, outcome: error('failed', 'Could not load your account details.') },
  { name: 'the billing address is saved', call: 'save_billing_address', status: 204, body: null, outcome: { status: 'ok' } },
  { name: 'saving the billing address finds the customer signed out', call: 'save_billing_address', status: 401, body: null, outcome: signedOut },
  {
    name: 'the billing address is refused',
    call: 'save_billing_address',
    status: 400,
    body: { error: { code: 'invalid_input', message: 'country must be a two-letter code' } },
    outcome: error('invalid_input', 'country must be a two-letter code'),
  },
  {
    name: 'a quote for a plan with a setup fee and a domain add-on, tax added',
    call: 'quote',
    status: 200,
    body: {
      data: [
        {
          type: 'cart_quote',
          id: 'store_acme',
          attributes: {
            currency: 'USD',
            items: [
              { kind: 'plan', label: 'Rust · Starter (monthly)', cents: 1499, setup_cents: 500 },
              { kind: 'domain', label: 'acme.example · register 1 year', cents: 1299 },
            ],
            subtotal_cents: 3298,
            tax_cents: 660,
            total_cents: 3958,
            tax_inclusive: false,
            incomplete: false,
          },
        },
      ],
    },
    outcome: {
      status: 'ok',
      currency: 'USD',
      lines: [
        { kind: 'plan', label: 'Rust · Starter (monthly)', price: usd(1499), setup_fee: usd(500), error: '', incomplete: false },
        { kind: 'domain', label: 'acme.example · register 1 year', price: usd(1299), setup_fee: usd(0), error: '', incomplete: false },
      ],
      subtotal: usd(3298),
      tax: usd(660),
      total: usd(3958),
      tax_inclusive: false,
      incomplete: false,
    },
  },
  {
    name: 'a quote with an item that cannot be ordered and one still incomplete',
    call: 'quote',
    status: 200,
    body: {
      data: [
        {
          attributes: {
            currency: 'USD',
            items: [
              { kind: 'plan', label: 'Rust · Starter (monthly)', cents: 1299, incomplete: true },
              { kind: 'domain', label: 'acme.invalid', cents: 0, error: '.invalid domains are not available here' },
            ],
            subtotal_cents: 1299,
            tax_cents: 0,
            total_cents: 1299,
            tax_inclusive: true,
            incomplete: true,
          },
        },
      ],
    },
    outcome: {
      status: 'ok',
      currency: 'USD',
      lines: [
        { kind: 'plan', label: 'Rust · Starter (monthly)', price: usd(1299), setup_fee: usd(0), error: '', incomplete: true },
        { kind: 'domain', label: 'acme.invalid', price: usd(0), setup_fee: usd(0), error: '.invalid domains are not available here', incomplete: false },
      ],
      subtotal: usd(1299),
      tax: usd(0),
      total: usd(1299),
      tax_inclusive: true,
      incomplete: true,
    },
  },
  {
    name: 'pricing is refused for too many items',
    call: 'quote',
    status: 400,
    body: { error: { code: 'invalid_input', message: 'a checkout is limited to 20 items' } },
    outcome: error('invalid_input', 'a checkout is limited to 20 items'),
  },
  { name: 'pricing is rate limited', call: 'quote', status: 429, body: null, outcome: error('failed', 'Could not price your order.') },
  {
    name: 'an order paid on the provider page',
    call: 'start',
    status: 200,
    body: { data: [{ type: 'checkout', id: 'ord:ord_1', attributes: { order_id: 'ord_1', approval_url: 'https://pay.example.com/session/cs_1', paid: false } }] },
    outcome: { status: 'redirect', url: 'https://pay.example.com/session/cs_1', order_id: 'ord_1', subscription_id: '' },
  },
  {
    name: 'an order to be paid by bank transfer',
    call: 'start',
    status: 200,
    body: {
      data: [
        {
          type: 'checkout',
          id: 'ord:ord_2',
          attributes: {
            order_id: 'ord_2',
            subscription_id: 'sub_2',
            paid: false,
            bank_transfer: {
              invoice_id: 'inv_2', invoice_number: 'INV-0002', reference: 'HC-0002', amount: { amount_cents: 5999, currency: 'USD', usd_cents: 5999, exchange_rate: 1 },
              due_at: '2026-11-25T00:00:00Z', account_name: 'Acme Hosting Ltd', bank_name: 'Example Bank', iban: 'GB00EXMP00000000000000', swift: 'EXMPGB2L',
              instructions: 'Quote the reference so we can match your payment.',
            },
          },
        },
      ],
    },
    outcome: {
      status: 'bank_transfer',
      order_id: 'ord_2',
      subscription_id: 'sub_2',
      details: {
        invoice_id: 'inv_2', invoice_number: 'INV-0002', reference: 'HC-0002', amount: usd(5999), due_at: '2026-11-25T00:00:00Z',
        account_name: 'Acme Hosting Ltd', bank_name: 'Example Bank', account_number: '', sort_code: '', iban: 'GB00EXMP00000000000000', swift: 'EXMPGB2L',
        instructions: 'Quote the reference so we can match your payment.',
      },
    },
  },
  {
    name: 'a free plan, active at once',
    call: 'start',
    status: 200,
    body: { data: [{ type: 'checkout', id: 'sub_3', attributes: { subscription_id: 'sub_3', paid: true } }] },
    outcome: { status: 'paid', order_id: '', subscription_id: 'sub_3' },
  },
  {
    name: 'an order covered by account credit',
    call: 'start',
    status: 200,
    body: { data: [{ type: 'checkout', id: 'ord:ord_4', attributes: { order_id: 'ord_4', paid: true } }] },
    outcome: { status: 'paid', order_id: 'ord_4', subscription_id: '' },
  },
  { name: 'placing an order finds the customer signed out', call: 'start', status: 401, body: null, outcome: signedOut },
  {
    name: 'a promotion code that does not apply',
    call: 'start',
    status: 422,
    body: { error: { code: 'promo_not_applicable', message: 'this promo code does not apply to your order' } },
    outcome: error('promo_not_applicable', 'this promo code does not apply to your order'),
  },
  {
    name: 'a domain that has been taken',
    call: 'start',
    status: 409,
    body: { error: { code: 'domain_unavailable', message: 'acme.example is not available' } },
    outcome: error('domain_unavailable', 'acme.example is not available'),
  },
  { name: 'placing an order fails', call: 'start', status: 500, body: { error: { code: 'internal', message: '' } }, outcome: error('internal', 'Could not place your order') },
  {
    name: 'a payment confirmed',
    call: 'confirm',
    status: 200,
    body: { data: [{ type: 'checkout', id: 'ord:ord_1', attributes: { status: 'paid' } }] },
    outcome: { status: 'confirmed', payment: 'paid' },
  },
  {
    name: 'a payment still settling',
    call: 'confirm',
    status: 200,
    body: { data: [{ type: 'checkout', id: 'ord:ord_1', attributes: { status: 'processing' } }] },
    outcome: { status: 'confirmed', payment: 'processing' },
  },
  {
    name: 'a payment whose checkout has expired',
    call: 'confirm',
    status: 400,
    body: { error: { code: 'invalid_input', message: 'this checkout has expired' } },
    outcome: error('invalid_input', 'this checkout has expired'),
  },
  { name: 'confirming finds the customer signed out', call: 'confirm', status: 401, body: null, outcome: signedOut },
  { name: 'an abandoned payment cancelled', call: 'cancel', status: 204, body: null, outcome: { status: 'cancelled' } },
  { name: 'cancelling finds the customer signed out', call: 'cancel', status: 401, body: null, outcome: signedOut },
  { name: 'cancelling fails', call: 'cancel', status: 400, body: { error: { code: 'invalid_input', message: 'subscription_id is required' } }, outcome: error('invalid_input', 'subscription_id is required') },
  {
    name: 'a saved domain draft',
    call: 'read_draft',
    status: 200,
    body: { domain: 'Acme.Example', action: 'transfer', years: 2 },
    outcome: { status: 'found', draft: { domain: 'acme.example', action: 'transfer', years: 2 } },
  },
  { name: 'no saved domain draft', call: 'read_draft', status: 204, body: null, outcome: { status: 'none' } },
  { name: 'a saved draft that is not a valid pick', call: 'read_draft', status: 200, body: { domain: 'acme.example', action: 'renew', years: 1 }, outcome: { status: 'none' } },
  { name: 'reading the draft fails', call: 'read_draft', status: 500, body: null, outcome: error('failed', 'Could not read your domain choice.') },
  { name: 'the domain draft is saved', call: 'save_draft', status: 204, body: null, outcome: { status: 'ok' } },
  { name: 'saving the draft is refused', call: 'save_draft', status: 403, body: null, outcome: error('failed', 'Could not save your domain choice.') },
  { name: 'the domain draft is cleared', call: 'clear_draft', status: 204, body: null, outcome: { status: 'ok' } },
]
