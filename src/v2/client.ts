import { createElement, type ComponentType, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type { SettingValue } from '../../contract/src/settings'
import { PageContext, type OutletState, type PageContextValue } from './context'
import { setCurrentEnv } from './env'
import { ISLAND_TAG } from './island'
import { Outlet, OUTLET_TAG } from './outlet'
import type { Env, HCGlobalV2, LayoutProps, PageProps } from './types'

/**
 * The browser half of bundle protocol 2. The build generates the client
 * entry, which hands `createClient` a loader per page, layout and island so
 * that only the code the current page needs is downloaded.
 *
 * What gets hydrated (`mount()` with no argument picks for you):
 *
 *   document  #hc-root holds this template's layout with its page inside.
 *   layout    #hc-root holds this template's layout; the <hc-outlet> inside
 *             holds a page from elsewhere, which is left untouched.
 *   body      the <hc-outlet> inside #hc-root holds this template's page.
 *             With `options.root`, the page is hydrated into that element
 *             instead (which may sit inside a shadow root), and with
 *             `options.env` it uses that environment in place of
 *             `__HC__.env`. This is how a page rendered by one template is
 *             hydrated inside the layout of another.
 *   islands   only the <hc-island> elements inside #hc-root, each on its own.
 */

export const ROOT_ID = 'hc-root'

export type MountPart = 'document' | 'layout' | 'body' | 'islands'

type Loader<P> = () => Promise<{ default?: ComponentType<P> }>

export interface ClientDefinition {
  layout: Loader<LayoutProps> | null
  pages: Record<string, Loader<PageProps>>
  islands: Record<string, Loader<Record<string, unknown>>>
  /** Pages that set `export const hydrate = "islands"`. */
  islandPages: readonly string[]
  defaults: Record<string, SettingValue>
}

/** Where and with what environment `mount("body", options)` hydrates. */
export interface MountOptions {
  /** The element holding the page's server-rendered markup. Default: the first <hc-outlet> in #hc-root. */
  root?: Element
  /** The environment the page was rendered with. Default: `__HC__.env`. */
  env?: Env
}

export interface Client {
  mount(part?: MountPart, options?: MountOptions): Promise<void>
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

function isEnv(value: unknown): value is Env {
  return typeof value === 'object' && value !== null && typeof (value as { asset_base?: unknown }).asset_base === 'string'
}

export function createClient(def: ClientDefinition): Client {
  let mounted = false
  /** Elements hydrated through `options.root`, so none is hydrated twice. */
  const hydratedRoots = new WeakSet<Element>()

  async function mount(part?: MountPart, options?: MountOptions): Promise<void> {
    const g = readGlobal()
    if (!g) {
      console.error('hostcore: window.__HC__ is missing or not version 2; nothing to hydrate')
      return
    }
    if (options !== undefined && options !== null) {
      if (part !== 'body') {
        console.error(`hostcore: mount options are only for mount("body", …), not ${JSON.stringify(part ?? '(no part)')}`)
        return
      }
      if (options.env !== undefined && !isEnv(options.env)) {
        console.error('hostcore: mount("body") was given an env without an asset_base string')
        return
      }
      if (options.root !== undefined && !(typeof options.root === 'object' && options.root !== null && 'querySelector' in options.root)) {
        console.error('hostcore: mount("body") was given a root that is not an element')
        return
      }
    }
    const ownRoot = options?.root
    if (ownRoot) {
      if (hydratedRoots.has(ownRoot)) {
        console.error('hostcore: that element has already been hydrated')
        return
      }
      hydratedRoots.add(ownRoot)
    } else {
      if (mounted) return
      mounted = true
    }

    const root = document.getElementById(ROOT_ID)
    if (!root && !ownRoot) {
      console.error(`hostcore: #${ROOT_ID} not found; nothing to hydrate`)
      return
    }
    const env = options?.env ?? g.env
    setCurrentEnv(env)

    const chosen: MountPart =
      part ?? (g.mode === 'composed' ? 'layout' : def.islandPages.includes(g.page) ? 'islands' : 'document')

    const context = (outlet: OutletState | null): PageContextValue => ({
      payload: g.payload,
      env,
      defaults: def.defaults,
      outlet,
    })
    const provide = (outlet: OutletState | null, children: ReactNode) =>
      createElement(PageContext.Provider, { value: context(outlet) }, children)

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
          root!,
          provide(
            { kind: 'page', page: createElement(Page, { page, data: page.data }) },
            createElement(Layout, { variant, children: createElement(Outlet) }),
          ),
        )
        return
      }
      case 'layout': {
        if (!def.layout) {
          console.error('hostcore: this template has no layout to hydrate')
          return
        }
        const outlet = root!.querySelector(OUTLET_TAG)
        const html = outlet ? outlet.innerHTML : ''
        const Layout = await component(def.layout, 'src/layout')
        hydrateRoot(
          root!,
          provide({ kind: 'preserve', html }, createElement(Layout, { variant, children: createElement(Outlet) })),
        )
        return
      }
      case 'body': {
        const target = ownRoot ?? root!.querySelector(OUTLET_TAG)
        if (!pageLoader || !target) {
          console.error(`hostcore: nothing to hydrate for page "${g.page}"`)
          return
        }
        const Page = await component(pageLoader, `src/pages/${g.page}`)
        hydrateRoot(target, provide(null, createElement(Page, { page, data: page.data })))
        return
      }
      case 'islands': {
        const elements = Array.from(root!.querySelectorAll<HTMLElement>(ISLAND_TAG)).filter(
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
