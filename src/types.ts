// The data your template is rendered with.
//
// Every page component receives one of the PageData shapes below, through
// useHC(). This file is the whole contract — if it is not here, it is not
// something a template can read.
//
// It changes on major versions only, because a change here breaks every
// published template.

// ─── Store ─────────────────────────────────────────────────────────────────

export interface StoreBusinessInfo {
  address_line1: string
  address_line2: string
  city: string
  state: string
  country: string
  postal_code: string
  business_number: string
  phone_number: string
  billing_email: string
}

export interface StorePublicInfo {
  store_name: string
  website_domain: string
  logo_url: string
  favicon_url: string
  terms_of_service_url: string
  privacy_policy_url: string
  root_redirect_url: string
  business_info: StoreBusinessInfo
}

// ─── Service catalogue ─────────────────────────────────────────────────────

export interface MarketingFeature {
  icon: string
  text: string
}

/** Store-authored copy attached to a group or service. */
export interface Marketing {
  title: string
  description: string
  features: MarketingFeature[]
}

export interface ServiceGroup {
  id: string
  name: string
  slug: string
  description: string
  image: string
  marketing: Marketing
}

/**
 * What kind of product a service is. Templates use it to pick a layout — a
 * game-server catalogue and a web-hosting price table are different pages.
 */
export type ServiceType =
  | 'game-server'
  | 'web-hosting'
  | 'dedicated-server'
  | 'vps'
  | 'other'

export interface Service {
  id: string
  group_id: string
  name: string
  slug: string
  description: string
  image: string
  type: ServiceType
  marketing: Marketing
}

/**
 * A plan's billing cycle. The platform bills on four cycles and a plan leads
 * with the shortest one it has enabled, so all four are representable.
 */
export type PriceInterval = 'month' | 'quarter' | 'semi_annual' | 'year'

export interface Price {
  /** Major units, ready to render. */
  amount: number
  currency: string
  interval: PriceInterval
}

export interface ServicePlanPricing {
  price: Price
  original_price?: Price
}

export type PaymentType = 'free' | 'free_trial' | 'recurring'

/** One row of a plan's order form. Shapes vary by component type. */
export type ServiceOrderFormRow = Record<string, unknown>

export interface ServicePlan {
  id: string
  service_id: string
  name: string
  slug: string
  description: string
  image: string
  pricing: ServicePlanPricing
  trial_days: number
  payment_type: PaymentType
  order_form: ServiceOrderFormRow[]
}

// ─── Editable content ──────────────────────────────────────────────────────
//
// The copy a store edits in the admin panel. Present on every page, because a
// template renders the section headings and FAQ wherever it likes and a store
// should not have to write the same string twice.

export interface Cta {
  label: string
  href: string
}

export interface HeroContent {
  title: string
  subtitle: string
  highlights: string[]
  primary_cta: Cta
  secondary_cta: Cta
}

/** The heading pair above a block of content. */
export interface Section {
  title: string
  subtitle: string
}

export interface FeatureCard {
  title: string
  description: string
}

export interface FeaturesContent extends Section {
  cards: FeatureCard[]
}

export interface FaqEntry {
  question: string
  answer: string
}

export interface FaqContent extends Section {
  items: FaqEntry[]
}

export interface StoreContent {
  hero: HeroContent
  categories: Section
  features: FeaturesContent
  faq: FaqContent
}

// ─── Domains ───────────────────────────────────────────────────────────────

/** One extension on the storefront pricing table. Prices are for one year. */
export interface DomainTLD {
  tld: string
  featured: boolean
  register: number
  transfer: number
  renew: number
}

// ─── Pages ─────────────────────────────────────────────────────────────────

export type PageType = 'home' | 'group' | 'service' | 'domains' | 'not-found'

export interface PageMeta {
  title: string
  description: string
  og_image?: string
  no_index?: boolean
}

interface BasePageData {
  page_type: PageType
  meta: PageMeta
  store: StorePublicInfo
  service_groups: ServiceGroup[]
  content: StoreContent
  /**
   * Whether this store sells domains. Travels on every page because the
   * navigation renders on every page — a template should not link to a page
   * that will 404.
   */
  domains_enabled: boolean
}

export interface HomePageData extends BasePageData {
  page_type: 'home'
}

export interface GroupPageServiceEntry {
  service: Service
  cheapest_plan: ServicePlan
}

export interface GroupPageData extends BasePageData {
  page_type: 'group'
  group: ServiceGroup
  services: GroupPageServiceEntry[]
}

export interface ServicePageData extends BasePageData {
  page_type: 'service'
  service: Service
  plans: ServicePlan[]
}

/**
 * The /domains page. Reached only when the store sells domains — see
 * `domains_enabled`, which is on every page so navigation can decide
 * whether to link here.
 */
export interface DomainsPageData extends BasePageData {
  page_type: 'domains'
  /** Empty when the store has enabled a registrar but added no extensions. */
  tlds: DomainTLD[]
  currency: string
}

export interface NotFoundPageData extends BasePageData {
  page_type: 'not-found'
}

export type PageData =
  | HomePageData
  | GroupPageData
  | ServicePageData
  | DomainsPageData
  | NotFoundPageData

// ─── Window global ─────────────────────────────────────────────────────────

export interface HCGlobal {
  data: PageData
}

declare global {
  interface Window {
    __HC__: HCGlobal
  }
}
