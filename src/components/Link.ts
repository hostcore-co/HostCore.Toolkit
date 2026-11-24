import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react'

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  children?: ReactNode
}

/**
 * Drop-in replacement for <a>. Use it for every link in a template, with an
 * href taken from the page data (`useNav().links`, `group.url`,
 * `service.url`, `plan.checkout_url`), so links keep working however the
 * platform routes them.
 *
 * Today it renders a plain <a>; navigating with it is a full page load.
 */
export function Link({ href, children, ...props }: LinkProps) {
  return createElement('a', { href, ...props }, children)
}
