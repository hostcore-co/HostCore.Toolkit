import { createElement, type ComponentType, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type { SettingValue } from '../../contract/src/settings'
import { PageContext, type PageContextValue } from './context'
import { setCurrentEnv } from './env'
import { ISLAND_TAG } from './island'
import { Outlet } from './outlet'
import type { HCGlobalV2, LayoutProps, PageProps } from './types'

/**
 * The browser half of bundle protocol 2. The build generates the client
 * entry, which hands `createClient` a loader per page, layout and island so
 * that only the code the current page needs is downloaded.
 *
 * What gets hydrated (`mount()` with no argument picks for you):
 *
 *   document  #hc-root holds this template's layout with its page inside.
 *   islands   only the <hc-island> elements inside #hc-root, each on its own.
 */

export const ROOT_ID = 'hc-root'

export type MountPart = 'document' | 'islands'

type Loader<P> = () => Promise<{ default?: ComponentType<P> }>

export interface ClientDefinition {
  layout: Loader<LayoutProps> | null
  pages: Record<string, Loader<PageProps>>
  islands: Record<string, Loader<Record<string, unknown>>>
  /** Pages that set `export const hydrate = "islands"`. */
  islandPages: readonly string[]
  defaults: Record<string, SettingValue>
}

export interface Client {
  mount(part?: MountPart): Promise<void>
}

function readGlobal(): HCGlobalV2 | null {
  const g = (globalThis as { __HC__?: unknown }).__HC__
  if (typeof g !== 'object' || g === null || (g as { v?: unknown }).v !== 2) return null
  return g as HCGlobalV2
}

async function component<P>(loader: Loader<P>, what: string): Promise<ComponentType<P>> {
  const mod = await loader()
  if (!mod.default) throw new Error(`${what} has no default export`)
  return mod.default
}

export function createClient(def: ClientDefinition): Client {
  let mounted = false

  async function mount(part?: MountPart): Promise<void> {
    const g = readGlobal()
    if (!g) {
      console.error('hostcore: window.__HC__ is missing or not version 2; nothing to hydrate')
      return
    }
    if (mounted) return
    mounted = true

    const root = document.getElementById(ROOT_ID)
    if (!root) {
      console.error(`hostcore: #${ROOT_ID} not found; nothing to hydrate`)
      return
    }
    setCurrentEnv(g.env)

    const chosen: MountPart = part ?? (def.islandPages.includes(g.page) ? 'islands' : 'document')

    const provide = (outlet: PageContextValue['outlet'], children: ReactNode) =>
      createElement(PageContext.Provider, { value: { payload: g.payload, env: g.env, defaults: def.defaults, outlet } }, children)

    const pageLoader = def.pages[g.page]
    const page = g.payload as unknown as PageProps['page']
    const variant = g.variant ?? 'default'

    switch (chosen) {
      case 'document': {
        if (!def.layout || !pageLoader) {
          console.error(`hostcore: this template does not implement both the layout and page "${g.page}"`)
          return
        }
        const [Layout, Page] = await Promise.all([
          component(def.layout, 'src/layout'),
          component(pageLoader, `src/pages/${g.page}`),
        ])
        hydrateRoot(
          root,
          provide({ page: createElement(Page, { page, data: page.data }) }, createElement(Layout, { variant, children: createElement(Outlet) })),
        )
        return
      }
      case 'islands': {
        const elements = Array.from(root.querySelectorAll<HTMLElement>(ISLAND_TAG)).filter(
          // An island inside another island is hydrated as part of it.
          (el) => !el.parentElement?.closest(ISLAND_TAG),
        )
        await Promise.all(
          elements.map(async (el) => {
            const name = el.dataset.name ?? ''
            const loader = def.islands[name]
            if (!loader) {
              console.error(`hostcore: no island named "${name}" in this template`)
              return
            }
            let props: Record<string, unknown>
            try {
              props = JSON.parse(el.dataset.props ?? '{}') as Record<string, unknown>
            } catch {
              console.error(`hostcore: island "${name}" has unreadable props`)
              return
            }
            const Island = await component(loader, `src/islands/${name}`)
            hydrateRoot(el, provide(null, createElement(Island, props)))
          }),
        )
        return
      }
    }
  }

  return { mount }
}
