import { useEffect } from 'react'
import clsx from 'clsx'
import { useHC } from '@hostcore/toolkit'
import { Header } from './components/Header'
import { HomeView } from './pages/Home'
import { GroupView } from './pages/Group'
import './styles.css'

const PAGES = {
  home: HomeView,
  group: GroupView,
  service: ServiceView,
}

function ServiceView() {
  const { data } = useHC()
  const service = (data as any).service
  const plans = (data as any).plans as any[]
  return (
    <section>
      <h1>{service.name}</h1>
      {plans.map((plan) => (
        <p key={plan.id}>
          {plan.name}: {plan.pricing.price.amount}
        </p>
      ))}
    </section>
  )
}

function NotFoundView() {
  const { data } = useHC()
  return <h1>{data['meta'].title}</h1>
}

function Footer({ year }: { year: number }) {
  const { store } = useHC()
  return (
    <footer>
      © {year} {store.store_name}, {store.business_info.city}
      <a href={store.terms_of_service_url}>Terms</a>
      <a href={store.privacy_policy_url}>Privacy</a>
    </footer>
  )
}

export function App() {
  const { data, store } = useHC()
  const year = new Date().getFullYear()
  useEffect(() => {
    document.title = `${data.meta.title} | ${store.store_name}`
  }, [data.meta.title, store.store_name])
  const Page = PAGES[data.page_type as keyof typeof PAGES] ?? NotFoundView
  return (
    <div className={clsx('shell', store.theme.accent && 'themed')} data-page={data.page_type}>
      <Header />
      <main>
        <Page />
      </main>
      <Footer year={year} />
      {data.domains_enabled && <a href="/domains">Find a domain</a>}
    </div>
  )
}
