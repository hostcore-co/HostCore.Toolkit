import { Definitions, t, type Contract } from './dsl'

/**
 * Contract "1": the page data a format-1 template is rendered with.
 *
 * Frozen. It describes exactly what the platform sends to templates written
 * before contract "2026-11", including which keys can be absent and which
 * arrays can be null. Nothing here may be renamed, retyped or removed.
 */

const d = new Definitions()
const { doc, optional } = t

// ─── Store ─────────────────────────────────────────────────────────────────

d.define(
  'StoreBusinessInfo',
  'is the business details a store publishes, for footers and legal pages. Any of them may be empty.',
  t.object({
    address_line1: t.string(),
    address_line2: t.string(),
    city: t.string(),
    state: t.string(),
    country: t.string(),
    postal_code: t.string(),
    business_number: t.string(),
    tax_number: doc('The VAT or GST registration number.', t.string()),
    phone_number: t.string(),
    billing_email: t.string(),
  }),
)

d.define(
  'StoreTheme',
  'is the palette the store has chosen. Every value is a hex colour, and every colour is always set: a store that never chose one gets the platform default.',
  t.object({
    background: doc('The page.', t.string()),
    surface: doc('Cards on the page.', t.string()),
    surface_raised: doc('Inputs and controls on those cards.', t.string()),
    border: t.string(),
    text: t.string(),
    text_muted: t.string(),
    accent: doc('The first stop of the brand gradient.', t.string()),
    accent_strong: doc('The second stop of the brand gradient.', t.string()),
  }),
)

d.define(
  'StorePublicInfo',
  'is the store a page belongs to. Any URL may be empty when the store has not set it.',
  t.object({
    store_name: t.string(),
    website_domain: t.string(),
    logo_url: t.string(),
    favicon_url: t.string(),
    terms_of_service_url: t.string(),
    privacy_policy_url: t.string(),
    root_redirect_url: t.string(),
    login_image_url: doc('Artwork beside the login and forgot-password forms. Empty means the platform image.', t.string()),
    signup_image_url: doc('Artwork above the signup form. Empty means the platform image.', t.string()),
    business_info: t.ref('StoreBusinessInfo'),
    theme: t.ref('StoreTheme'),
  }),
)

// ─── Catalogue ─────────────────────────────────────────────────────────────

d.define(
  'MarketingFeature',
  'is one bullet of store-written marketing copy.',
  t.object({ icon: t.string(), text: t.string() }),
)

d.define(
  'Marketing',
  'is store-authored copy attached to a group or service.',
  t.object({
    title: t.string(),
    description: t.string(),
    features: doc('Never null; empty when the store wrote none.', t.array(t.ref('MarketingFeature'))),
  }),
)

d.define(
  'ServiceGroup',
  'is a group of services, as the navigation and catalogue pages list it.',
  t.object({
    id: t.string(),
    name: t.string(),
    slug: t.string(),
    description: t.string(),
    image: doc('An image URL, or empty.', t.string()),
    marketing: t.ref('Marketing'),
  }),
)

d.define(
  'ServiceType',
  'is what kind of product a service is. Templates use it to pick a layout: a game-server catalogue and a web-hosting price table are different pages. It is the empty string for a service whose store has not set a type.',
  t.enum(['game-server', 'web-hosting', 'dedicated-server', 'vps', 'other', '']),
)

d.define(
  'Service',
  'is one product a store sells, with its plans listed separately.',
  t.object({
    id: t.string(),
    group_id: t.string(),
    name: t.string(),
    slug: t.string(),
    description: doc("The service's marketing description.", t.string()),
    image: doc('An image URL, or empty.', t.string()),
    type: t.ref('ServiceType'),
    marketing: t.ref('Marketing'),
    single_plan: doc(
      'True when the service has exactly one orderable plan. Link it straight to /checkout/{slug} instead of /{group}/{slug}; the rendering engine redirects its service page there anyway.',
      t.boolean(),
    ),
  }),
)

d.define(
  'PriceInterval',
  "is a plan's billing cycle. A plan leads with the shortest cycle it has enabled.",
  t.enum(['month', 'quarter', 'semi_annual', 'year']),
)

d.define(
  'Price',
  'is a price normalised for display.',
  t.object({
    amount: doc('Major units, ready to render.', t.number()),
    currency: doc('An ISO 4217 code.', t.string()),
    interval: t.ref('PriceInterval'),
  }),
)

d.define(
  'ServicePlanPricing',
  'is the price a plan leads with.',
  t.object({
    price: t.ref('Price'),
    original_price: doc('A struck-through earlier price. Absent when there is none.', optional(t.ref('Price'))),
  }),
)

d.define('PaymentType', 'is how a plan is paid for.', t.enum(['free', 'free_trial', 'recurring']))

d.define(
  'OrderFormComponentType',
  'is the kind of input an order form component renders.',
  t.enum(['string', 'checkbox', 'radio', 'slider', 'dropdown', 'location-multi-dropdown']),
)

d.define(
  'OrderFormOption',
  'is one choice on a radio, slider or dropdown component, or inside a location region.',
  t.object({
    label: t.string(),
    value: t.string(),
    price: doc('An add-on price in minor units (cents).', t.integer({ bits: 64 })),
  }),
)

d.define(
  'OrderFormRegion',
  'is a top-level group inside a location-multi-dropdown, such as a country holding its cities.',
  t.object({
    order: t.integer(),
    label: t.string(),
    default: t.boolean(),
    default_value: t.string(),
    children: doc('May be null.', t.nullable(t.array(t.ref('OrderFormOption')))),
  }),
)

d.define(
  'OrderFormComponent',
  'is one field a customer fills in when ordering a plan. Only the keys relevant to its type are present.',
  t.object({
    order: t.integer(),
    type: t.ref('OrderFormComponentType'),
    label: t.string(),
    description: t.string(),
    key: doc('The name the answer is recorded under.', t.string()),
    required: t.boolean(),
    placeholder: doc('Set on string components.', optional(t.string())),
    regex: doc('Set on string components.', optional(t.string())),
    default_value: doc('Set on checkbox components.', optional(t.boolean())),
    price: doc('Set on checkbox components: an add-on price in minor units (cents).', optional(t.integer({ bits: 64 }))),
    children: doc('Set on radio, slider and dropdown components.', optional(t.array(t.ref('OrderFormOption')))),
    dropdown: doc('Set on location-multi-dropdown components.', optional(t.array(t.ref('OrderFormRegion')))),
    preset_id: doc('Set when the component is a copy of a store-wide preset.', optional(t.string())),
  }),
)

d.define(
  'ServiceOrderFormRow',
  'is one component of a plan\'s order form.',
  t.ref('OrderFormComponent'),
)

d.define(
  'ServicePlan',
  'is one way to buy a service.',
  t.object({
    id: t.string(),
    service_id: t.string(),
    name: t.string(),
    slug: t.string(),
    description: t.string(),
    image: doc('An image URL, or empty.', t.string()),
    pricing: t.ref('ServicePlanPricing'),
    trial_days: doc('Days of free trial. Zero unless payment_type is free_trial.', t.integer()),
    payment_type: t.ref('PaymentType'),
    provisioning: doc('How an order is fulfilled: "module" (automatically) or "manual" (by the store\'s staff).', t.string()),
    order_form: doc('May be null when the plan has no order form.', t.nullable(t.array(t.ref('ServiceOrderFormRow')))),
  }),
)

// ─── Editable content ──────────────────────────────────────────────────────

d.define('Cta', 'is a call-to-action link.', t.object({ label: t.string(), href: t.string() }))

d.define(
  'HeroContent',
  'is the copy at the top of the home page.',
  t.object({
    title: t.string(),
    subtitle: t.string(),
    highlights: t.array(t.string()),
    primary_cta: t.ref('Cta'),
    secondary_cta: t.ref('Cta'),
  }),
)

d.define('Section', 'is the heading pair above a block of content.', t.object({ title: t.string(), subtitle: t.string() }))

d.define('FeatureCard', 'is one card in the features block.', t.object({ title: t.string(), description: t.string() }))

d.extend('FeaturesContent', 'is the features block.', 'Section', {
  cards: t.array(t.ref('FeatureCard')),
})

d.define('FaqEntry', 'is one question and its answer.', t.object({ question: t.string(), answer: t.string() }))

d.extend('FaqContent', 'is the FAQ block.', 'Section', {
  items: t.array(t.ref('FaqEntry')),
})

d.define(
  'StoreContent',
  'is the copy a store edits in its admin panel. It is on every page, so a template can render the section headings and FAQ wherever it likes.',
  t.object({
    hero: t.ref('HeroContent'),
    categories: t.ref('Section'),
    features: t.ref('FeaturesContent'),
    faq: t.ref('FaqContent'),
  }),
)

// ─── Domains ───────────────────────────────────────────────────────────────

d.define(
  'DomainTLD',
  'is one extension on the domain pricing table. Prices are for one year in major units; zero means the store does not offer that operation.',
  t.object({
    tld: t.string(),
    featured: t.boolean(),
    register: t.number(),
    transfer: t.number(),
    renew: t.number(),
  }),
)

// ─── Pages ─────────────────────────────────────────────────────────────────

d.define('PageType', 'is which page a payload is for.', t.enum(['home', 'group', 'service', 'domains', 'not-found']))

d.define(
  'PageMeta',
  'is what goes in the document head.',
  t.object({
    title: t.string(),
    description: t.string(),
    og_image: doc('Absent when empty.', t.goName('OGImage', optional(t.string()))),
    no_index: doc('Absent unless true.', optional(t.boolean())),
  }),
)

d.define(
  'BasePageData',
  'is what every page carries: a layout renders the store and its navigation on every route.',
  t.object({
    page_type: t.ref('PageType'),
    meta: t.ref('PageMeta'),
    store: t.ref('StorePublicInfo'),
    service_groups: doc("The store's enabled groups, in display order. Never null.", t.array(t.ref('ServiceGroup'))),
    content: t.ref('StoreContent'),
    domains_enabled: doc(
      'Whether the store sells domains. On every page because the navigation is, so a template never links to a domains page that would 404.',
      t.boolean(),
    ),
  }),
)

d.extend('HomePageData', 'is the payload for "/".', 'BasePageData', { page_type: t.literal('home') })

d.define(
  'GroupPageServiceEntry',
  'pairs a service with the cheapest plan a visitor could buy it on, which is what a catalogue tile shows.',
  t.object({
    service: t.ref('Service'),
    cheapest_plan: doc('The lowest price compared per month, so a yearly plan does not win by being billed less often.', t.ref('ServicePlan')),
  }),
)

d.extend('GroupPageData', 'is the payload for "/{group}".', 'BasePageData', {
  page_type: t.literal('group'),
  group: t.ref('ServiceGroup'),
  services: doc('Services with at least one orderable plan. Never null.', t.array(t.ref('GroupPageServiceEntry'))),
})

d.extend('ServicePageData', 'is the payload for "/{group}/{service}".', 'BasePageData', {
  page_type: t.literal('service'),
  service: t.ref('Service'),
  plans: doc('Every orderable plan. Never null.', t.array(t.ref('ServicePlan'))),
})

d.extend(
  'DomainsPageData',
  'is the payload for "/domains". It exists only when the store sells domains.',
  'BasePageData',
  {
    page_type: t.literal('domains'),
    tlds: doc('Empty when the store sells domains but has added no extensions. Never null.', t.array(t.ref('DomainTLD'))),
    currency: doc('An ISO 4217 code.', t.string()),
  },
)

d.extend('NotFoundPageData', 'is the payload for a path no page matches.', 'BasePageData', {
  page_type: t.literal('not-found'),
})

d.define(
  'PageData',
  'is any page payload, told apart by page_type.',
  t.union('page_type', {
    home: 'HomePageData',
    group: 'GroupPageData',
    service: 'ServicePageData',
    domains: 'DomainsPageData',
    'not-found': 'NotFoundPageData',
  }),
)

export const contract1: Contract = {
  version: '1',
  goPrefix: 'V1',
  definitions: d.list,
  pages: {
    home: 'HomePageData',
    'catalog.group': 'GroupPageData',
    'catalog.service': 'ServicePageData',
    domains: 'DomainsPageData',
    'not-found': 'NotFoundPageData',
  },
}

/** Registry page id → the contract "1" page_type of its payload. */
export const contract1PageTypes = {
  home: 'home',
  'catalog.group': 'group',
  'catalog.service': 'service',
  domains: 'domains',
  'not-found': 'not-found',
} as const
