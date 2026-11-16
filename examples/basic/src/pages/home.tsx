import { Link, island, useSetting, type PageProps } from '@hostcore/toolkit'
import Faq from '../islands/faq'
import DomainSearch from '../islands/domain-search'

// Only the islands below are hydrated; the rest of the page ships as HTML.
export const hydrate = 'islands'

const FaqIsland = island(Faq)
const DomainSearchIsland = island(DomainSearch)

export default function Home({ page, data }: PageProps<'home'>) {
  const title = useSetting('hero.title')
  const subtitle = useSetting('hero.subtitle')
  const cta = useSetting('hero.primary_cta')
  const faq = useSetting('faq.items')
  const columns = useSetting<number>('catalogue.columns')

  return (
    <>
      <section className="hero px-6 py-16">
        <h1 className="font-heading text-4xl">{title}</h1>
        <p className="mt-4 max-w-xl text-muted">{subtitle}</p>
        <Link href={cta.href} className="mt-6 inline-block rounded-card bg-accent px-5 py-2 text-background">
          {cta.label}
        </Link>
        {page.nav.links.domains !== '' && (
          <div className="mt-8">
            <DomainSearchIsland placeholder="Find your domain" />
          </div>
        )}
      </section>
      <section id="catalogue" className="grid gap-4 px-6 py-12" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {data.groups.map((group) => (
          <Link key={group.id} href={group.url} className="rounded-card border border-border bg-surface p-5">
            <h2 className="font-heading text-xl">{group.name}</h2>
            <p className="text-muted">{group.description}</p>
          </Link>
        ))}
        {data.groups.length === 0 && <p className="text-muted">Nothing is on sale yet.</p>}
      </section>
      {faq.length > 0 && (
        <section className="px-6 py-12">
          <h2 className="font-heading text-2xl">Questions</h2>
          <FaqIsland items={faq} />
        </section>
      )}
    </>
  )
}
