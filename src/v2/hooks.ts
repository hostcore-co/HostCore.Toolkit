import { useContext } from 'react'
import type {
  Actions,
  ContractPageId,
  Nav,
  Store,
} from '../../contract/dist/ts/contract-2026-11'
import type { SettingLink, SettingValue } from '../../contract/src/settings'
import { HCContext } from '../hooks'
import type { StorePublicInfo } from '../types'
import { PageContext, type PageContextValue } from './context'
import type { Env, Page } from './types'

function usePageContext(hook: string): PageContextValue {
  const ctx = useContext(PageContext)
  if (!ctx) {
    throw new Error(
      `${hook}() needs a format-2 template: it only works inside a page, layout or island the platform renders`,
    )
  }
  return ctx
}

/**
 * The page payload: `page.id`, `meta`, `store`, `nav`, `settings`,
 * `actions` and `data`. Pass the page id for typed data:
 * `usePage<'catalog.service'>().data.plans`.
 *
 * In a layout, the page may be one the platform renders itself (checkout,
 * login), whose payload carries no data.
 */
export function usePage<P extends ContractPageId = ContractPageId>(): Page<P> {
  return usePageContext('usePage').payload as unknown as Page<P>
}

/**
 * The store: name, domain, logo, locale, currency, business details, theme.
 *
 * Format-1 templates keep getting the contract "1" store from it; type that
 * use as `useStore<StorePublicInfo>()`.
 */
export function useStore<S extends Store | StorePublicInfo = Store>(): S {
  const page = useContext(PageContext)
  const legacy = useContext(HCContext)
  if (page) return page.payload.store as S
  if (legacy) return legacy.store as S
  throw new Error('useStore() must be used inside a page, layout or island the platform renders')
}

/** The store's groups and every platform link a layout needs. */
export function useNav(): Nav {
  return usePageContext('useNav').payload.nav
}

/** The value types of the standard settings, by id. */
export interface StandardSettingValues {
  'hero.title': string
  'hero.subtitle': string
  'hero.highlights': string[]
  'hero.primary_cta': SettingLink
  'hero.secondary_cta': SettingLink
  'categories.title': string
  'categories.subtitle': string
  'features.title': string
  'features.subtitle': string
  'features.cards': Array<{ title: string; description: string }>
  'faq.title': string
  'faq.subtitle': string
  'faq.items': Array<{ question: string; answer: string }>
}

/**
 * The store's value for one of your settings, or the default you declared
 * for it in template.json when the store has not set it. `undefined` only for
 * an id with neither.
 */
export function useSetting<K extends keyof StandardSettingValues>(id: K): StandardSettingValues[K]
export function useSetting<T extends SettingValue = SettingValue>(id: string): T
export function useSetting(id: string): SettingValue | undefined {
  const ctx = usePageContext('useSetting')
  const settings = ctx.payload.settings as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(settings, id) && settings[id] !== undefined && settings[id] !== null) {
    return settings[id] as SettingValue
  }
  return Object.prototype.hasOwnProperty.call(ctx.defaults, id) ? ctx.defaults[id] : undefined
}

/**
 * An endpoint the page may call from the browser, such as `domain_search`:
 * `{ method, url }`. `undefined` when the store does not offer it.
 */
export function useAction<K extends keyof Actions>(name: K): Actions[K] {
  return usePageContext('useAction').payload.actions[name]
}

/** The build id, where its files are served from, the locale, currency and render mode. */
export function useEnv(): Env {
  return usePageContext('useEnv').env
}
