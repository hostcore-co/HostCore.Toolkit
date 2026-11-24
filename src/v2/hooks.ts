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
import type { ActionFor } from './action'
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
 * `actions` and `data`.
 *
 * Name the page for typed data: `usePage('catalog.service').data.plans`.
 * This is how a shared component reads a page's data, and it throws when
 * the current page is a different one, or carries no data, so a component
 * used on the wrong page fails with an error that says so instead of
 * reading fields that are not there. `usePage<'catalog.service'>()` gives
 * the same type with no check.
 *
 * Without a page id, `data` is typed as any page's data. In a layout, the
 * page may be one the platform renders itself (checkout, login), whose
 * payload carries no data.
 */
export function usePage<P extends ContractPageId>(id: P): Page<P>
export function usePage<P extends ContractPageId = ContractPageId>(): Page<P>
export function usePage(id?: ContractPageId): Page {
  const payload = usePageContext('usePage').payload
  if (id !== undefined) {
    if (payload.page.id !== id) {
      throw new Error(`usePage(${JSON.stringify(id)}) was called on page ${JSON.stringify(payload.page.id)}: a component that names a page may only be used on that page`)
    }
    if (payload.data === undefined || payload.data === null) {
      throw new Error(`usePage(${JSON.stringify(id)}): this render of ${JSON.stringify(id)} carries no data (the layout rendered on its own, or a redirect); read the page's data only inside the page`)
    }
  }
  return payload as unknown as Page
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
 * An action the page may use from the browser, `{ method, url }`: an
 * endpoint to call, such as `domain_search`, or a page to send a visitor to,
 * such as `domain_checkout`, whose href actionHref() builds. `undefined`
 * when the store does not offer it.
 */
export function useAction<K extends keyof Actions>(name: K): ActionFor<K> {
  return usePageContext('useAction').payload.actions[name] as ActionFor<K>
}

/** The build id, where its files are served from, the locale, currency and render mode. */
export function useEnv(): Env {
  return usePageContext('useEnv').env
}
