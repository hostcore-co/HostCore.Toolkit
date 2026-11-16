import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import type { AnyPageEnvelope } from '../../contract/dist/ts/contract-2026-11'
import { SLOTS } from '../../contract/dist/ts/registry'
import type { SettingValue } from '../../contract/src/settings'
import { PageContext, type OutletState, type PageContextValue } from './context'
import { setCurrentEnv } from './env'
import { Outlet, OUTLET_TAG } from './outlet'
import type { Env, LayoutProps, LayoutVariant, PageProps } from './types'

/**
 * The server half of bundle protocol 2. The build generates the bundle's
 * entry, which imports your layout and pages and hands them to
 * `createServer`; everything below is the same for every template.
 */

/** The order page ids are listed in, matching the page registry. */
export const PAGE_ORDER = ['home', 'domains', 'catalog.group', 'catalog.service', 'not-found'] as const

export const LAYOUT_VARIANTS: readonly LayoutVariant[] = ['default', 'minimal']

export const RENDER_KINDS = ['document', 'layout', 'body', 'slot'] as const
export type RenderKind = (typeof RENDER_KINDS)[number]

export interface ComponentModule<P> {
  default?: ComponentType<P>
}

export interface ServerDefinition {
  layout: ComponentModule<LayoutProps> | null
  pages: Record<string, ComponentModule<PageProps>>
  /** The template's slots, by slot id. */
  slots?: Record<string, ComponentModule<Record<string, never>>>
  defaults: Record<string, SettingValue>
}

/**
 * A render request. For kind `slot`, `slot` is the slot id and `page` is
 * the page the slot is on; the payload's page data and actions are not
 * given to the slot.
 */
export interface RenderInput {
  kind: RenderKind
  page: string
  slot: string
  variant: LayoutVariant
  payload: AnyPageEnvelope
  env: Env
}

export interface ServerBundle {
  pages: string[]
  layouts: string[]
  /** The slots the template fills, in registry order. */
  slots: string[]
  render(inputJson: string): string
}

/**
 * Every error `render` throws starts with one of these codes, so the engine
 * can tell "the template does not have this" from "the template broke".
 *
 *   HC_BAD_INPUT              the input is not a valid render request
 *   HC_PAGE_NOT_IMPLEMENTED   the template has no file for this page
 *   HC_LAYOUT_NOT_IMPLEMENTED the template has no layout
 *   HC_LAYOUT_OUTLET          the layout did not render its outlet exactly once
 *   HC_ISLAND / HC_ISLAND_PROPS  an island was misused (see island())
 *   HC_SLOT_NOT_IMPLEMENTED   the template has no file for this slot
 *   HC_SLOT_SCRIPT            a slot rendered an island or a script
 *   HC_RENDER_FAILED          a component threw
 */
function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(inputJson: string): RenderInput {
  if (typeof inputJson !== 'string') fail('HC_BAD_INPUT', 'render() takes the request as a JSON string')
  let raw: unknown
  try {
    raw = JSON.parse(inputJson)
  } catch (e) {
    fail('HC_BAD_INPUT', `the request is not JSON: ${(e as Error).message}`)
  }
  if (!isRecord(raw)) fail('HC_BAD_INPUT', 'the request must be a JSON object')
  const kind = raw.kind
  if (typeof kind !== 'string' || !(RENDER_KINDS as readonly string[]).includes(kind)) {
    fail('HC_BAD_INPUT', `kind must be one of ${RENDER_KINDS.join(', ')}, got ${JSON.stringify(kind)}`)
  }
  let page = raw.page
  let slot = ''
  if (kind === 'slot') {
    if (typeof raw.slot !== 'string' || raw.slot === '') fail('HC_BAD_INPUT', 'slot must be a slot id')
    const known = SLOTS.find((s) => s.id === raw.slot)
    if (!known) fail('HC_SLOT_NOT_IMPLEMENTED', `"${raw.slot}" is not a slot (slots: ${SLOTS.map((s) => s.id).join(', ')})`)
    slot = raw.slot
    page = known.page
  } else if (typeof page !== 'string' || page === '') fail('HC_BAD_INPUT', 'page must be a page id')
  const variant = raw.variant ?? 'default'
  if (typeof variant !== 'string' || !LAYOUT_VARIANTS.includes(variant as LayoutVariant)) {
    fail('HC_BAD_INPUT', `variant must be one of ${LAYOUT_VARIANTS.join(', ')}, got ${JSON.stringify(variant)}`)
  }
  const payload = raw.payload
  if (!isRecord(payload) || !isRecord(payload.store) || !isRecord(payload.nav) || !isRecord(payload.page)) {
    fail('HC_BAD_INPUT', 'payload must be a page envelope')
  }
  if (!isRecord(payload.settings)) payload.settings = {}
  if (!isRecord(payload.actions)) payload.actions = {}
  const env = raw.env
  if (!isRecord(env) || typeof env.asset_base !== 'string') fail('HC_BAD_INPUT', 'env must be an object with asset_base')
  return {
    kind: kind as RenderKind,
    page: page as string,
    slot,
    variant: variant as LayoutVariant,
    payload: payload as unknown as AnyPageEnvelope,
    env: env as unknown as Env,
  }
}

function countOutlets(html: string): number {
  return html.split(`<${OUTLET_TAG}`).length - 1
}

export function createServer(def: ServerDefinition): ServerBundle {
  const pages = PAGE_ORDER.filter((id) => def.pages[id] !== undefined)
  const layouts = def.layout ? [...LAYOUT_VARIANTS] : []
  const slots = SLOTS.map((s) => s.id as string).filter((id) => def.slots?.[id] !== undefined)

  function pageComponent(id: string): ComponentType<PageProps> {
    const mod = def.pages[id]
    if (!mod) {
      fail(
        'HC_PAGE_NOT_IMPLEMENTED',
        `this template does not implement page "${id}" (it implements: ${pages.join(', ') || 'no pages'})`,
      )
    }
    if (typeof mod.default !== 'function' && typeof mod.default !== 'object') {
      fail('HC_PAGE_NOT_IMPLEMENTED', `src/pages/${id} has no default export`)
    }
    return mod.default as ComponentType<PageProps>
  }

  function layoutComponent(): ComponentType<LayoutProps> {
    if (!def.layout?.default) fail('HC_LAYOUT_NOT_IMPLEMENTED', 'this template has no layout (src/layout.tsx)')
    return def.layout.default
  }

  function pageElement(input: RenderInput): ReactNode {
    const Page = pageComponent(input.page)
    if (input.payload.page.id !== input.page) {
      fail('HC_BAD_INPUT', `page is "${input.page}" but the payload is for "${input.payload.page.id}"`)
    }
    if (input.payload.data === undefined || input.payload.data === null) {
      fail('HC_BAD_INPUT', `the payload for page "${input.page}" carries no data`)
    }
    const page = input.payload as unknown as PageProps['page']
    return createElement(Page, { page, data: page.data })
  }

  function slotTree(input: RenderInput): ReactNode {
    const mod = def.slots?.[input.slot]
    if (!mod) {
      fail('HC_SLOT_NOT_IMPLEMENTED', `this template does not fill slot "${input.slot}" (it fills: ${slots.join(', ') || 'no slots'})`)
    }
    if (typeof mod.default !== 'function' && typeof mod.default !== 'object') {
      fail('HC_SLOT_NOT_IMPLEMENTED', `src/slots/${input.slot} has no default export`)
    }
    // A slot sees the store, the settings and the navigation, and nothing of the page it is on.
    const { data: _data, ...rest } = input.payload as unknown as Record<string, unknown>
    const payload = { ...rest, page: { id: input.page, params: {} }, redirect: null, actions: {} } as unknown as AnyPageEnvelope
    const value: PageContextValue = { payload, env: input.env, defaults: def.defaults, outlet: null, slot: input.slot }
    return createElement(PageContext.Provider, { value }, createElement(mod.default as ComponentType))
  }

  function tree(input: RenderInput): ReactNode {
    if (input.kind === 'slot') return slotTree(input)
    let outlet: OutletState | null = null
    let content: ReactNode
    if (input.kind === 'body') {
      content = pageElement(input)
    } else {
      const Layout = layoutComponent()
      outlet = input.kind === 'document' ? { kind: 'page', page: pageElement(input) } : { kind: 'marker' }
      content = createElement(Layout, { variant: input.variant, children: createElement(Outlet) })
    }
    const value: PageContextValue = { payload: input.payload, env: input.env, defaults: def.defaults, outlet }
    return createElement(PageContext.Provider, { value }, content)
  }

  function render(inputJson: string): string {
    const input = parseInput(inputJson)
    const element = tree(input)
    const previous = setCurrentEnv(input.env)
    let html: string
    try {
      html = renderToString(element)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/^HC_[A-Z_]+: /.test(message)) throw e
      fail('HC_RENDER_FAILED', input.kind === 'slot' ? `slot "${input.slot}": ${message}` : `${input.kind} of page "${input.page}": ${message}`)
    } finally {
      setCurrentEnv(previous)
    }
    if (input.kind === 'slot') {
      if (/<script\b/i.test(html)) fail('HC_SLOT_SCRIPT', `slot "${input.slot}" renders a script, and a slot is shown with no script`)
      return JSON.stringify({ html })
    }
    if (input.kind !== 'body') {
      const outlets = countOutlets(html)
      if (outlets !== 1) {
        fail(
          'HC_LAYOUT_OUTLET',
          `the layout must render its children (or <Outlet/>) exactly once; it rendered them ${outlets} times`,
        )
      }
    }
    return JSON.stringify({ html })
  }

  return { pages, layouts, slots, render }
}
