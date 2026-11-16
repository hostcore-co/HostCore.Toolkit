import { Definitions, t, type Contract } from './dsl'

/**
 * Contract "2026-11": every page response is a PageEnvelope.
 *
 * The envelope carries what every page needs (the store, its navigation,
 * its settings and the actions a page may call) and a `data` object whose
 * shape depends on the page id.
 *
 * Templates never build platform URLs: every link target is in the payload.
 */

const d = new Definitions()
const { doc, optional } = t

d.define('ContractVersion', 'is the version string of this contract.', t.literal('2026-11'))

// ─── Store ─────────────────────────────────────────────────────────────────

d.define(
  'StoreBusiness',
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
  "is the store's eight colours. Every value is a hex colour and is always set. The rendering engine writes them to the color.* design tokens.",
  t.object({
    background: t.string(),
    surface: t.string(),
    surface_raised: t.string(),
    border: t.string(),
    text: t.string(),
    text_muted: t.string(),
    accent: t.string(),
    accent_strong: t.string(),
  }),
)

d.define(
  'Store',
  'is the store a page belongs to. Any URL may be empty when the store has not set it.',
  t.object({
    name: t.string(),
    domain: doc('The domain the store is served on.', t.string()),
    logo_url: t.string(),
    favicon_url: t.string(),
    locale: doc('A BCP 47 language tag such as "en".', t.string()),
    currency: doc('The ISO 4217 code every catalogue price is in.', t.string()),
    business: t.ref('StoreBusiness'),
    theme: t.ref('StoreTheme'),
    root_redirect_url: doc('Where the store sends visitors from its root when it runs its own front end. Usually empty.', t.string()),
    login_image_url: doc('Artwork beside the login form. Empty means the platform image.', t.string()),
    signup_image_url: doc('Artwork above the signup form. Empty means the platform image.', t.string()),
  }),
)

// ─── Catalogue ─────────────────────────────────────────────────────────────

d.define('MarketingFeature', 'is one bullet of store-written marketing copy.', t.object({ icon: t.string(), text: t.string() }))

d.define(
  'Marketing',
  'is store-authored copy attached to a group or service.',
  t.object({
    title: t.string(),
    description: t.string(),
    features: t.array(t.ref('MarketingFeature')),
  }),
)

d.define(
  'Group',
  'is a group of services.',
  t.object({
    id: t.string(),
    name: t.string(),
    slug: t.string(),
    url: doc("The group's catalogue page.", t.goName('URL', t.string())),
    description: t.string(),
    image: doc('An image URL, or empty.', t.string()),
    marketing: t.ref('Marketing'),
  }),
)

d.define(
  'ServiceType',
  'is what kind of product a service is. It is an open set: render something sensible for a value you do not recognise. It is the empty string for a service whose store has not set a type. Contracts that predate a value receive "other" in its place.',
  t.openEnum(['game-server', 'web-hosting', 'dedicated-server', 'vps', 'other'], 'other'),
)

d.define(
  'Service',
  'is one product a store sells.',
  t.object({
    id: t.string(),
    group_id: t.string(),
    name: t.string(),
    slug: t.string(),
    url: doc('Where a card for this service links: its plan listing, or checkout when single_plan is true.', t.string()),
    description: t.string(),
    image: doc('An image URL, or empty.', t.string()),
    type: t.ref('ServiceType'),
    marketing: t.ref('Marketing'),
    single_plan: doc('True when the service has exactly one orderable plan, so it has no plan listing.', t.boolean()),
  }),
)

d.define('PriceInterval', "is a plan's billing cycle.", t.enum(['month', 'quarter', 'semi_annual', 'year']))

d.define(
  'Price',
  'is a price for one billing cycle.',
  t.object({
    amount: doc('Major units, ready to render.', t.number()),
    amount_minor: doc('The same amount in minor units (cents), for arithmetic.', t.integer({ bits: 64 })),
    currency: doc('An ISO 4217 code.', t.string()),
    interval: t.ref('PriceInterval'),
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
    children: t.array(t.ref('OrderFormOption')),
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
  'Plan',
  'is one way to buy a service.',
  t.object({
    id: t.string(),
    service_id: t.string(),
    name: t.string(),
    slug: t.string(),
    description: t.string(),
    image: doc('An image URL, or empty.', t.string()),
    checkout_url: doc('Where ordering this plan starts.', t.goName('CheckoutURL', t.string())),
    price: doc('The price of the shortest billing cycle the plan has enabled.', t.ref('Price')),
    original_price: doc('A struck-through earlier price, or null.', t.nullable(t.ref('Price'))),
    trial_days: doc('Days of free trial. Zero unless payment_type is free_trial.', t.integer()),
    payment_type: t.ref('PaymentType'),
    provisioning: doc('How an order is fulfilled: "module" (automatically) or "manual" (by the store\'s staff).', t.string()),
    order_form: doc('Never null; empty when the plan asks nothing.', t.array(t.ref('OrderFormComponent'))),
  }),
)

d.define(
  'ServiceCard',
  'is what a catalogue tile shows: a service and the plan it is advertised from.',
  t.object({
    service: t.ref('Service'),
    from: doc('The cheapest plan, compared per month so a yearly plan does not win by being billed less often.', t.ref('Plan')),
  }),
)

d.define(
  'DomainTld',
  'is one extension on the domain pricing table. Prices are for one year in major units; zero means the store does not offer that operation.',
  t.object({
    tld: t.goName('TLD', t.string()),
    featured: t.boolean(),
    register: t.number(),
    transfer: t.number(),
    renew: t.number(),
  }),
)

// ─── Envelope ──────────────────────────────────────────────────────────────

d.define(
  'PageRef',
  'is the page a response is for, with the path parameters it was matched with.',
  t.object({
    id: t.goName('ID', t.pageId()),
    params: doc('Path parameters by name, such as {"group": "games"}. Empty for a page without any.', t.record(t.string())),
  }),
)

d.define(
  'Redirect',
  'tells the rendering engine to answer with a redirect instead of rendering the page.',
  t.object({
    location: t.string(),
    status: doc('One of 301, 302, 307 or 308.', t.integer()),
  }),
)

d.define(
  'PageMeta',
  'is what goes in the document head.',
  t.object({
    title: t.string(),
    description: t.string(),
    og_image: doc('An image URL, or empty.', t.goName('OGImage', t.string())),
    no_index: t.boolean(),
  }),
)

d.define(
  'NavLinks',
  'is every platform link a layout renders. A link the store does not offer is empty.',
  t.object({
    home: t.string(),
    login: t.string(),
    signup: t.string(),
    account: t.string(),
    domains: doc('Empty when the store sells no domains.', t.string()),
    terms: doc('Empty when the store has not set one.', t.string()),
    privacy: doc('Empty when the store has not set one.', t.string()),
  }),
)

d.define(
  'Nav',
  'is what a layout needs to render navigation on every page.',
  t.object({
    groups: doc("The store's enabled groups, in display order.", t.array(t.ref('Group'))),
    links: t.ref('NavLinks'),
  }),
)

d.define(
  'Action',
  'is an endpoint a page may call from the browser.',
  t.object({
    method: t.enum(['GET', 'POST']),
    url: t.goName('URL', t.string()),
  }),
)

d.define(
  'Actions',
  'is the endpoints a page may call. An action the store does not offer is absent.',
  t.object({
    domain_search: doc('Searches domain availability. Absent when the store sells no domains.', optional(t.ref('Action'))),
  }),
)

d.define(
  'PageEnvelope',
  'is every page response.',
  t.object({
    contract: t.ref('ContractVersion'),
    page: t.ref('PageRef'),
    redirect: doc(
      'Set when the engine should redirect instead of rendering. A single-plan service page redirects to checkout and still carries its data.',
      t.nullable(t.ref('Redirect')),
    ),
    meta: t.ref('PageMeta'),
    store: t.ref('Store'),
    nav: t.ref('Nav'),
    settings: doc(
      "The store's values for the template's settings, by setting id. A setting the store has not set is absent; use its default.",
      t.record(t.json()),
    ),
    actions: t.ref('Actions'),
    data: doc('The page-specific data. Absent only when redirect is set and the page has nothing to carry.', optional(t.pageData())),
  }),
)

// ─── Page data ─────────────────────────────────────────────────────────────

d.define('HomeData', 'is the data of the home page.', t.object({ groups: t.array(t.ref('Group')) }))

d.define(
  'CatalogGroupData',
  "is the data of a group's catalogue page.",
  t.object({
    group: t.ref('Group'),
    services: doc('Services with at least one orderable plan.', t.array(t.ref('ServiceCard'))),
  }),
)

d.define(
  'CatalogServiceData',
  "is the data of a service's plan listing.",
  t.object({
    group: t.ref('Group'),
    service: t.ref('Service'),
    plans: doc('Every orderable plan.', t.array(t.ref('Plan'))),
  }),
)

d.define(
  'DomainsData',
  'is the data of the domains page.',
  t.object({
    tlds: t.goName('TLDs', t.array(t.ref('DomainTld'))),
    currency: doc('An ISO 4217 code.', t.string()),
  }),
)

d.define('NotFoundData', 'is the data of the not-found page. It is always empty.', t.object({}))

export const contract202611: Contract = {
  version: '2026-11',
  goPrefix: 'V202611',
  definitions: d.list,
  pages: {
    home: 'HomeData',
    'catalog.group': 'CatalogGroupData',
    'catalog.service': 'CatalogServiceData',
    domains: 'DomainsData',
    'not-found': 'NotFoundData',
  },
  envelope: 'PageEnvelope',
}
