import { Link, useHC, useServiceGroups, useStore, type StorePublicInfo } from '@hostcore/toolkit'

export function Header() {
  const store = useStore<StorePublicInfo>()
  const groups = useServiceGroups()
  const { data } = useHC()
  return (
    <header>
      <Link href="/">{store.store_name}</Link>
      {store.logo_url && <img src={store.logo_url} alt="" />}
      <nav>
        {groups.map((g) => (
          <Link key={g.id} href={`/${g.slug}`}>
            {g.name}
          </Link>
        ))}
      </nav>
      {data.domains_enabled && <Link href="/domains">Domains</Link>}
      <Link href="/login">Log in</Link>
    </header>
  )
}
