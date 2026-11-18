import type {
  BillingAddress,
  CheckoutBillingInterval,
  CheckoutGateway,
  CheckoutItem,
  CheckoutOffer,
  CheckoutPayment,
  CheckoutPlan,
  DomainContact,
  DomainDraft,
  Money,
  OrderFormComponent,
  PriceInterval,
} from '../../../contract/dist/ts/contract-2026-11'
import { DRAFT_MAX_YEARS, parseDomainDraft, type DomainPick } from '../../../contract/src/checkout-calls'

/**
 * The rules of the checkout flow, as plain functions: defaults, what may be
 * paid how, the checks before an order is placed, and the requests. The
 * checkout hooks are built on them, so every template behaves the same.
 */

/** The billing cycles in the order the platform offers them. */
export const CYCLE_ORDER: readonly PriceInterval[] = ['month', 'quarter', 'semi_annual', 'year']

/** The name the checkout calls give each billing cycle. */
export const BILLING_INTERVALS: Readonly<Record<PriceInterval, CheckoutBillingInterval>> = {
  month: 'monthly',
  quarter: 'quarterly',
  semi_annual: 'semiannually',
  year: 'annually',
}

/** The value the pay-by-bank-transfer choice takes among the gateways. */
export const BANK_TRANSFER = 'bank_transfer'

/** Order form answers by key: text and choices as strings, checkboxes as booleans. */
export type OrderValues = Record<string, string | boolean>

/** The cycle a plan starts on: its first enabled one in the platform's order. */
export function defaultCycle(plan: CheckoutPlan): PriceInterval | null {
  return CYCLE_ORDER.find((interval) => plan.cycles.some((c) => c.interval === interval)) ?? null
}

/**
 * An order form's first answers: text empty; a checkbox as its default; a
 * radio, slider or dropdown on its first choice; a location on its default
 * region's default choice, else the first.
 */
export function initialOrderValues(form: readonly OrderFormComponent[]): OrderValues {
  const values: OrderValues = {}
  for (const component of form) {
    switch (component.type) {
      case 'checkbox':
        values[component.key] = component.default_value ?? false
        break
      case 'radio':
      case 'slider':
      case 'dropdown':
        values[component.key] = component.children?.[0]?.value ?? ''
        break
      case 'location-multi-dropdown': {
        const region = component.dropdown?.find((r) => r.default) ?? component.dropdown?.[0]
        const location = region?.children.find((c) => c.value === region.default_value) ?? region?.children[0]
        values[component.key] = location?.value ?? ''
        break
      }
      default:
        values[component.key] = ''
    }
  }
  return values
}

/** The components of an order form in the order they are shown. */
export function sortedOrderForm(form: readonly OrderFormComponent[]): OrderFormComponent[] {
  return form.slice().sort((a, b) => a.order - b.order)
}

/**
 * What the chosen order-form options add, in minor units of the store
 * currency. It is charged once per billing cycle, whatever the cycle's
 * length, as the platform prices it.
 */
export function orderOptionsMinor(form: readonly OrderFormComponent[], values: OrderValues): number {
  let total = 0
  for (const component of form) {
    const value = values[component.key]
    if ((component.type === 'radio' || component.type === 'slider' || component.type === 'dropdown') && typeof value === 'string') {
      total += component.children?.find((c) => c.value === value)?.price ?? 0
    } else if (component.type === 'checkbox' && value === true) {
      total += component.price ?? 0
    } else if (component.type === 'location-multi-dropdown' && typeof value === 'string') {
      for (const region of component.dropdown ?? []) {
        const location = region.children.find((c) => c.value === value)
        if (location) {
          total += location.price
          break
        }
      }
    }
  }
  return total
}

/** The gateways in the order they are offered: by name, last first. */
export function sortedGateways(gateways: readonly CheckoutGateway[]): CheckoutGateway[] {
  return gateways.slice().sort((a, b) => b.gateway.localeCompare(a.gateway))
}

/** The gateway chosen at first: the first offered. "" when the store has none. */
export function defaultGateway(gateways: readonly CheckoutGateway[]): string {
  return sortedGateways(gateways)[0]?.gateway ?? ''
}

/** A chosen add-on: a plan of a service offer, or a domain from a domain offer. */
export type AddonSelection =
  | {
      kind: 'plan'
      offer_id: string
      plan: CheckoutPlan
      cycle: PriceInterval | null
      order: OrderValues
    }
  | {
      kind: 'domain'
      offer_id: string
      domain: string
      action: 'register' | 'transfer'
      years: number
      privacy: boolean
      epp_code: string
    }

/** The selection a service offer starts with when it is added: its plan (by default the first), first cycle and first answers. */
export function planSelection(offer: CheckoutOffer, planId?: string): AddonSelection | null {
  const plan = offer.plans.find((p) => p.id === planId) ?? offer.plans[0]
  if (!plan) return null
  return { kind: 'plan', offer_id: offer.id, plan, cycle: defaultCycle(plan), order: initialOrderValues(plan.order_form) }
}

/** Whether an add-on costs money: a recurring plan, or any domain. */
export function addonPaid(addon: AddonSelection): boolean {
  return addon.kind === 'domain' || addon.plan.payment_type === 'recurring'
}

/** Whether a plan costs money: a recurring plan. Free and free-trial plans do not. */
export function planPaid(plan: CheckoutPlan): boolean {
  return plan.payment_type === 'recurring'
}

/**
 * Whether the order may be paid by bank transfer: the store accepts it, the
 * plan bought allows it unless it is free, every add-on is a plan that is
 * free or allows it, and there is no domain.
 */
export function bankTransferAllowed(payment: CheckoutPayment, plan: CheckoutPlan | null, addons: readonly AddonSelection[]): boolean {
  if (!payment.bank_transfer) return false
  if (plan && planPaid(plan) && !plan.allow_bank_transfer) return false
  return addons.every((a) => a.kind === 'plan' && (!planPaid(a.plan) || a.plan.allow_bank_transfer))
}

/** What stops an order being placed, with a message a template may show as it is. */
export interface CheckoutProblem {
  code:
    | 'addons_need_paid_item'
    | 'billing_address_incomplete'
    | 'billing_country'
    | 'domain_contact_incomplete'
    | 'domain_country_code'
    | 'epp_required'
    | 'order_form_incomplete'
    | 'payment_method'
    | 'start_failed'
  message: string
  /** The domain an EPP code is missing for. */
  domain?: string
}

export const CHECKOUT_PROBLEMS: Readonly<Record<Exclude<CheckoutProblem['code'], 'start_failed' | 'epp_required'>, string>> = {
  addons_need_paid_item: 'An order with add-ons needs at least one paid item — remove the add-ons or pick a paid plan.',
  billing_address_incomplete: 'Fill in your billing address so we can invoice and tax the order correctly.',
  billing_country: 'Pick your billing country.',
  domain_contact_incomplete: 'Fill in the domain contact details — registries require them.',
  domain_country_code: 'Country must be a two-letter code, e.g. US.',
  order_form_incomplete: 'Fill in the required fields on the order form.',
  payment_method: 'Pick a payment method.',
}

function problem(code: keyof typeof CHECKOUT_PROBLEMS): CheckoutProblem {
  return { code, message: CHECKOUT_PROBLEMS[code] }
}

/** The EPP code problem for a domain. */
export function eppProblem(domain: string): CheckoutProblem {
  return { code: 'epp_required', message: `Enter the EPP/auth code for ${domain}.`, domain }
}

/** A billing address with what an invoice and tax need: country, first line, city and postal code, the country two letters. */
export function billingAddressProblem(address: BillingAddress): CheckoutProblem | null {
  for (const field of ['country', 'address_line1', 'city', 'postal_code'] as const) {
    if (!address[field].trim()) return problem('billing_address_incomplete')
  }
  return address.country.trim().length === 2 ? null : problem('billing_country')
}

/** A domain contact with what registries require, the country two letters. */
export function domainContactProblem(contact: DomainContact): CheckoutProblem | null {
  for (const field of ['first_name', 'last_name', 'email', 'phone', 'address1', 'city', 'postal_code', 'country_code'] as const) {
    if (!contact[field].trim()) return problem('domain_contact_incomplete')
  }
  return contact.country_code.trim().length === 2 ? null : problem('domain_country_code')
}

export const BLANK_BILLING_ADDRESS: BillingAddress = {
  country: '',
  state: '',
  address_line1: '',
  address_line2: '',
  city: '',
  postal_code: '',
  tax_id: '',
}

export const BLANK_DOMAIN_CONTACT: DomainContact = {
  first_name: '',
  last_name: '',
  organization: '',
  email: '',
  phone: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  postal_code: '',
  country_code: '',
}

/** A plan item: its billing cycle only when the plan is recurring. */
export function planItem(plan: CheckoutPlan, cycle: PriceInterval | null, order: OrderValues): CheckoutItem {
  const item: CheckoutItem = { kind: 'plan', service_id: plan.service_id, plan_id: plan.id, order_config: order }
  if (planPaid(plan) && cycle) item.billing_interval = BILLING_INTERVALS[cycle]
  return item
}

/** A domain item, with its registration extras when contact is given (a start request) and without (a quote). */
export function domainItem(
  domain: { domain: string; action: 'register' | 'transfer'; years: number },
  extras?: { contact: DomainContact; privacy: boolean; epp_code: string },
): CheckoutItem {
  const item: CheckoutItem = { kind: 'domain', domain: domain.domain, action: domain.action, years: domain.years }
  if (extras) {
    item.domain_config = { contact: extras.contact, privacy: extras.privacy }
    if (domain.action === 'transfer') item.domain_config.epp_code = extras.epp_code
  }
  return item
}

/** An add-on's item; a domain's carries the order's one contact when it is for a start request. */
export function addonItem(addon: AddonSelection, contact?: DomainContact): CheckoutItem {
  if (addon.kind === 'plan') return planItem(addon.plan, addon.cycle, addon.order)
  return domainItem(addon, contact ? { contact, privacy: addon.privacy, epp_code: addon.epp_code } : undefined)
}

/** Reads a domain pick from the query a domain search hands over: years defaults to 1 and is capped at 10. */
export function domainFromQuery(query: URLSearchParams): DomainPick | null {
  const years = Number(query.get('years'))
  return parseDomainDraft({
    domain: query.get('domain') ?? '',
    action: query.get('action'),
    years: Number.isInteger(years) && years > 0 ? Math.min(years, DRAFT_MAX_YEARS) : 1,
  })
}

/** Converts store-currency minor units for display, by the ratio of the two currencies' rates. */
export function displayMoney(minor: number, storeCurrency: string, display: string, rates: Readonly<Record<string, number>> | null): Money {
  const from = rates?.[storeCurrency.toUpperCase()]
  const to = rates?.[display.toUpperCase()]
  const converted = from && to && display.toUpperCase() !== storeCurrency.toUpperCase() ? Math.round((minor * to) / from) : minor
  const currency = from && to ? display.toUpperCase() : storeCurrency.toUpperCase()
  return { amount: converted / 100, amount_minor: converted, currency }
}
