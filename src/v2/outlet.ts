import { createElement, useContext } from 'react'
import { PageContext } from './context'

/** The element that marks where a layout's page goes. */
export const OUTLET_TAG = 'hc-outlet'

/**
 * Where a layout puts the page. A layout renders it exactly once — or
 * renders its `children` prop, which is the same thing.
 *
 * It renders a `<hc-outlet>` element around the page. Style it with
 * `hc-outlet { display: contents }` if your layout's CSS needs the page's
 * own elements to be direct children of the surrounding container.
 */
export function Outlet() {
  const outlet = useContext(PageContext)?.outlet
  if (!outlet) throw new Error('<Outlet/> can only be rendered by a layout (src/layout.tsx)')
  return createElement(OUTLET_TAG, null, outlet.page)
}
