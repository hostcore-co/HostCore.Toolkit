import type { AnchorHTMLAttributes, ReactNode } from 'react'

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  children?: ReactNode
}

/**
 * Drop-in replacement for <a> that handles internal navigation
 * without a full page reload.
 *
 * Currently a regular <a>. Placeholder for future client-side
 * navigation: template authors should use <Link> everywhere so the
 * upgrade is transparent.
 */
export function Link({ href, children, ...props }: LinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
