import { Link, formatInterval, useMoney, type PageProps } from '@hostcore/toolkit'

export default function CatalogService({ data }: PageProps<'catalog.service'>) {
  const money = useMoney()
  return (
    <section className="px-6 py-12">
      <Link href={data.group.url} className="text-muted">
        ← {data.group.name}
      </Link>
      <h1 className="mt-2 font-heading text-3xl">{data.service.name}</h1>
      <p className="text-muted">{data.service.description}</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {data.plans.map((plan) => (
          <li key={plan.id} className="rounded-card border border-border bg-surface p-5">
            <h2 className="font-heading text-xl">{plan.name}</h2>
            <p className="text-muted">{plan.description}</p>
            <p className="mt-3 text-2xl">
              {plan.payment_type === 'free' ? 'Free' : money.price(plan.price)}
              {plan.payment_type !== 'free' && (
                <span className="text-base text-muted"> / {formatInterval(plan.price.interval)}</span>
              )}
            </p>
            {plan.original_price && <p className="text-muted line-through">{money.price(plan.original_price)}</p>}
            {plan.payment_type === 'free_trial' && <p>{plan.trial_days}-day free trial</p>}
            <Link href={plan.checkout_url} className="mt-4 inline-block rounded-card bg-accent px-4 py-2 text-background">
              Order
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
