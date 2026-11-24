import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Link, asset, useNav, useSetting, useStore, type LayoutProps } from '@hostcore/toolkit'
import './styles.css'

export default function Layout({ children, variant }: LayoutProps) {
  const store = useStore()
  const nav = useNav()
  const note = useSetting<string>('footer.note')
  const header = useRef<HTMLElement>(null)

  useEffect(() => {
    if (header.current) gsap.from(header.current, { opacity: 0, y: -8, duration: 0.4 })
  }, [])

  return (
    <div className="min-h-screen bg-background text-text">
      <header ref={header} className="flex items-center gap-6 border-b border-border px-6 py-4">
        <Link href={nav.links.home} className="flex items-center gap-2 font-heading text-lg">
          <img src={asset('images/logo.svg')} alt="" width={28} height={28} />
          {store.name}
        </Link>
        {variant === 'default' && (
          <nav className="flex gap-4 text-muted">
            {nav.groups.map((group) => (
              <Link key={group.id} href={group.url}>
                {group.name}
              </Link>
            ))}
            {nav.links.domains !== '' && <Link href={nav.links.domains}>Domains</Link>}
          </nav>
        )}
        <div className="ml-auto flex gap-3">
          <Link href={nav.links.login}>Log in</Link>
          <Link href={nav.links.signup} className="rounded-card bg-accent px-3 py-1 text-background">
            Sign up
          </Link>
        </div>
      </header>
      <main>{children}</main>
      {variant === 'default' && (
        <footer className="border-t border-border px-6 py-8 text-sm text-muted">
          <p>
            © {store.name}
            {nav.links.terms !== '' && (
              <>
                {' · '}
                <Link href={nav.links.terms}>Terms</Link>
              </>
            )}
            {nav.links.privacy !== '' && (
              <>
                {' · '}
                <Link href={nav.links.privacy}>Privacy</Link>
              </>
            )}
          </p>
          {note !== '' && <p>{note}</p>}
        </footer>
      )}
    </div>
  )
}
