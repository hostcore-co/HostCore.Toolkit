// LOCKED FILE — a copy of this in your template is ignored; `hct build`
// always uses this one.
//
// Hydrates the server-rendered HTML in the browser, using the same page
// data the server rendered it with.
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
