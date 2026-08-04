// LOCKED FILE — a copy of this in your template is ignored; `hct build`
// always uses this one.
//
// The server-side entry point. Your App is rendered through it once per
// request, and the result is the HTML a visitor receives.
import { renderToString } from 'react-dom/server'
import { HCContext } from '../hooks'
import type { PageData } from '../types'
// @ts-ignore — resolved by Vite alias '@template/App' at build time
import { App } from '@template/App'

/**
 * Renders one page. `data` is plain JSON matching PageData; `store` and
 * `service_groups` are lifted onto the context so useStore() and
 * useServiceGroups() can reach them without digging through `data`.
 */
export function render(data: PageData): string {
  return renderToString(
    <HCContext.Provider
      value={{
        data,
        store: data.store,
        service_groups: data.service_groups,
      }}
    >
      <App />
    </HCContext.Provider>,
  )
}
