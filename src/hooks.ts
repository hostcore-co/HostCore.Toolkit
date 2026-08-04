import { useContext, createContext } from 'react'
import type { PageData, ServiceGroup, StorePublicInfo } from './types'

export interface HCContextValue {
  data: PageData
  // Convenience refs into `data` so templates can do `const { store } = useHC()`.
  store: StorePublicInfo
  service_groups: ServiceGroup[]
}

export const HCContext = createContext<HCContextValue | null>(null)

/**
 * Returns the page data plus convenience refs to `store` and
 * `service_groups`. Use this in the root App component or any
 * descendant rendered inside <HCContext.Provider>.
 */
export function useHC<T extends PageData = PageData>(): {
  data: T
  store: StorePublicInfo
  service_groups: ServiceGroup[]
} {
  const ctx = useContext(HCContext)
  if (!ctx) throw new Error('useHC must be used within HCContext.Provider')
  return ctx as {
    data: T
    store: StorePublicInfo
    service_groups: ServiceGroup[]
  }
}

export function useStore(): StorePublicInfo {
  return useHC().store
}

export function useServiceGroups(): ServiceGroup[] {
  return useHC().service_groups
}

export function usePageData<T extends PageData = PageData>(): T {
  return useHC<T>().data
}
