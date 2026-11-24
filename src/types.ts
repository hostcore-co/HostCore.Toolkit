// The data your template is rendered with.
//
// Every page component receives one of the PageData shapes below, through
// useHC(). They are contract "1", generated from the toolkit's contract
// definitions (contract/src), which is also what the platform's own copy is
// generated from — so what you type against is what you are sent.
//
// Contract "1" is frozen: nothing in it is ever renamed, retyped or removed.

import type { PageData } from '../contract/dist/ts/contract-1'

export type {
  // Store
  StoreBusinessInfo,
  StoreTheme,
  StorePublicInfo,
  // Catalogue
  MarketingFeature,
  Marketing,
  ServiceGroup,
  ServiceType,
  Service,
  PriceInterval,
  Price,
  ServicePlanPricing,
  PaymentType,
  OrderFormComponentType,
  OrderFormOption,
  OrderFormRegion,
  OrderFormComponent,
  ServiceOrderFormRow,
  ServicePlan,
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
  // Pages
  PageType,
  PageMeta,
  BasePageData,
  HomePageData,
  GroupPageServiceEntry,
  GroupPageData,
  ServicePageData,
  DomainsPageData,
  NotFoundPageData,
  PageData,
} from '../contract/dist/ts/contract-1'

// ─── Window global ─────────────────────────────────────────────────────────

export interface HCGlobal {
  data: PageData
}

declare global {
  interface Window {
    __HC__: HCGlobal
  }
}
