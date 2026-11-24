import { useCheckoutDomains, useNav } from '@hostcore/toolkit'
import { AddressFields, BankTransferDetails, ContactFields, CurrencyChoice, Offers, PaymentChoice, PlaceOrder, QuoteLines, Section, show, storeMoney } from '../checkout/parts'

/** The domain checkout: the domain picked in a search, its add-ons, pay. */
export default function CheckoutDomains() {
  const c = useCheckoutDomains()
  const nav = useNav()
  const price = (minor: number) => show(c.money(storeMoney(minor, c.payment.currency)))
  if (c.placed) return <BankTransferDetails placed={c.placed} />
  if (c.domain === undefined) return <p className="text-muted">Loading your domain…</p>
  if (c.domain === null) {
    return (
      <p>
        You have not picked a domain yet. {nav.links.domains !== '' && <a href={nav.links.domains}>Find a domain</a>}
      </p>
    )
  }
  const domain = c.domain
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <aside className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Due at checkout</p>
          <CurrencyChoice state={c} />
        </div>
        <p className="font-heading text-4xl">{c.dueNow ? show(c.dueNow) : '…'}</p>
        {c.quote && <QuoteLines quote={c.quote} money={c.money} />}
        <p className="text-xs text-muted">Enter your billing country to see tax; promo discounts apply when you pay.</p>
      </aside>
      <div className="flex flex-col gap-8">
        <AddressFields state={c} />
        <ContactFields state={c} />
        <Section title={domain.domain}>
          <p className="text-sm text-muted">
            {domain.action === 'register' ? 'Registration' : 'Transfer'} · {domain.years} {domain.years === 1 ? 'year' : 'years'}
          </p>
          {domain.action === 'transfer' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">EPP / auth code *</span>
              <input className="rounded-card border border-border bg-surface px-3 py-2" value={c.eppCode} onChange={(e) => c.setEppCode(e.target.value)} />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.privacy} onChange={(e) => c.setPrivacy(e.target.checked)} />
            WHOIS privacy
          </label>
        </Section>
        <Offers offers={c.offers} price={price} />
        <PaymentChoice state={c} />
        <PlaceOrder state={c} label="Pay & complete order" promo={c.promoEnabled ? 'shown' : 'disabled'} />
        <p className="text-xs text-muted">Your domain choice is saved on this device, so signing in will not lose it.</p>
      </div>
    </div>
  )
}
