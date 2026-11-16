import { createContext, type ReactNode } from 'react'
import type { AnyPageEnvelope } from '../../contract/dist/ts/contract-2026-11'
import type { SettingValue } from '../../contract/src/settings'
import type { Env } from './types'

/**
 * What <Outlet/> renders. On the server: the page, or an empty marker the
 * rendering engine fills in. In the browser, when the page inside the layout
 * came from somewhere else: the markup already there, left untouched.
 */
export type OutletState =
  | { kind: 'page'; page: ReactNode }
  | { kind: 'marker' }
  | { kind: 'preserve'; html: string }

export interface PageContextValue {
  payload: AnyPageEnvelope
  env: Env
  /** Declared defaults from template.json, by setting id. */
  defaults: Readonly<Record<string, SettingValue>>
  outlet: OutletState | null
  /** The slot being rendered, when this render is one. */
  slot?: string
}

export const PageContext = createContext<PageContextValue | null>(null)
