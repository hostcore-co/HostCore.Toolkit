// LOCKED FILE — Do not modify. Build pipeline overwrites any
// template-supplied version with this file.
//
// This is the SSR entry called by the engine's worker thread for
// every request. It is bundled into entry.server.cjs which exports
// a single `render(data)` function.
import { renderToString } from 'react-dom/server'
import { HCContext } from '../hooks'
import type { PageData } from '../types'
// @ts-ignore — resolved by Vite alias '@template/App' at build time
import { App } from '@template/App'

/**
 * Called by the engine worker for each SSR request. `data` is a
 * plain JSON object matching PageData and includes store +
 * service_groups, which we lift onto the context for convenience.
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
