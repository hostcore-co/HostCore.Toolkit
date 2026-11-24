import {
  BANK_TRANSFER,
  formatMoney,
  sortedOrderForm,
  useNav,
  type CheckoutBankTransferPlaced,
  type CheckoutQuote,
  type CheckoutState,
  type Contract,
  type Money,
  type OfferControl,
  type OrderValues,
} from '@hostcore/toolkit'

/**
 * The parts both checkout islands are made of. All the flow's logic is in the
 * SDK's checkout hooks; these only lay their state out.
 */

export function show(money: Money): string {
  return formatMoney(money.amount, money.currency)
}

/** A store-currency amount in minor units, as Money. */
export function storeMoney(minor: number, currency: string): Money {
  return { amount: minor / 100, amount_minor: minor, currency }
}

const INTERVAL_NAMES: Record<Contract.PriceInterval, string> = { month: 'Monthly', quarter: 'Quarterly', semi_annual: 'Semi-annually', year: 'Annually' }
const INTERVAL_SHORT: Record<Contract.PriceInterval, string> = { month: '/mo', quarter: '/3mo', semi_annual: '/6mo', year: '/yr' }

export function intervalName(interval: Contract.PriceInterval): string {
  return INTERVAL_NAMES[interval]
}

export function perInterval(interval: Contract.PriceInterval): string {
  return INTERVAL_SHORT[interval]
}

const field = 'w-full rounded-card border border-border bg-surface px-3 py-2'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl">{title}</h2>
      {children}
    </section>
  )
}

function Input(props: { label: string; value: string; onChange(value: string): void; required?: boolean; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">
        {props.label}
        {props.required ? ' *' : ''}
      </span>
      <input className={field} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  )
}

/** Every kind of order form field, with the price each option adds per billing cycle. */
export function OrderFormFields(props: {
  form: Contract.OrderFormComponent[]
  values: OrderValues
  onChange(key: string, value: string | boolean): void
  price(minor: number): string
}) {
  const { values, onChange, price } = props
  const extra = (minor: number) => (minor > 0 ? ` (+${price(minor)})` : '')
  return (
    <div className="flex flex-col gap-4">
      {sortedOrderForm(props.form).map((c) => {
        const value = values[c.key]
        const label = `${c.label}${c.required ? ' *' : ''}`
        switch (c.type) {
          case 'string':
            return (
              <label key={c.key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{label}</span>
                <input className={field} value={String(value ?? '')} placeholder={c.placeholder ?? ''} onChange={(e) => onChange(c.key, e.target.value)} />
                {c.description && <small className="text-muted">{c.description}</small>}
              </label>
            )
          case 'checkbox':
            return (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value === true} onChange={(e) => onChange(c.key, e.target.checked)} />
                {label}
                {extra(c.price ?? 0)}
              </label>
            )
          case 'radio':
            return (
              <fieldset key={c.key} className="flex flex-col gap-1 text-sm">
                <legend className="text-muted">{label}</legend>
                {(c.children ?? []).map((o) => (
                  <label key={o.value} className="flex items-center gap-2">
                    <input type="radio" name={c.key} checked={value === o.value} onChange={() => onChange(c.key, o.value)} />
                    {o.label}
                    {extra(o.price)}
                  </label>
                ))}
              </fieldset>
            )
          case 'slider': {
            const options = c.children ?? []
            const index = Math.max(0, options.findIndex((o) => o.value === value))
            return (
              <label key={c.key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">
                  {label}: {options[index]?.label}
                  {extra(options[index]?.price ?? 0)}
                </span>
                <input type="range" min={0} max={Math.max(0, options.length - 1)} value={index} onChange={(e) => onChange(c.key, options[Number(e.target.value)]?.value ?? '')} />
              </label>
            )
          }
          case 'dropdown':
            return (
              <label key={c.key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{label}</span>
                <select className={field} value={String(value ?? '')} onChange={(e) => onChange(c.key, e.target.value)}>
                  {(c.children ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {extra(o.price)}
                    </option>
                  ))}
                </select>
              </label>
            )
          case 'location-multi-dropdown':
            return (
              <label key={c.key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{label}</span>
                <select className={field} value={String(value ?? '')} onChange={(e) => onChange(c.key, e.target.value)}>
                  {(c.dropdown ?? [])
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((region) => (
                      <optgroup key={region.label} label={region.label}>
                        {region.children.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                            {extra(o.price)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </label>
            )
          default:
            return null
        }
      })}
    </div>
  )
}

/** The add-on offers: a service offer's plan, cycle and answers, or a domain search. */
export function Offers({ offers, price }: { offers: OfferControl[]; price(minor: number): string }) {
  if (offers.length === 0) return null
  return (
    <Section title="Recommended add-ons">
      {offers.map((o) => (
        <div key={o.offer.id} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <div>
            <h3 className="font-heading">{o.offer.title}</h3>
            {o.offer.description && <p className="text-sm text-muted">{o.offer.description}</p>}
          </div>
          {o.offer.kind === 'service' && o.draft ? <ServiceOffer offer={o} price={price} /> : <DomainOffer offer={o} />}
        </div>
      ))}
    </Section>
  )
}

function ServiceOffer({ offer, price }: { offer: OfferControl; price(minor: number): string }) {
  const draft = offer.draft!
  const cycle = draft.plan.cycles.find((c) => c.interval === draft.cycle)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {offer.offer.plans.length > 1 && (
          <select className="rounded-card border border-border bg-background px-2 py-1" value={draft.plan.id} onChange={(e) => offer.setPlan(e.target.value)}>
            {offer.offer.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {draft.plan.payment_type === 'recurring' && draft.plan.cycles.length > 1 && (
          <select
            className="rounded-card border border-border bg-background px-2 py-1"
            value={draft.cycle ?? ''}
            onChange={(e) => offer.setCycle(e.target.value as Contract.PriceInterval)}
          >
            {draft.plan.cycles.map((c) => (
              <option key={c.interval} value={c.interval}>
                {intervalName(c.interval)}
              </option>
            ))}
          </select>
        )}
        <span className="text-sm">
          {draft.plan.payment_type === 'free'
            ? 'Free'
            : draft.plan.payment_type === 'free_trial'
              ? `Free for ${draft.plan.trial_days} days`
              : cycle
                ? `${price(cycle.price.amount_minor)}${perInterval(cycle.interval)}`
                : ''}
        </span>
        <button type="button" className="ml-auto rounded-card border border-border px-3 py-1" onClick={() => (offer.selection ? offer.remove() : offer.add())}>
          {offer.selection ? 'Remove' : 'Add'}
        </button>
      </div>
      {offer.selection && draft.plan.order_form.length > 0 && (
        <OrderFormFields form={draft.plan.order_form} values={draft.order} onChange={offer.setOrderValue} price={price} />
      )}
    </>
  )
}

function DomainOffer({ offer }: { offer: OfferControl }) {
  const selection = offer.selection?.kind === 'domain' ? offer.selection : null
  if (selection) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>
          {selection.domain} · {selection.action} · {selection.years} {selection.years === 1 ? 'year' : 'years'}
          <button type="button" className="ml-3 underline" onClick={offer.remove}>
            Remove
          </button>
        </p>
        {selection.action === 'transfer' && <Input label="EPP / auth code" required value={selection.epp_code} onChange={offer.setEppCode} />}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={selection.privacy} onChange={(e) => offer.setPrivacy(e.target.checked)} />
          WHOIS privacy
        </label>
      </div>
    )
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void offer.search(String(new FormData(e.currentTarget).get('query') ?? ''))
      }}
    >
      <div className="flex gap-2">
        <input name="query" className={field} placeholder="yourdomain.com" />
        <button type="submit" className="rounded-card bg-accent px-3 py-2 text-background" disabled={offer.searching}>
          {offer.searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {offer.results?.status === 'error' && <p className="text-sm">{offer.results.message}</p>}
      {offer.results?.status === 'ok' && (
        <ul className="flex flex-col gap-1 text-sm">
          {offer.results.results.map((r) => {
            const terms = r.action === 'register' ? r.register : r.transfer
            return (
              <li key={r.domain} className="flex flex-wrap items-center gap-2">
                <span>{r.domain}</span>
                {r.action === 'none' ? (
                  <span className="text-muted">{r.reason || 'Taken'}</span>
                ) : (
                  terms.map((t) => (
                    <button key={t.years} type="button" className="rounded-card border border-border px-2" onClick={() => offer.pick(r, r.action as 'register' | 'transfer', t.years)}>
                      {r.action === 'register' ? 'Register' : 'Transfer'} {t.years}y · {formatMoney(t.amount, t.currency)}
                    </button>
                  ))
                )}
              </li>
            )
          })}
        </ul>
      )}
    </form>
  )
}

/** The registrant contact for the order's domains. */
export function ContactFields({ state }: { state: CheckoutState }) {
  const c = state.contact
  const set = (key: keyof Contract.DomainContact) => (value: string) => state.setContact({ [key]: value })
  return (
    <Section title="Domain contact">
      <p className="text-sm text-muted">Registries require a contact for every domain; this one is used for all of them.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="First name" required value={c.first_name} onChange={set('first_name')} />
        <Input label="Last name" required value={c.last_name} onChange={set('last_name')} />
        <Input label="Organization" value={c.organization} onChange={set('organization')} />
        <Input label="Email" required value={c.email} onChange={set('email')} />
        <Input label="Phone" required value={c.phone} onChange={set('phone')} placeholder="+1.5555550100" />
        <Input label="Address" required value={c.address1} onChange={set('address1')} />
        <Input label="Address line 2" value={c.address2} onChange={set('address2')} />
        <Input label="City" required value={c.city} onChange={set('city')} />
        <Input label="State or region" value={c.state} onChange={set('state')} />
        <Input label="Postal code" required value={c.postal_code} onChange={set('postal_code')} />
        <Input label="Country code" required value={c.country_code} onChange={set('country_code')} placeholder="US" />
      </div>
    </Section>
  )
}

/** The billing address, saved to the customer's account when the order is placed. */
export function AddressFields({ state }: { state: CheckoutState }) {
  const a = state.address
  const set = (key: keyof Contract.BillingAddress) => (value: string) => state.setAddress({ [key]: value })
  return (
    <Section title="Billing address">
      <p className="text-sm text-muted">Used for your invoice and to work out tax.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Country code" required value={a.country} onChange={set('country')} placeholder="US" />
        <Input label="State or region" value={a.state} onChange={set('state')} />
        <Input label="Address" required value={a.address_line1} onChange={set('address_line1')} />
        <Input label="Address line 2" value={a.address_line2} onChange={set('address_line2')} />
        <Input label="City" required value={a.city} onChange={set('city')} />
        <Input label="Postal code" required value={a.postal_code} onChange={set('postal_code')} />
        <Input label="Tax ID" value={a.tax_id} onChange={set('tax_id')} />
      </div>
    </Section>
  )
}

const GATEWAY_NAMES: Record<string, string> = { stripe: 'Card (Stripe)', paypal: 'PayPal' }

/** The gateways, and bank transfer when the order may be paid that way. */
export function PaymentChoice({ state }: { state: CheckoutState }) {
  return (
    <Section title="Payment">
      <div className="flex flex-col gap-2 text-sm">
        {state.gateways.map((g) => (
          <label key={g.gateway} className="flex items-center gap-2">
            <input type="radio" name="gateway" checked={state.gateway === g.gateway} onChange={() => state.setGateway(g.gateway)} />
            {GATEWAY_NAMES[g.gateway] ?? g.gateway}
          </label>
        ))}
        {state.bankTransferAllowed && (
          <label className="flex items-center gap-2">
            <input type="radio" name="gateway" checked={state.gateway === BANK_TRANSFER} onChange={() => state.setGateway(BANK_TRANSFER)} />
            Bank transfer
          </label>
        )}
        {state.gateway === BANK_TRANSFER && state.payment.bank_transfer && (
          <p className="text-muted">
            You will get our bank details and a payment reference. Your order starts once the transfer clears, usually within {state.payment.bank_transfer.due_days} days.
          </p>
        )}
      </div>
    </Section>
  )
}

/** One line per item of the quote, then subtotal, tax and total. */
export function QuoteLines({ quote, money }: { quote: CheckoutQuote; money(m: Money): Money }) {
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {quote.lines.map((line, i) => (
        <div key={i} className="flex justify-between gap-3">
          <dt>
            {line.label}
            {line.error && <span className="block text-xs">{line.error}</span>}
            {line.setup_fee.amount_minor > 0 && <span className="block text-xs text-muted">+{show(money(line.setup_fee))} setup fee</span>}
          </dt>
          <dd>{line.error ? '…' : show(money(line.price))}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-1">
        <dt className="text-muted">Subtotal</dt>
        <dd>{show(money(quote.subtotal))}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted">{quote.tax_inclusive ? 'Tax (incl.)' : 'Tax'}</dt>
        <dd>{quote.tax.amount_minor > 0 ? show(money(quote.tax)) : '—'}</dd>
      </div>
    </dl>
  )
}

/** The display currency, from the store's rates. */
export function CurrencyChoice({ state }: { state: CheckoutState }) {
  if (state.currencies.length < 2) return null
  return (
    <select className="rounded-card border border-border bg-surface px-2 py-1 text-sm" value={state.currency} onChange={(e) => state.setCurrency(e.target.value)}>
      {state.currencies.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  )
}

/** The promotion code, the order button or the sign-in link, the problem, and the terms. */
export function PlaceOrder({ state, label, promo }: { state: CheckoutState; label: string; promo: 'shown' | 'disabled' | 'hidden' }) {
  const nav = useNav()
  return (
    <div className="flex flex-col gap-3">
      {promo !== 'hidden' && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Promo code{promo === 'disabled' ? ' (promo codes apply to plans only)' : ''}</span>
          <input className={field} value={state.promoCode} disabled={promo === 'disabled'} onChange={(e) => state.setPromoCode(e.target.value)} />
        </label>
      )}
      {state.problem && (
        <p role="alert" className="rounded-card border border-border p-3 text-sm">
          {state.problem.message}
        </p>
      )}
      {state.customer === 'signed_out' ? (
        <a href={state.signInUrl} className="rounded-card bg-accent px-4 py-3 text-center text-background">
          Sign in to complete your order
        </a>
      ) : (
        <button type="button" disabled={state.submitting || state.customer === 'loading'} onClick={() => void state.submit()} className="rounded-card bg-accent px-4 py-3 text-background">
          {state.submitting ? 'Processing…' : label}
        </button>
      )}
      <p className="flex gap-4 text-xs text-muted">
        {nav.links.terms && <a href={nav.links.terms}>Terms of Service</a>}
        {nav.links.privacy && <a href={nav.links.privacy}>Privacy Policy</a>}
      </p>
    </div>
  )
}

/** A placed bank-transfer order: where to send the money. */
export function BankTransferDetails({ placed }: { placed: CheckoutBankTransferPlaced }) {
  const nav = useNav()
  const d = placed.details
  const rows: [string, string][] = [
    ['Amount to send', show(d.amount)],
    ['Payment reference', d.reference],
    ['Please send by', new Date(d.due_at).toLocaleDateString()],
    ['Account name', d.account_name],
    ['Bank', d.bank_name],
    ['Account number', d.account_number],
    ['Sort code', d.sort_code],
    ['IBAN', d.iban],
    ['SWIFT/BIC', d.swift],
  ]
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl">Almost there — send your payment</h1>
      <p className="text-muted">Invoice {d.invoice_number} is waiting on your transfer. We will start your order as soon as it arrives.</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {rows
          .filter(([, value]) => value !== '')
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {d.instructions && <p className="text-sm">{d.instructions}</p>}
      <a href={`${nav.links.account}/billing/${encodeURIComponent(d.invoice_id)}`} className="rounded-card bg-accent px-4 py-3 text-center text-background">
        View invoice
      </a>
    </section>
  )
}
