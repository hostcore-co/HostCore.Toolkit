import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BillingAddress,
  CheckoutBankTransferPlaced,
  CheckoutCycle,
  CheckoutGateway,
  CheckoutItem,
  CheckoutOffer,
  CheckoutPayment,
  CheckoutPlan,
  CheckoutQuote,
  CheckoutStartRequest,
  DomainContact,
  DomainSearchOutcome,
  DomainSearchResult,
  ExchangeRates,
  Money,
  PriceInterval,
} from '../../../contract/dist/ts/contract-2026-11'
import { PAGES } from '../../../contract/dist/ts/registry'
import { parseDomainDraft, signInUrl, type DomainPick } from '../../../contract/src/checkout-calls'
import { searchDomains } from '../domains'
import { usePage } from '../hooks'
import {
  cancelCheckout,
  checkoutActions,
  checkoutCustomer,
  clearDomainDraft,
  confirmCheckout,
  displayCurrency,
  quoteCheckout,
  readDomainDraft,
  saveBillingAddress,
  saveDomainDraft,
  setDisplayCurrency,
  startCheckout,
  type CheckoutActions,
} from './calls'
import {
  addonItem,
  addonPaid,
  BANK_TRANSFER,
  bankTransferAllowed,
  billingAddressProblem,
  BLANK_BILLING_ADDRESS,
  BLANK_DOMAIN_CONTACT,
  defaultCycle,
  defaultGateway,
  displayMoney,
  domainContactProblem,
  domainFromQuery,
  domainItem,
  eppProblem,
  initialOrderValues,
  orderOptionsMinor,
  planItem,
  planPaid,
  planSelection,
  sortedGateways,
  CHECKOUT_PROBLEMS,
  type AddonSelection,
  type CheckoutProblem,
  type OrderValues,
} from './flow'

/** Where an order that needs no payment step continues: the checkout success page. */
export const CHECKOUT_SUCCESS_PATH = PAGES.find((p) => p.id === 'checkout.success')?.path ?? '/checkout/success'

/** Whether the visitor is signed in: "loading" until known, "unknown" when it could not be found out. */
export type CustomerState = 'loading' | 'signed_in' | 'signed_out' | 'unknown'

function browser(): { location: { pathname: string; search: string; assign(url: string): void } } | null {
  const g = globalThis as { location?: { pathname: string; search: string; assign(url: string): void } }
  return g.location && typeof g.location.assign === 'function' ? { location: g.location } : null
}

function go(url: string): void {
  browser()?.location.assign(url)
}

/** The controls of one add-on offer. */
export interface OfferControl {
  offer: CheckoutOffer
  /** The add-on as it is in the order, or null when it is not added. */
  selection: AddonSelection | null
  /** A service offer: the plan, cycle and answers it is added with, chosen before or after adding. */
  draft: Extract<AddonSelection, { kind: 'plan' }> | null
  /** A service offer: adds it, with the plan, cycle and answers chosen so far. */
  add(): void
  remove(): void
  setPlan(planId: string): void
  setCycle(interval: PriceInterval): void
  setOrderValue(key: string, value: string | boolean): void
  /** A domain offer: searches for domains. */
  search(query: string): Promise<void>
  searching: boolean
  /** A domain offer: the last search's outcome, or null before one. */
  results: DomainSearchOutcome | null
  /** A domain offer: adds a found domain with an action and a term it offers. */
  pick(result: DomainSearchResult, action: 'register' | 'transfer', years: number): void
  setPrivacy(on: boolean): void
  setEppCode(code: string): void
}

/** What both checkouts share. */
export interface CheckoutState {
  /** Whether the visitor is signed in. Show signInUrl as a link instead of the order button when they are not. */
  customer: CustomerState
  /** The sign-in page, returning to this checkout page. */
  signInUrl: string
  payment: CheckoutPayment
  /** The currency prices are shown in, uppercase. */
  currency: string
  /** The currencies the visitor may choose: the store's rates, or the store currency alone. */
  currencies: string[]
  setCurrency(code: string): void
  /** A store-currency amount converted to the display currency. */
  money(amount: Money): Money
  offers: OfferControl[]
  /** The add-ons in the order, in offer order. */
  addons: AddonSelection[]
  /** True when a domain add-on is in the order: the domain contact is needed. */
  needsContact: boolean
  contact: DomainContact
  setContact(patch: Partial<DomainContact>): void
  address: BillingAddress
  setAddress(patch: Partial<BillingAddress>): void
  promoCode: string
  setPromoCode(code: string): void
  /** The gateways in the order they are offered. */
  gateways: CheckoutGateway[]
  /** The chosen gateway, or "bank_transfer". */
  gateway: string
  setGateway(gateway: string): void
  /** True when the order may be paid by bank transfer. */
  bankTransferAllowed: boolean
  /** The server's price for the order, in the store currency, or null before one arrives. */
  quote: CheckoutQuote | null
  /** Why the last attempt to place the order stopped, with a message to show. */
  problem: CheckoutProblem | null
  submitting: boolean
  /** Places the order: checks it, saves the billing address, starts it, and sends the customer on. */
  submit(): Promise<void>
  /** Set when the order was placed to be paid by bank transfer: show its details. */
  placed: CheckoutBankTransferPlaced | null
}

/** The plan checkout, as useCheckoutPlan() returns it. */
export interface PlanCheckout extends CheckoutState {
  plan: CheckoutPlan
  service: ReturnType<typeof usePage<'checkout.plan'>>['data']['service']
  /** True when the plan costs money; false for a free or free-trial plan. */
  primaryPaid: boolean
  /** True when anything in the order costs money: then the billing address, promotion code and payment are asked for. */
  anyPaid: boolean
  /** The enabled billing cycles, monthly first. */
  cycles: CheckoutCycle[]
  /** The chosen cycle, or null for a plan with none. */
  cycle: CheckoutCycle | null
  setCycle(interval: PriceInterval): void
  /** The order form answers. */
  order: OrderValues
  setOrderValue(key: string, value: string | boolean): void
  /** The price of a cycle with the chosen order-form options, per cycle, in the display currency. */
  cyclePrice(cycle: CheckoutCycle): Money
  /** The chosen cycle's setup fee, in the display currency. */
  setupFee: Money
  /** Due now: the quote's total, or before it arrives the plan's own first cycle and setup fee; zero for a free or free-trial plan alone. */
  dueNow: Money
}

/** The domain checkout, as useCheckoutDomains() returns it. */
export interface DomainCheckout extends CheckoutState {
  /** The domain being bought: from the address, else the visitor's saved pick; null when there is none, undefined while it is looked up. */
  domain: DomainPick | null | undefined
  privacy: boolean
  setPrivacy(on: boolean): void
  eppCode: string
  setEppCode(code: string): void
  /** True when a plan add-on is in the order: promotion codes apply to plans only. */
  promoEnabled: boolean
  /** Due now: the quote's total, or null before it arrives. */
  dueNow: Money | null
}

type SearchState = { searching: boolean; results: DomainSearchOutcome | null }

interface Shared {
  ctx: CheckoutActions
  storeCurrency: string
  rates: ExchangeRates | null
  offers: CheckoutOffer[]
  payment: CheckoutPayment
  searchAction: ReturnType<typeof usePage>['actions']['domain_search']
}

/** The state and controls both checkouts have. */
function useShared(s: Shared) {
  const { ctx } = s
  const [customer, setCustomer] = useState<CustomerState>('loading')
  const [signIn, setSignIn] = useState(ctx.login)
  const [currency, setCurrencyState] = useState(s.storeCurrency.toUpperCase())
  const [drafts, setDrafts] = useState<Record<string, AddonSelection>>(() => {
    const out: Record<string, AddonSelection> = {}
    for (const offer of s.offers) {
      const selection = offer.kind === 'service' ? planSelection(offer) : null
      if (selection) out[offer.id] = selection
    }
    return out
  })
  const [selected, setSelected] = useState<Record<string, AddonSelection>>({})
  const [searches, setSearches] = useState<Record<string, SearchState>>({})
  const [contact, setContactState] = useState<DomainContact>(BLANK_DOMAIN_CONTACT)
  const [address, setAddressState] = useState<BillingAddress>(BLANK_BILLING_ADDRESS)
  const [promoCode, setPromoCode] = useState('')
  const [gateway, setGateway] = useState(() => defaultGateway(s.payment.gateways))
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [problem, setProblem] = useState<CheckoutProblem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [placed, setPlaced] = useState<CheckoutBankTransferPlaced | null>(null)

  useEffect(() => {
    const b = browser()
    if (b) setSignIn(signInUrl(ctx.login, `${b.location.pathname}${b.location.search}`))
    setCurrencyState(displayCurrency(s.storeCurrency, s.rates))
    let cancelled = false
    void checkoutCustomer(ctx).then((outcome) => {
      if (cancelled) return
      if (outcome.status === 'signed_in') {
        setAddressState(outcome.billing)
        setCustomer('signed_in')
      } else {
        setCustomer(outcome.status === 'signed_out' ? 'signed_out' : 'unknown')
      }
    })
    return () => {
      cancelled = true
    }
    // The customer is read once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addons = s.offers.map((o) => selected[o.id]).filter((a): a is AddonSelection => a !== undefined)

  const update = (offerId: string, change: (draft: AddonSelection) => AddonSelection) => {
    setDrafts((prev) => {
      const draft = prev[offerId]
      if (!draft) return prev
      const next = change(draft)
      setSelected((sel) => (sel[offerId] ? { ...sel, [offerId]: next } : sel))
      return { ...prev, [offerId]: next }
    })
  }
  const selectDomain = (offerId: string, change: (d: Extract<AddonSelection, { kind: 'domain' }>) => AddonSelection) => {
    setSelected((sel) => {
      const current = sel[offerId]
      return current?.kind === 'domain' ? { ...sel, [offerId]: change(current) } : sel
    })
  }

  const offers: OfferControl[] = s.offers.map((offer) => {
    const draft = drafts[offer.id]
    const search = searches[offer.id] ?? { searching: false, results: null }
    return {
      offer,
      selection: selected[offer.id] ?? null,
      draft: draft?.kind === 'plan' ? draft : null,
      add: () => {
        if (draft) setSelected((sel) => ({ ...sel, [offer.id]: draft }))
      },
      remove: () =>
        setSelected((sel) => {
          const next = { ...sel }
          delete next[offer.id]
          return next
        }),
      setPlan: (planId) => {
        const next = planSelection(offer, planId)
        if (next) update(offer.id, () => next)
      },
      setCycle: (interval) => update(offer.id, (d) => (d.kind === 'plan' && d.plan.cycles.some((c) => c.interval === interval) ? { ...d, cycle: interval } : d)),
      setOrderValue: (key, value) => update(offer.id, (d) => (d.kind === 'plan' ? { ...d, order: { ...d.order, [key]: value } } : d)),
      search: async (query) => {
        const q = query.trim()
        if (!q || search.searching) return
        setSearches((prev) => ({ ...prev, [offer.id]: { searching: true, results: prev[offer.id]?.results ?? null } }))
        const results = await searchDomains(s.searchAction, q)
        setSearches((prev) => ({ ...prev, [offer.id]: { searching: false, results } }))
      },
      searching: search.searching,
      results: search.results,
      pick: (result, action, years) =>
        setSelected((sel) => ({ ...sel, [offer.id]: { kind: 'domain', offer_id: offer.id, domain: result.domain, action, years, privacy: false, epp_code: '' } })),
      setPrivacy: (on) => selectDomain(offer.id, (d) => ({ ...d, privacy: on })),
      setEppCode: (code) => selectDomain(offer.id, (d) => ({ ...d, epp_code: code })),
    }
  })

  const rates = s.rates
  const currencies = rates ? Object.keys(rates).sort() : [s.storeCurrency.toUpperCase()]
  return {
    customer,
    signInUrl: signIn,
    currency,
    currencies,
    setCurrency: (code: string) => {
      if (!currencies.includes(code.toUpperCase())) return
      setDisplayCurrency(code)
      setCurrencyState(code.toUpperCase())
    },
    money: (amount: Money) => displayMoney(amount.amount_minor, amount.currency, currency, rates),
    offers,
    addons,
    contact,
    setContact: (patch: Partial<DomainContact>) => setContactState((c) => ({ ...c, ...patch })),
    address,
    setAddress: (patch: Partial<BillingAddress>) => setAddressState((a) => ({ ...a, ...patch })),
    promoCode,
    setPromoCode,
    gateways: sortedGateways(s.payment.gateways),
    gateway,
    setGateway,
    quote,
    setQuote,
    problem,
    setProblem,
    submitting,
    setSubmitting,
    placed,
    setPlaced,
  }
}

/** Requotes whenever the items or the billing country or state change, while `wanted`. */
function useQuote(
  ctx: CheckoutActions,
  items: CheckoutItem[],
  address: BillingAddress,
  wanted: boolean,
  setQuote: (quote: CheckoutQuote | null) => void,
): void {
  const key = JSON.stringify(items)
  useEffect(() => {
    if (!wanted) {
      setQuote(null)
      return
    }
    let cancelled = false
    void quoteCheckout(ctx, { items, country: address.country, state: address.state }).then((outcome) => {
      if (!cancelled) setQuote(outcome.status === 'ok' ? outcome : null)
    })
    return () => {
      cancelled = true
    }
    // The items are compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted, address.country, address.state])
}

/** Starts the order and sends the customer on; a problem is recorded instead. */
async function place(
  ctx: CheckoutActions,
  request: CheckoutStartRequest,
  saveAddress: BillingAddress | null,
  done: { setProblem(p: CheckoutProblem | null): void; setPlaced(p: CheckoutBankTransferPlaced): void; afterStart?: () => Promise<unknown> },
): Promise<void> {
  if (saveAddress) {
    const saved = await saveBillingAddress(ctx, saveAddress)
    if (saved.status === 'signed_out') return go(saved.sign_in_url)
    if (saved.status === 'error') return done.setProblem({ code: 'start_failed', message: saved.message })
  }
  const outcome = await startCheckout(ctx, request)
  switch (outcome.status) {
    case 'signed_out':
      return go(outcome.sign_in_url)
    case 'error':
      return done.setProblem({ code: 'start_failed', message: outcome.message })
    case 'bank_transfer':
      await done.afterStart?.()
      return done.setPlaced(outcome)
    case 'redirect':
      await done.afterStart?.()
      return go(outcome.url)
    case 'paid':
      await done.afterStart?.()
      return go(CHECKOUT_SUCCESS_PATH)
  }
}

/**
 * The plan checkout's state and controls, for a page file
 * src/pages/checkout.plan.tsx and the islands it uses. It reads the page
 * data, reads the customer once, requotes as the order changes, and places
 * the order as the platform's own checkout does.
 */
export function useCheckoutPlan(): PlanCheckout {
  const page = usePage('checkout.plan')
  const data = page.data
  const ctx = useMemo(() => checkoutActions(page), [page])
  const plan = data.plan
  const shared = useShared({
    ctx,
    storeCurrency: data.payment.currency,
    rates: data.exchange_rates,
    offers: data.offers,
    payment: data.payment,
    searchAction: page.actions.domain_search,
  })
  const [cycleInterval, setCycleInterval] = useState<PriceInterval | null>(() => defaultCycle(plan))
  const [order, setOrder] = useState<OrderValues>(() => initialOrderValues(plan.order_form))

  const primaryPaid = planPaid(plan)
  const anyPaid = primaryPaid || shared.addons.some(addonPaid)
  const allowed = bankTransferAllowed(data.payment, plan, shared.addons)
  const payingByTransfer = shared.gateway === BANK_TRANSFER
  const domainAddons = shared.addons.filter((a): a is Extract<AddonSelection, { kind: 'domain' }> => a.kind === 'domain')

  const items = [planItem(plan, cycleInterval, order), ...shared.addons.map((a) => addonItem(a))]
  useQuote(ctx, items, shared.address, anyPaid || shared.addons.length > 0, shared.setQuote)

  const { setGateway } = shared
  useEffect(() => {
    if (!allowed && payingByTransfer) setGateway(defaultGateway(data.payment.gateways))
  }, [allowed, payingByTransfer, setGateway, data.payment.gateways])

  const cycle = plan.cycles.find((c) => c.interval === cycleInterval) ?? null
  const options = orderOptionsMinor(plan.order_form, order)
  const store = data.payment.currency
  const show = (minor: number) => displayMoney(minor, store, shared.currency, data.exchange_rates)
  const setupMinor = cycle?.setup_fee.amount_minor ?? 0
  const ownDue = primaryPaid && cycle ? cycle.price.amount_minor + options + setupMinor : 0

  const validate = (): CheckoutProblem | null => {
    if (shared.addons.length > 0 && !anyPaid) return { code: 'addons_need_paid_item', message: CHECKOUT_PROBLEMS.addons_need_paid_item }
    if (anyPaid) {
      const billing = billingAddressProblem(shared.address)
      if (billing) return billing
    }
    if (domainAddons.length > 0) {
      const contact = domainContactProblem(shared.contact)
      if (contact) return contact
      for (const d of domainAddons) if (d.action === 'transfer' && !d.epp_code.trim()) return eppProblem(d.domain)
    }
    if (shared.quote?.incomplete) return { code: 'order_form_incomplete', message: CHECKOUT_PROBLEMS.order_form_incomplete }
    if (anyPaid && !shared.gateway) return { code: 'payment_method', message: CHECKOUT_PROBLEMS.payment_method }
    return null
  }

  const submitting = useRef(false)
  const submit = useCallback(async () => {
    if (submitting.current) return
    const problem = validate()
    shared.setProblem(problem)
    if (problem) return
    submitting.current = true
    shared.setSubmitting(true)
    const request: CheckoutStartRequest = { items: [planItem(plan, cycleInterval, order), ...shared.addons.map((a) => addonItem(a, shared.contact))] }
    if (anyPaid) {
      request.promo_code = shared.promoCode.trim()
      if (payingByTransfer) request.method = BANK_TRANSFER
      else {
        request.gateway = shared.gateway
        request.currency = shared.currency.toUpperCase()
      }
    }
    await place(ctx, request, anyPaid ? shared.address : null, { setProblem: shared.setProblem, setPlaced: shared.setPlaced })
    submitting.current = false
    shared.setSubmitting(false)
    // The order is rebuilt from the current state on every call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, plan, cycleInterval, order, anyPaid, payingByTransfer, ctx])

  const { setQuote: _q, setProblem: _p, setSubmitting: _s, setPlaced: _d, ...state } = shared
  return {
    ...state,
    payment: data.payment,
    needsContact: domainAddons.length > 0,
    bankTransferAllowed: allowed,
    submit,
    plan,
    service: data.service,
    primaryPaid,
    anyPaid,
    cycles: plan.cycles,
    cycle,
    setCycle: (interval) => {
      if (plan.cycles.some((c) => c.interval === interval)) setCycleInterval(interval)
    },
    order,
    setOrderValue: (key, value) => setOrder((o) => ({ ...o, [key]: value })),
    cyclePrice: (c) => show(c.price.amount_minor + options),
    setupFee: show(setupMinor),
    dueNow: shared.quote ? shared.money(shared.quote.total) : show(ownDue),
  }
}

/**
 * The domain checkout's state and controls, for src/pages/checkout.domains.tsx
 * and its islands. The domain comes from the address (?domain=…&action=…&years=…),
 * which is then saved on the visitor's device, or else from that saved pick.
 */
export function useCheckoutDomains(): DomainCheckout {
  const page = usePage('checkout.domains')
  const data = page.data
  const ctx = useMemo(() => checkoutActions(page), [page])
  const shared = useShared({
    ctx,
    storeCurrency: data.payment.currency,
    rates: data.exchange_rates,
    offers: data.offers,
    payment: data.payment,
    searchAction: page.actions.domain_search,
  })
  const [domain, setDomain] = useState<DomainPick | null | undefined>(undefined)
  const [privacy, setPrivacy] = useState(false)
  const [eppCode, setEppCode] = useState('')

  useEffect(() => {
    const b = browser()
    const picked = b ? domainFromQuery(new URLSearchParams(b.location.search)) : null
    if (picked) {
      setDomain(picked)
      void saveDomainDraft(ctx, picked)
      return
    }
    let cancelled = false
    void readDomainDraft(ctx).then((outcome) => {
      if (!cancelled) setDomain(outcome.status === 'found' ? parseDomainDraft(outcome.draft) : null)
    })
    return () => {
      cancelled = true
    }
  }, [ctx])

  const items: CheckoutItem[] = domain ? [domainItem(domain), ...shared.addons.map((a) => addonItem(a))] : []
  useQuote(ctx, items, shared.address, Boolean(domain), shared.setQuote)

  const validate = (): CheckoutProblem | null => {
    const billing = billingAddressProblem(shared.address)
    if (billing) return billing
    const contact = domainContactProblem(shared.contact)
    if (contact) return contact
    if (domain?.action === 'transfer' && !eppCode.trim()) return eppProblem(domain.domain)
    for (const a of shared.addons) if (a.kind === 'domain' && a.action === 'transfer' && !a.epp_code.trim()) return eppProblem(a.domain)
    if (shared.quote?.incomplete) return { code: 'order_form_incomplete', message: CHECKOUT_PROBLEMS.order_form_incomplete }
    if (!shared.gateway) return { code: 'payment_method', message: CHECKOUT_PROBLEMS.payment_method }
    return null
  }

  const submitting = useRef(false)
  const submit = useCallback(async () => {
    if (submitting.current || !domain) return
    const problem = validate()
    shared.setProblem(problem)
    if (problem) return
    submitting.current = true
    shared.setSubmitting(true)
    const request: CheckoutStartRequest = {
      items: [domainItem(domain, { contact: shared.contact, privacy, epp_code: eppCode }), ...shared.addons.map((a) => addonItem(a, shared.contact))],
      gateway: shared.gateway,
      currency: shared.currency.toUpperCase(),
      promo_code: shared.promoCode.trim(),
    }
    await place(ctx, request, shared.address, {
      setProblem: shared.setProblem,
      setPlaced: shared.setPlaced,
      afterStart: () => clearDomainDraft(ctx),
    })
    submitting.current = false
    shared.setSubmitting(false)
    // The order is rebuilt from the current state on every call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, domain, privacy, eppCode, ctx])

  const { setQuote: _q, setProblem: _p, setSubmitting: _s, setPlaced: _d, ...state } = shared
  return {
    ...state,
    payment: data.payment,
    needsContact: true,
    bankTransferAllowed: false,
    submit,
    domain,
    privacy,
    setPrivacy,
    eppCode,
    setEppCode,
    promoEnabled: shared.addons.some((a) => a.kind === 'plan'),
    dueNow: shared.quote ? shared.money(shared.quote.total) : null,
  }
}

/** The success page's state. */
export interface CheckoutSuccess {
  /** confirming until the platform answers; paid or processing then; failed with a message; signed_out while the customer is sent to sign in. */
  state: 'confirming' | 'paid' | 'processing' | 'failed' | 'signed_out'
  /** Why it failed. */
  message: string
}

/**
 * The success page's logic, for src/pages/checkout.success.tsx. The payment
 * provider returns the customer here with the order reference in the
 * address; this confirms the payment, which is what completes it and starts
 * the order, then forgets the domain pick. With no reference (an order that
 * needed no payment) there is nothing to confirm. A customer who is not
 * signed in is sent to sign in and back.
 */
export function useCheckoutSuccess(): CheckoutSuccess {
  const page = usePage('checkout.success')
  const ctx = useMemo(() => checkoutActions(page), [page])
  const [state, setState] = useState<CheckoutSuccess['state']>('confirming')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const query = new URLSearchParams(browser()?.location.search ?? '')
    const reference = query.get('subscription_id') ?? ''
    const sessionId = query.get('session_id') ?? query.get('token') ?? ''
    if (!reference) {
      setState('paid')
      return
    }
    void confirmCheckout(ctx, reference, sessionId).then(async (outcome) => {
      if (outcome.status === 'signed_out') {
        setState('signed_out')
        return go(outcome.sign_in_url)
      }
      if (outcome.status === 'error') {
        setMessage(outcome.message)
        return setState('failed')
      }
      setState(outcome.payment)
      await clearDomainDraft(ctx)
    })
  }, [ctx])

  return { state, message }
}

/** The cancel page's state. */
export interface CheckoutCancel {
  /** cancelling until the platform answers; cancelled, or failed with a message; signed_out while the customer is sent to sign in. */
  state: 'cancelling' | 'cancelled' | 'failed' | 'signed_out'
  message: string
}

/**
 * The cancel page's logic, for src/pages/checkout.cancel.tsx. The payment
 * provider returns the customer here when they abandon payment, with the
 * order reference in the address; this cancels the order so its invoice
 * never falls due.
 */
export function useCheckoutCancel(): CheckoutCancel {
  const page = usePage('checkout.cancel')
  const ctx = useMemo(() => checkoutActions(page), [page])
  const [state, setState] = useState<CheckoutCancel['state']>('cancelling')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const reference = new URLSearchParams(browser()?.location.search ?? '').get('subscription_id') ?? ''
    if (!reference) {
      setState('cancelled')
      return
    }
    void cancelCheckout(ctx, reference).then((outcome) => {
      if (outcome.status === 'signed_out') {
        setState('signed_out')
        return go(outcome.sign_in_url)
      }
      if (outcome.status === 'error') {
        setMessage(outcome.message)
        return setState('failed')
      }
      setState('cancelled')
    })
  }, [ctx])

  return { state, message }
}
