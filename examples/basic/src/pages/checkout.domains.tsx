import { island, Link, useNav } from '@hostcore/toolkit'
import CheckoutDomains from '../islands/checkout-domains'

export const hydrate = 'islands'
const CheckoutDomainsIsland = island(CheckoutDomains)

/** The domain checkout. */
export default function CheckoutDomainsPage() {
  const nav = useNav()
  return (
    <section className="flex flex-col gap-6 px-6 py-10">
      {nav.links.domains !== '' && (
        <Link href={nav.links.domains} className="text-muted">
          ← Domains
        </Link>
      )}
      <h1 className="font-heading text-3xl">Checkout</h1>
      <CheckoutDomainsIsland />
    </section>
  )
}
