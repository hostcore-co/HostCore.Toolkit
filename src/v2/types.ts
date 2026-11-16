import type { ReactNode } from 'react'
import type {
  AnyPageEnvelope,
  ContractPageId,
  PageDataMap,
  PageEnvelope,
} from '../../contract/dist/ts/contract-2026-11'

/** A page a format-2 template can implement: one file in src/pages/ each. */
export type PageId = ContractPageId

/**
 * A page payload with its data present. The rendering engine only renders a
 * page whose payload carries data, so a page component can rely on it.
 */
export type Page<P extends PageId = PageId> = Omit<PageEnvelope<P>, 'data'> & {
  data: PageDataMap[P]
}

/** What the default export of src/pages/<page-id>.tsx receives. */
export interface PageProps<P extends PageId = PageId> {
  /** The whole payload: store, nav, settings, actions, meta and data. */
  page: Page<P>
  /** The page-specific data; the same object as `page.data`. */
  data: PageDataMap[P]
}

/**
 * Which chrome a layout renders. `default` wraps the storefront's own pages;
 * `minimal` wraps the platform's guarded pages, such as checkout, sign-in and
 * sign-up, where a layout should stay out of the way (no large hero, no
 * marketing). The account area is never drawn inside a layout: it takes the
 * template's design tokens only.
 */
export type LayoutVariant = 'default' | 'minimal'

/** What the default export of src/layout.tsx receives. */
export interface LayoutProps {
  /** Where the page goes. Render it exactly once (or render <Outlet/>). */
  children?: ReactNode
  variant: LayoutVariant
}

/**
 * How a page is put together. `document`: the template renders both the
 * layout and the page. `composed`: the layout and the page come from
 * different templates (one of them the platform default).
 */
export type RenderMode = 'document' | 'composed'

/** Facts about the render that are not page data. */
export interface Env {
  /** The build being rendered. */
  build_id: string
  /** Where this build's client files and public/ files are served from. */
  asset_base: string
  /** The store's BCP 47 language tag. */
  locale: string
  /** The store's ISO 4217 currency. */
  currency: string
  mode: RenderMode
}

/** What the page sets as `window.__HC__` for a format-2 template. */
export interface HCGlobalV2 {
  v: 2
  payload: AnyPageEnvelope
  env: Env
  mode: RenderMode
  /** The id of the page being shown. */
  page: string
  /** The layout variant the page was rendered with; `default` when absent. */
  variant?: LayoutVariant
  /** When true, the client entry waits for `mount()` instead of starting itself. */
  defer?: boolean
}
