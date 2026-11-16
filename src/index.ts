// Format 1: one App switching on page_type, reading contract "1" data.
export {
  HCContext,
  useHC,
  useServiceGroups,
  usePageData,
} from './hooks'
export type { HCContextValue } from './hooks'
export { Link } from './components/Link'
export type {
  // Store
  StoreBusinessInfo,
  StoreTheme,
  StorePublicInfo,
  // Catalogue
  Marketing,
  MarketingFeature,
  ServiceGroup,
  ServiceType,
  // Editable content
  Cta,
  HeroContent,
  Section,
  FeatureCard,
  FeaturesContent,
  FaqEntry,
  FaqContent,
  StoreContent,
  // Domains
  DomainTLD,
  OrderFormComponentType,
  OrderFormOption,
  OrderFormRegion,
  OrderFormComponent,
  ServiceOrderFormRow,
  ServicePlanPricing,
  PaymentType,
  Price,
  PriceInterval,
  Service,
  ServicePlan,
  // Pages
  PageType,
  PageMeta,
  PageData,
  BasePageData,
  HomePageData,
  GroupPageData,
  GroupPageServiceEntry,
  ServicePageData,
  DomainsPageData,
  NotFoundPageData,
  // Window global
  HCGlobal,
} from './types'

// Shared by both formats. useStore() returns the store of whichever format
// is rendering: the 2026-11 Store in a format-2 template, StorePublicInfo in a
// format-1 one (type that as useStore<StorePublicInfo>()).
export { useStore } from './v2/hooks'

// Format 2: a layout and one file per page, reading a 2026-11 page envelope.
export { usePage, useNav, useSetting, useAction, useEnv } from './v2/hooks'
export type { StandardSettingValues } from './v2/hooks'
export { Outlet } from './v2/outlet'
export { island } from './v2/island'
export { asset } from './v2/env'
export { actionHref } from './v2/action'
export type { ActionFor, ActionParams, ActionQuery, ActionWithParams, DomainCheckoutParams } from './v2/action'
export {
  formatMoney,
  formatPrice,
  formatInterval,
  formatPricePerInterval,
  useMoney,
} from './v2/format'
export type { IntervalStyle } from './v2/format'
export type {
  Env,
  HCGlobalV2,
  LayoutProps,
  LayoutVariant,
  Page,
  PageId,
  PageProps,
  RenderMode,
} from './v2/types'
export type { SettingLink, SettingValue } from '../contract/src/settings'

// The 2026-11 contract. Names that also exist in contract "1" (Price,
// Service, Marketing, …) are only under the Contract namespace:
// `import type { Contract } from '@hostcore/toolkit'` then `Contract.Plan`.
export type * as Contract from '../contract/dist/ts/contract-2026-11'
export type {
  Action,
  Actions,
  AnyPageEnvelope,
  CatalogGroupData,
  CatalogServiceData,
  ContractPageId,
  DomainTld,
  DomainsData,
  Group,
  HomeData,
  Nav,
  NavLinks,
  NotFoundData,
  PageDataMap,
  PageEnvelope,
  Plan,
  ServiceCard,
  Store,
} from '../contract/dist/ts/contract-2026-11'
