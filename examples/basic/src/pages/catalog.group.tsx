import useEmblaCarousel from 'embla-carousel-react'
import { Link, formatInterval, useMoney, type PageProps } from '@hostcore/toolkit'

export default function CatalogGroup({ data }: PageProps<'catalog.group'>) {
  const money = useMoney()
  const [viewport, carousel] = useEmblaCarousel({ align: 'start' })

  return (
    <section className="px-6 py-12">
      <h1 className="font-heading text-3xl">{data.group.marketing.title || data.group.name}</h1>
      <p className="text-muted">{data.group.marketing.description || data.group.description}</p>
      <div ref={viewport} className="mt-8 overflow-hidden">
        <ul className="flex gap-4">
          {data.services.map(({ service, from }) => (
            <li key={service.id} className="min-w-64 rounded-card border border-border bg-surface p-5">
              <h2 className="font-heading text-xl">{service.name}</h2>
              <p className="text-muted">{service.description}</p>
              <p className="mt-3">
                From {money.price(from.price)}
                <span className="text-muted"> / {formatInterval(from.price.interval)}</span>
              </p>
              <Link href={service.url} className="mt-4 inline-block text-accent">
                {service.single_plan ? 'Order now' : 'View plans'}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {data.services.length > 1 && (
        <button type="button" className="mt-4" onClick={() => carousel?.scrollNext()}>
          Next
        </button>
      )}
      {data.services.length === 0 && <p className="text-muted">Nothing in this group is on sale yet.</p>}
    </section>
  )
}
