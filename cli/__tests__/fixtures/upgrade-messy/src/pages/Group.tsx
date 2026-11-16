import { useHC, type GroupPageData } from '@hostcore/toolkit'

export function GroupView() {
  const { data } = useHC()
  const group = data as GroupPageData
  return (
    <section>
      <h1>{group.group.name}</h1>
      {group.services.map(({ service, cheapest_plan }) => (
        <article key={service.id}>
          <a href={`/${group.group.slug}/${service.slug}`}>{service.name}</a>
          <span>
            {cheapest_plan.pricing.price.amount} {cheapest_plan.pricing.price.currency}
          </span>
          {cheapest_plan.pricing.original_price && <s>{cheapest_plan.pricing.original_price.amount}</s>}
          <a href={`/checkout/${service.slug}?plan=${cheapest_plan.slug}`}>Order</a>
        </article>
      ))}
    </section>
  )
}
