import { createContext, type ReactNode } from 'react'
import type { AnyPageEnvelope } from '../../contract/dist/ts/contract-2026-11'
import type { SettingValue } from '../../contract/src/settings'
import type { Env } from './types'

export interface PageContextValue {
  payload: AnyPageEnvelope
  env: Env
  /** Declared defaults from template.json, by setting id. */
  defaults: Readonly<Record<string, SettingValue>>
  /** What the layout's <Outlet/> renders: the page. Null outside the layout. */
  outlet: { page: ReactNode } | null
}

export const PageContext = createContext<PageContextValue | null>(null)
