// LOCKED FILE — Do not modify.
//
// Hydrates the SSR'd HTML on the client using the data injected
// into window.__HC__ by the engine's HTML shell.
import { hydrateRoot } from 'react-dom/client'
import { HCContext } from '../hooks'
// @ts-ignore — resolved by Vite alias '@template/App' at build time
import { App } from '@template/App'

const { data } = window.__HC__
const root = document.getElementById('root')
if (!root) throw new Error('Hydration target #root not found')

hydrateRoot(
  root,
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
