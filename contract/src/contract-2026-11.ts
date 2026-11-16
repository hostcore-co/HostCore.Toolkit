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
    address_line1: doc('The first line of the street address.', t.string()),
    address_line2: doc('The second line of the street address.', t.string()),
    city: doc('The city.', t.string()),
    state: doc('The state, province or region.', t.string()),
    country: doc('The country.', t.string()),
    postal_code: doc('The postal or ZIP code.', t.string()),
    business_number: doc('The company registration number.', t.string()),
    tax_number: doc('The VAT or GST registration number.', t.string()),
    phone_number: doc('The phone number customers may call.', t.string()),
    billing_email: doc('The address billing questions go to.', t.string()),
  }),
)

d.define(
  'StoreTheme',
  "is the store's eight colours. Every value is a hex colour and is always set. The rendering engine writes them to the color.* design tokens.",
  t.object({
    background: doc('The page background. Also --hc-background.', t.string()),
    surface: doc('Cards and panels on the page. Also --hc-surface.', t.string()),
    surface_raised: doc('Inputs and controls on those cards. Also --hc-surface-raised.', t.string()),
    border: doc('Borders and dividers. Also --hc-border.', t.string()),
    text: doc('Body text. Also --hc-text.', t.string()),
    text_muted: doc('Secondary text. Also --hc-text-muted.', t.string()),
    accent: doc('The brand colour, for buttons and links. Also --hc-accent.', t.string()),
    accent_strong: doc('A stronger brand colour, for hover states and gradients. Also --hc-accent-strong.', t.string()),
  }),
)

d.define(
  'Store',
  'is the store a page belongs to. Any URL may be empty when the store has not set it.',
  t.object({
    name: doc("The store's name.", t.string()),
    domain: doc('The domain the store is served on.', t.string()),
    logo_url: doc('The logo image URL, or empty.', t.string()),
    favicon_url: doc('The favicon URL, or empty.', t.string()),
    locale: doc('A BCP 47 language tag such as "en".', t.string()),
    currency: doc('The ISO 4217 code every catalogue price is in.', t.string()),
    business: doc('The business details the store publishes.', t.ref('StoreBusiness')),
    theme: doc("The store's colours.", t.ref('StoreTheme')),
    root_redirect_url: doc('Where the store sends visitors from its root when it runs its own front end. Usually empty.', t.string()),
    login_image_url: doc('Artwork beside the login form. Empty means the platform image.', t.string()),
    signup_image_url: doc('Artwork above the signup form. Empty means the platform image.', t.string()),
  }),
)

// ─── Catalogue ─────────────────────────────────────────────────────────────

d.define(
  'MarketingFeature',
  'is one bullet of store-written marketing copy.',
  t.object({
    icon: doc('The name of an icon the store picked, or empty. Render your own icon for names you know.', t.string()),
    text: doc('The bullet text.', t.string()),
  }),
)

d.define(
  'Marketing',
  'is store-authored copy attached to a group or service.',
  t.object({
    title: doc('A headline. May be empty.', t.string()),
    description: doc('A paragraph. May be empty.', t.string()),
    features: doc('Bullets, in display order. Empty when the store wrote none.', t.array(t.ref('MarketingFeature'))),
  }),
)

d.define(
  'Group',
  'is a group of services.',
  t.object({
    id: doc('A stable id, unique within the store.', t.string()),
    name: doc('The display name.', t.string()),
    slug: doc("The path segment of the group's page. Link with url, never by building a path from it.", t.string()),
    url: doc("The group's catalogue page.", t.goName('URL', t.string())),
    description: doc('A short description. May be empty.', t.string()),
    image: doc('An image URL, or empty.', t.string()),
    marketing: doc('Copy the store wrote for the group page.', t.ref('Marketing')),
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
    id: doc('A stable id, unique within the store.', t.string()),
    group_id: doc('The id of the group the service is in.', t.string()),
    name: doc('The display name.', t.string()),
    slug: doc("The path segment of the service's page. Link with url, never by building a path from it.", t.string()),
    url: doc('Where a card for this service links: its plan listing, or checkout when single_plan is true.', t.string()),
    description: doc('A short description. May be empty.', t.string()),
    image: doc('An image URL, or empty.', t.string()),
    type: doc('What kind of product it is.', t.ref('ServiceType')),
    marketing: doc('Copy the store wrote for the service page.', t.ref('Marketing')),
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
    interval: doc('The billing cycle this price is for.', t.ref('PriceInterval')),
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
    label: doc('What the customer sees.', t.string()),
    value: doc('What is recorded when it is chosen.', t.string()),
    price: doc('An add-on price in minor units (cents).', t.integer({ bits: 64 })),
  }),
)

d.define(
  'OrderFormRegion',
  'is a top-level group inside a location-multi-dropdown, such as a country holding its cities.',
  t.object({
    order: doc('The position among the regions, lowest first.', t.integer()),
    label: doc('What the customer sees, such as a country.', t.string()),
    default: doc('True for the region selected at first.', t.boolean()),
    default_value: doc('The value selected at first within the region, or empty.', t.string()),
    children: doc('The choices inside the region.', t.array(t.ref('OrderFormOption'))),
  }),
)

d.define(
  'OrderFormComponent',
  'is one field a customer fills in when ordering a plan. Only the keys relevant to its type are present.',
  t.object({
    order: doc('The position on the form, lowest first.', t.integer()),
    type: doc('The kind of input.', t.ref('OrderFormComponentType')),
    label: doc('What the customer sees.', t.string()),
    description: doc('Help text under the input. May be empty.', t.string()),
    key: doc('The name the answer is recorded under.', t.string()),
    required: doc('True when the customer must answer it.', t.boolean()),
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
    id: doc('A stable id, unique within the store.', t.string()),
    service_id: doc('The id of the service the plan belongs to.', t.string()),
    name: doc('The display name.', t.string()),
    slug: doc("The plan's path segment at checkout. Link with checkout_url, never by building a path from it.", t.string()),
    description: doc('A short description. May be empty.', t.string()),
    image: doc('An image URL, or empty.', t.string()),
    checkout_url: doc('Where ordering this plan starts.', t.goName('CheckoutURL', t.string())),
    price: doc('The price of the shortest billing cycle the plan has enabled.', t.ref('Price')),
    original_price: doc('A struck-through earlier price, or null.', t.nullable(t.ref('Price'))),
    trial_days: doc('Days of free trial. Zero unless payment_type is free_trial.', t.integer()),
    payment_type: doc('Whether the plan is free, starts with a free trial, or is paid every cycle.', t.ref('PaymentType')),
    provisioning: doc('How an order is fulfilled: "module" (automatically) or "manual" (by the store\'s staff).', t.string()),
    order_form: doc('Never null; empty when the plan asks nothing.', t.array(t.ref('OrderFormComponent'))),
  }),
)

d.define(
  'ServiceCard',
  'is what a catalogue tile shows: a service and the plan it is advertised from.',
  t.object({
    service: doc('The service the tile shows.', t.ref('Service')),
    from: doc('The cheapest plan, compared per month so a yearly plan does not win by being billed less often.', t.ref('Plan')),
  }),
)

d.define(
  'DomainTld',
  'is one extension on the domain pricing table. Prices are for one year in major units; zero means the store does not offer that operation.',
  t.object({
    tld: doc('The extension, without a leading dot: "com".', t.goName('TLD', t.string())),
    featured: doc('True for extensions the store highlights.', t.boolean()),
    register: doc('The price to register a domain for one year.', t.number()),
    transfer: doc('The price to transfer a domain in.', t.number()),
    renew: doc('The price to renew a domain for one year.', t.number()),
  }),
)

// ─── Envelope ──────────────────────────────────────────────────────────────

d.define(
  'PageRef',
  'is the page a response is for, with the path parameters it was matched with.',
  t.object({
    id: doc('The page id, such as "catalog.service".', t.goName('ID', t.pageId())),
    params: doc('Path parameters by name, such as {"group": "games"}. Empty for a page without any.', t.record(t.string())),
  }),
)

d.define(
  'Redirect',
  'tells the rendering engine to answer with a redirect instead of rendering the page.',
  t.object({
    location: doc('Where to send the visitor: a path on the store, or an absolute URL.', t.string()),
    status: doc('One of 301, 302, 307 or 308.', t.integer()),
  }),
)

d.define(
  'PageMeta',
  'is what goes in the document head.',
  t.object({
    title: doc('The document title.', t.string()),
    description: doc('The meta description.', t.string()),
    og_image: doc('An image URL, or empty.', t.goName('OGImage', t.string())),
    no_index: doc('True when search engines should not index the page.', t.boolean()),
  }),
)

d.define(
  'NavLinks',
  'is every platform link a layout renders. A link the store does not offer is empty.',
  t.object({
    home: doc("The store's home page.", t.string()),
    login: doc('The login page.', t.string()),
    signup: doc('The signup page.', t.string()),
    account: doc("The customer's account area.", t.string()),
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
    links: doc('Every platform link a layout renders.', t.ref('NavLinks')),
  }),
)

d.define(
  'Action',
  'is an endpoint a page may call from the browser.',
  t.object({
    method: doc('The HTTP method to call it with.', t.enum(['GET', 'POST'])),
    url: doc('The endpoint, as a path on the store.', t.goName('URL', t.string())),
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
    contract: doc('The contract version the response is in: "2026-11".', t.ref('ContractVersion')),
    page: doc('Which page this is, and the path parameters it was matched with.', t.ref('PageRef')),
    redirect: doc(
      'Set when the engine should redirect instead of rendering. A single-plan service page redirects to checkout and still carries its data.',
      t.nullable(t.ref('Redirect')),
    ),
    meta: doc('What goes in the document head.', t.ref('PageMeta')),
    store: doc('The store the page belongs to.', t.ref('Store')),
    nav: doc('The groups and links a layout needs.', t.ref('Nav')),
    settings: doc(
      "The store's values for the template's settings, by setting id. A setting the store has not set is absent; use its default.",
      t.record(t.json()),
    ),
    actions: doc('The endpoints the page may call from the browser.', t.ref('Actions')),
    data: doc('The page-specific data. Absent only when redirect is set and the page has nothing to carry.', optional(t.pageData())),
  }),
)

// ─── Page data ─────────────────────────────────────────────────────────────

d.define('HomeData', 'is the data of the home page.', t.object({ groups: doc("The store's enabled groups, in display order. The same list as nav.groups.", t.array(t.ref('Group'))) }))

d.define(
  'CatalogGroupData',
  "is the data of a group's catalogue page.",
  t.object({
    group: doc('The group the page is for.', t.ref('Group')),
    services: doc('Services with at least one orderable plan.', t.array(t.ref('ServiceCard'))),
  }),
)

d.define(
  'CatalogServiceData',
  "is the data of a service's plan listing.",
  t.object({
    group: doc('The group the service is in.', t.ref('Group')),
    service: doc('The service the page is for.', t.ref('Service')),
    plans: doc('Every orderable plan.', t.array(t.ref('Plan'))),
  }),
)

d.define(
  'DomainsData',
  'is the data of the domains page.',
  t.object({
    tlds: doc('Every extension the store sells, in display order.', t.goName('TLDs', t.array(t.ref('DomainTld')))),
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
