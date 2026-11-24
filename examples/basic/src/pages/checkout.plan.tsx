import { island, Link, type PageProps } from '@hostcore/toolkit'
import CheckoutPlan from '../islands/checkout-plan'

export const hydrate = 'islands'
const CheckoutPlanIsland = island(CheckoutPlan)

/** The plan checkout. The heading and back link need no script; the checkout itself is an island. */
export default function CheckoutPlanPage({ data }: PageProps<'checkout.plan'>) {
  return (
    <section className="flex flex-col gap-6 px-6 py-10">
      <Link href={data.service.single_plan ? (data.group?.url ?? data.service.url) : data.service.url} className="text-muted">
        ← {data.service.name}
      </Link>
      <h1 className="font-heading text-3xl">Checkout</h1>
      <CheckoutPlanIsland />
    </section>
  )
}
