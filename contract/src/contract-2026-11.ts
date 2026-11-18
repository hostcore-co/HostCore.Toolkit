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
  "is the store's eight colours. Every value is a hex colour and is always set: a colour the owner has never changed is the platform default palette. A colour the store has changed overrides the template's matching color.* design token; one it has not changed gives way to the template's token, and to the platform default where the template declares none.",
  t.object({
    background: doc('The page background (token color.background, --hc-background).', t.string()),
    surface: doc('Cards and panels on the page (token color.surface, --hc-surface).', t.string()),
    surface_raised: doc('Inputs and controls on those cards (token color.surface-raised, --hc-surface-raised).', t.string()),
    border: doc('Borders and dividers (token color.border, --hc-border).', t.string()),
    text: doc('Body text (token color.text, --hc-text).', t.string()),
    text_muted: doc('Secondary text (token color.text-muted, --hc-text-muted).', t.string()),
    accent: doc('The brand colour, for buttons and links (token color.accent, --hc-accent).', t.string()),
    accent_strong: doc('A stronger brand colour, for hover states and gradients (token color.accent-strong, --hc-accent-strong).', t.string()),
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
    method: doc(
      'The HTTP method to call it with. An open set: an action that is a page to go to is GET.',
      t.openEnum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY'], 'GET'),
    ),
    url: doc('The endpoint, as a path on the store.', t.goName('URL', t.string())),
  }),
)

d.define(
  'Actions',
  'is the endpoints a page may call. An action the store does not offer is absent.',
  t.object({
    domain_search: doc(
      'Searches domain availability. Call it with searchDomains(action, query) from the SDK, which returns a DomainSearchOutcome, rather than requesting its url yourself: the platform may change what the endpoint takes and answers. Absent when the store sells no domains.',
      optional(t.ref('Action')),
    ),
    domain_checkout: doc(
      'Where a visitor buys a domain they searched for: a GET of its url with the query parameters domain (the domain name), action (register or transfer) and years (a whole number of years, one of the terms the search result offers). Build the link with actionHref rather than by hand. Present exactly when domain_search is, so absent when the store sells no domains.',
      optional(t.ref('Action')),
    ),
    checkout_customer: doc(
      'On checkout pages: the signed-in customer. A GET reads them; a PATCH saves their billing address. Use the SDK\'s checkout calls, never the endpoint itself.',
      optional(t.ref('Action')),
    ),
    checkout_quote: doc('On checkout pages: prices an order for display, with tax estimated from a country and state.', optional(t.ref('Action'))),
    checkout_start: doc('On checkout pages: places the order and starts payment.', optional(t.ref('Action'))),
    checkout_confirm: doc('On checkout pages: confirms the payment the customer returns from, which completes the order.', optional(t.ref('Action'))),
    checkout_cancel: doc('On checkout pages: cancels the order whose payment the customer abandoned.', optional(t.ref('Action'))),
    checkout_draft: doc(
      'On checkout pages: the domain a visitor has picked, kept on their device. A GET reads it, a PUT saves it and a DELETE clears it.',
      optional(t.ref('Action')),
    ),
    session_refresh: doc('On checkout pages: renews the customer\'s session once when a call finds it expired.', optional(t.ref('Action'))),
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
      "The values of the settings, by setting id. Every standard setting id is always present, with the store's value or the setting's default. Each setting the template declares is present when it has a value: the store's, or else the default the template declares. A declared setting with neither is absent.",
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

// ─── Domain search ─────────────────────────────────────────────────────────

d.define(
  'DomainSearchRequest',
  'is what a domain search asks for. searchDomains sends it; a template does not build it.',
  t.object({
    query: doc('What the visitor typed: a bare name ("acme") or a full domain ("acme.example").', t.string()),
  }),
)

d.define(
  'DomainTermPrice',
  'is the price of a domain for one term, in the money conventions of Price: the whole amount for the whole term.',
  t.object({
    years: doc('The length of the term in whole years, from 1.', t.integer()),
    amount: doc('Major units, ready to render.', t.number()),
    amount_minor: doc('The same amount in minor units (cents), for arithmetic.', t.integer({ bits: 64 })),
    currency: doc('An ISO 4217 code.', t.string()),
  }),
)

d.define(
  'DomainSearchAction',
  'is what a visitor can do with a searched domain: register it, transfer it in, or neither.',
  t.enum(['register', 'transfer', 'none']),
)

d.define(
  'DomainSearchResult',
  'is one domain a search found.',
  t.object({
    domain: doc('The domain name, such as "acme.example".', t.string()),
    sld: doc('The name before the extension, such as "acme".', t.string()),
    tld: doc('The extension, lowercase and without a leading dot, such as "example".', t.string()),
    available: doc('True when the domain can be registered.', t.boolean()),
    premium: doc('True when the registry prices the domain as premium.', t.boolean()),
    reason: doc('Why the store cannot sell the domain at all, such as an extension it does not offer; "" when there is none.', t.string()),
    action: doc(
      'What a visitor can do: register when it is available and has register terms; transfer when it is taken, has transfer terms and no reason; otherwise none. Send the visitor to actions.domain_checkout with this action and one of its terms.',
      t.ref('DomainSearchAction'),
    ),
    register: doc('The terms it can be registered for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
    transfer: doc('The terms it can be transferred in for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
    renew: doc('The terms it renews for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
  }),
)

d.define(
  'DomainSearchSuccess',
  'is a domain search that answered.',
  t.object({
    status: doc('Always "ok".', t.literal('ok')),
    results: doc('The domains found, in the order the platform ranks them. Empty when nothing matched.', t.array(t.ref('DomainSearchResult'))),
    currency: doc('The ISO 4217 code of every price in the results.', t.string()),
  }),
)

d.define(
  'DomainSearchError',
  'is a domain search that did not answer with results.',
  t.object({
    status: doc('Always "error".', t.literal('error')),
    code: doc(
      'Why: "invalid_query" for a query the platform cannot search, "rate_limited" when the visitor searched too often, "unavailable" when the store does not offer domain search, "failed" for anything else. An open set: treat a code you do not know as "failed".',
      t.openEnum(['invalid_query', 'rate_limited', 'unavailable', 'failed'], 'failed'),
    ),
    message: doc('A sentence a visitor can read, in English.', t.string()),
  }),
)

d.define(
  'DomainSearchOutcome',
  [
    'is what searchDomains(action, query) resolves to: a DomainSearchSuccess or a DomainSearchError, told apart by status. It never rejects.',
    'On a store page the platform provides the search itself, so the request it sends and the answer it reads can change with the platform rather than with a template: searchDomains calls window.hc.searchDomains(query) when that is a function, which must resolve to a DomainSearchOutcome and never reject. Elsewhere, such as in hct dev, searchDomains requests actions.domain_search itself.',
  ].join(' '),
  t.union('status', { ok: 'DomainSearchSuccess', error: 'DomainSearchError' }),
)

// ─── Checkout pages ────────────────────────────────────────────────────────

d.define(
  'Money',
  'is an amount of money that is not a price per billing cycle, such as a setup fee or a total.',
  t.object({
    amount: doc('Major units, ready to render.', t.number()),
    amount_minor: doc('The same amount in minor units (cents), for arithmetic.', t.integer({ bits: 64 })),
    currency: doc('An ISO 4217 code.', t.string()),
  }),
)

d.define(
  'CheckoutCycle',
  'is one billing cycle a plan can be bought on, with its price and its setup fee. Order-form options are priced per cycle on top of the rate: the same amount whatever the cycle.',
  t.object({
    interval: doc('The billing cycle.', t.ref('PriceInterval')),
    price: doc('The rate charged every cycle, in the store currency.', t.ref('Price')),
    setup_fee: doc('Charged once, with the first invoice; zero when the plan has none.', t.ref('Money')),
  }),
)

d.define(
  'CheckoutPlan',
  'is a plan as checkout needs it: every billing cycle it can be bought on, its order form, and whether it may be paid by bank transfer.',
  t.object({
    id: doc('A stable id, unique within the store.', t.string()),
    service_id: doc('The id of the service the plan belongs to.', t.string()),
    name: doc('The display name.', t.string()),
    slug: doc("The plan's path segment at checkout.", t.string()),
    description: doc('A short description. May be empty.', t.string()),
    image: doc('An image URL, or empty.', t.string()),
    payment_type: doc('Whether the plan is free, starts with a free trial, or is paid every cycle.', t.ref('PaymentType')),
    trial_days: doc('Days of free trial. Zero unless payment_type is free_trial.', t.integer()),
    provisioning: doc('How an order is fulfilled: "module" (automatically) or "manual" (by the store\'s staff).', t.string()),
    cycles: doc(
      'The billing cycles the plan can be bought on, monthly first, then quarterly, semi-annual and yearly; only the ones the store has enabled. Empty for a free or free-trial plan with no pricing.',
      t.array(t.ref('CheckoutCycle')),
    ),
    order_form: doc('Never null; empty when the plan asks nothing.', t.array(t.ref('OrderFormComponent'))),
    allow_bank_transfer: doc('True when an order of this plan may be paid by bank transfer, if the store accepts it.', t.boolean()),
  }),
)

d.define(
  'CheckoutGateway',
  'is a payment provider the store takes payments with. The customer pays on the provider\'s own page.',
  t.object({
    gateway: doc('The provider: "stripe" or "paypal". An open set.', t.string()),
    supported_currencies: doc('The ISO 4217 codes it can charge in.', t.array(t.string())),
    default_currency: doc('The code it charges in when the customer has not chosen one.', t.string()),
  }),
)

d.define(
  'CheckoutBankTransfer',
  'says the store accepts payment by bank transfer. The account details and the payment reference come with the order, after it is placed.',
  t.object({
    instructions: doc('What the store tells customers about paying by transfer. May be empty.', t.string()),
    due_days: doc('Days the customer has to send the money.', t.integer()),
  }),
)

d.define(
  'CheckoutPayment',
  'is how the store takes payment.',
  t.object({
    gateways: doc('The payment providers, in no particular order.', t.array(t.ref('CheckoutGateway'))),
    bank_transfer: doc('Set when the store accepts bank transfer, or null.', t.nullable(t.ref('CheckoutBankTransfer'))),
    currency: doc('The store currency: the one every catalogue price is in.', t.string()),
  }),
)

d.define(
  'CheckoutOfferKind',
  'is what an add-on offer adds to the order: a plan of another service, or a domain.',
  t.enum(['service', 'domain']),
)

d.define(
  'CheckoutOfferService',
  'is the service a service offer adds a plan of.',
  t.object({
    id: doc('A stable id, unique within the store.', t.string()),
    group_id: doc('The id of the group the service is in.', t.string()),
    name: doc('The display name.', t.string()),
    slug: doc('The service\'s path segment.', t.string()),
    image: doc('An image URL, or empty.', t.string()),
    marketing: doc('Copy the store wrote for the service.', t.ref('Marketing')),
  }),
)

d.define(
  'CheckoutOfferTld',
  'is one extension a domain offer sells, with its prices for every term.',
  t.object({
    tld: doc('The extension, without a leading dot: "com".', t.goName('TLD', t.string())),
    featured: doc('True for extensions the store highlights.', t.boolean()),
    register: doc('The terms it can be registered for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
    transfer: doc('The terms it can be transferred in for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
    renew: doc('The terms it renews for, by years ascending; empty when none.', t.array(t.ref('DomainTermPrice'))),
  }),
)

d.define(
  'CheckoutOffer',
  'is an add-on the store offers with the item being bought. A customer may add one item per offer: one of its plans, or one domain. Only the plans listed may go with the item, and a domain offer takes any domain a search finds.',
  t.object({
    id: doc('A stable id, unique within the store.', t.string()),
    kind: doc('What it adds.', t.ref('CheckoutOfferKind')),
    title: doc('The heading the store wrote.', t.string()),
    description: doc('The text the store wrote. May be empty.', t.string()),
    service: doc('For a service offer, the service; null for a domain offer.', t.nullable(t.ref('CheckoutOfferService'))),
    plans: doc('For a service offer, the plans that may be added, in display order; empty for a domain offer.', t.array(t.ref('CheckoutPlan'))),
    tlds: doc('For a domain offer, the extensions on sale; empty for a service offer.', t.goName('TLDs', t.array(t.ref('CheckoutOfferTld')))),
  }),
)

d.define(
  'ExchangeRates',
  'is how many units of each currency one US dollar buys, by ISO 4217 code. A price converts from the store currency to another by the ratio of their rates.',
  t.record(t.number()),
)

d.define(
  'CheckoutPlanData',
  [
    'is the data of the plan checkout page, /checkout/{service}/{plan}, or /checkout/{service} for a service with one plan.',
    'It carries nothing about the customer: whether they are signed in and their billing address come from the browser, through the SDK\'s checkout calls.',
  ].join(' '),
  t.object({
    service: doc('The service being bought.', t.ref('Service')),
    group: doc('The group the service is in, or null when it is in none.', t.nullable(t.ref('Group'))),
    plan: doc('The plan being bought.', t.ref('CheckoutPlan')),
    payment: doc('How the store takes payment.', t.ref('CheckoutPayment')),
    exchange_rates: doc('Set when the store shows prices in other currencies, or null: then only the store currency is offered.', t.nullable(t.ref('ExchangeRates'))),
    offers: doc('The add-ons offered with this plan, in display order. Empty when there are none.', t.array(t.ref('CheckoutOffer'))),
  }),
)

d.define(
  'CheckoutDomainsData',
  'is the data of the domain checkout page, /checkout/domains. The domain being bought comes from the address (domain, action and years in the query) or from the visitor\'s saved pick, not from the page data.',
  t.object({
    payment: doc('How the store takes payment. Bank transfer is never offered for domains.', t.ref('CheckoutPayment')),
    exchange_rates: doc('Set when the store shows prices in other currencies, or null.', t.nullable(t.ref('ExchangeRates'))),
    offers: doc('The add-ons offered with a domain, in display order. Empty when there are none.', t.array(t.ref('CheckoutOffer'))),
  }),
)

d.define(
  'CheckoutSuccessData',
  'is the data of the page a customer returns to after paying, /checkout/success. It is always empty: the order reference arrives in the address, and the page confirms the payment through the SDK.',
  t.object({}),
)

d.define(
  'CheckoutCancelData',
  'is the data of the page a customer returns to after abandoning payment, /checkout/cancel. It is always empty: the order reference arrives in the address.',
  t.object({}),
)

// ─── Checkout calls ────────────────────────────────────────────────────────

d.define(
  'BillingAddress',
  'is the address a customer is invoiced and taxed at, kept on their account. Any field may be empty.',
  t.object({
    country: doc('An ISO 3166-1 alpha-2 code, such as "US", or empty.', t.string()),
    state: doc('The state, province or region.', t.string()),
    address_line1: doc('The first line of the street address.', t.string()),
    address_line2: doc('The second line of the street address.', t.string()),
    city: doc('The city.', t.string()),
    postal_code: doc('The postal or ZIP code.', t.string()),
    tax_id: doc('A VAT or other tax registration number.', t.string()),
  }),
)

d.define(
  'DomainContact',
  'is the registrant contact registries require for a domain: one contact for every domain in the order.',
  t.object({
    first_name: doc('Required.', t.string()),
    last_name: doc('Required.', t.string()),
    organization: doc('May be empty.', t.string()),
    email: doc('Required.', t.string()),
    phone: doc('Required.', t.string()),
    address1: doc('Required.', t.string()),
    address2: doc('May be empty.', t.string()),
    city: doc('Required.', t.string()),
    state: doc('May be empty.', t.string()),
    postal_code: doc('Required.', t.string()),
    country_code: doc('Required: an ISO 3166-1 alpha-2 code.', t.string()),
  }),
)

d.define(
  'DomainConfig',
  'is what registering or transferring a domain needs beyond its name.',
  t.object({
    contact: doc('The registrant contact.', t.ref('DomainContact')),
    privacy: doc('True to hide the contact from public WHOIS where the registry allows it.', t.boolean()),
    epp_code: doc('The authorisation code a transfer needs; absent for a registration.', optional(t.string())),
  }),
)

d.define('CheckoutItemKind', 'is what an order item is: a plan or a domain.', t.enum(['plan', 'domain']))

d.define(
  'CheckoutBillingInterval',
  'is a billing cycle as the checkout calls name it: monthly, quarterly, semiannually or annually, for the PriceInterval month, quarter, semi_annual and year.',
  t.enum(['monthly', 'quarterly', 'semiannually', 'annually']),
)

d.define(
  'CheckoutItem',
  'is one item of an order. The first is what is being bought; each one after it is an add-on of an offer that goes with it. A plan item has service_id, plan_id, order_config and, for a recurring plan, billing_interval; a domain item has domain, action and years, and in a start request domain_config.',
  t.object({
    kind: doc('A plan or a domain.', t.ref('CheckoutItemKind')),
    service_id: doc('A plan item: the service.', optional(t.string())),
    plan_id: doc('A plan item: the plan.', optional(t.string())),
    billing_interval: doc('A recurring plan item: the billing cycle.', optional(t.ref('CheckoutBillingInterval'))),
    order_config: doc('A plan item: the order form answers by key, text and choices as strings and checkboxes as booleans.', optional(t.record(t.json()))),
    domain: doc('A domain item: the domain name.', optional(t.string())),
    action: doc('A domain item: register or transfer.', optional(t.string())),
    years: doc('A domain item: the term in whole years.', optional(t.integer())),
    domain_config: doc('A domain item of a start request: the contact, privacy and transfer code.', optional(t.ref('DomainConfig'))),
  }),
)

d.define(
  'CheckoutQuoteRequest',
  'is what pricing an order sends: the items, and the country and state tax is estimated for.',
  t.object({
    items: doc('The order items.', t.array(t.ref('CheckoutItem'))),
    country: doc('The billing country, or empty.', t.string()),
    state: doc('The billing state, or empty.', t.string()),
  }),
)

d.define(
  'CheckoutStartRequest',
  'is what placing an order sends. For an order with anything to pay, it names how: method "bank_transfer", or a gateway and the currency to charge in.',
  t.object({
    items: doc('The order items, domain items with their domain_config.', t.array(t.ref('CheckoutItem'))),
    method: doc('"bank_transfer" to pay by bank transfer; absent to pay with a gateway.', optional(t.string())),
    gateway: doc('The payment provider, when paying with one.', optional(t.string())),
    currency: doc('The ISO 4217 code to charge in, uppercase, when paying with a gateway.', optional(t.string())),
    promo_code: doc('A promotion code, or empty.', optional(t.string())),
  }),
)

d.define(
  'DomainDraft',
  'is a domain a visitor has picked to buy, kept on their device while they check out.',
  t.object({
    domain: doc('The domain name.', t.string()),
    action: doc('register or transfer.', t.string()),
    years: doc('The term in whole years, from 1 to 10.', t.integer()),
  }),
)

d.define(
  'CheckoutSignedOut',
  'is a checkout call that needs a signed-in customer finding none, after one attempt to renew the session.',
  t.object({
    status: doc('Always "signed_out".', t.literal('signed_out')),
    sign_in_url: doc('The sign-in page, with a return path to this checkout page and its query.', t.string()),
  }),
)

d.define(
  'CheckoutError',
  'is a checkout call that failed.',
  t.object({
    status: doc('Always "error".', t.literal('error')),
    code: doc(
      'The platform\'s reason when it gives one, such as "promo_invalid", "domain_unavailable" or "invalid_input"; "failed" otherwise. An open set.',
      t.string(),
    ),
    message: doc('A sentence a customer can read, in English.', t.string()),
  }),
)

d.define(
  'CheckoutCustomer',
  'is a signed-in customer, as checkout needs them.',
  t.object({
    status: doc('Always "signed_in".', t.literal('signed_in')),
    billing: doc('Their billing address. The country is empty unless it is a two-letter code.', t.ref('BillingAddress')),
  }),
)

d.define(
  'CheckoutCustomerOutcome',
  'is what reading the customer resolves to.',
  t.union('status', { signed_in: 'CheckoutCustomer', signed_out: 'CheckoutSignedOut', error: 'CheckoutError' }),
)

d.define('CheckoutDone', 'is a checkout call that did what it was asked.', t.object({ status: doc('Always "ok".', t.literal('ok')) }))

d.define(
  'CheckoutSaveOutcome',
  'is what saving the billing address, or saving or clearing the domain draft, resolves to.',
  t.union('status', { ok: 'CheckoutDone', signed_out: 'CheckoutSignedOut', error: 'CheckoutError' }),
)

d.define(
  'CheckoutQuoteLine',
  'is one priced item of a quote, in the order of the request\'s items.',
  t.object({
    kind: doc('A plan or a domain.', t.ref('CheckoutItemKind')),
    label: doc('What the item is, written for the customer.', t.string()),
    price: doc('What the item costs now: the first cycle of a plan, with its order-form options, or the domain\'s term.', t.ref('Money')),
    setup_fee: doc('The setup fee charged with it; zero when none.', t.ref('Money')),
    error: doc('Why the item cannot be ordered as it is; empty when it can.', t.string()),
    incomplete: doc('True when a required order-form answer is still empty: priced, but not yet orderable.', t.boolean()),
  }),
)

d.define(
  'CheckoutQuote',
  'is a priced order, in the store currency. Tax is an estimate for the country and state asked; the order is taxed from the customer\'s saved billing address when it is placed. Promotion codes and account credit are not reflected.',
  t.object({
    status: doc('Always "ok".', t.literal('ok')),
    currency: doc('The store currency every amount is in.', t.string()),
    lines: doc('One per item.', t.array(t.ref('CheckoutQuoteLine'))),
    subtotal: doc('Before tax.', t.ref('Money')),
    tax: doc('The estimated tax.', t.ref('Money')),
    total: doc('Due now.', t.ref('Money')),
    tax_inclusive: doc('True when the prices already include the tax.', t.boolean()),
    incomplete: doc('True when any line is incomplete: the order cannot be placed yet.', t.boolean()),
  }),
)

d.define(
  'CheckoutQuoteOutcome',
  'is what pricing an order resolves to.',
  t.union('status', { ok: 'CheckoutQuote', error: 'CheckoutError' }),
)

d.define(
  'CheckoutBankTransferDetails',
  'is what a customer needs to pay an order by bank transfer. Account fields the store has not set are empty.',
  t.object({
    invoice_id: doc('The invoice the transfer pays.', t.string()),
    invoice_number: doc('Its number, for the customer.', t.string()),
    reference: doc('The payment reference to quote exactly.', t.string()),
    amount: doc('What to send.', t.ref('Money')),
    due_at: doc('When it is due, as an RFC 3339 time.', t.string()),
    account_name: doc('The account holder.', t.string()),
    bank_name: doc('The bank.', t.string()),
    account_number: doc('The account number.', t.string()),
    sort_code: doc('The sort code.', t.string()),
    iban: doc('The IBAN.', t.goName('IBAN', t.string())),
    swift: doc('The SWIFT or BIC code.', t.goName('SWIFT', t.string())),
    instructions: doc('What the store tells customers about paying by transfer.', t.string()),
  }),
)

d.define(
  'CheckoutRedirect',
  'is a placed order whose payment happens on the payment provider\'s page: send the customer to url.',
  t.object({
    status: doc('Always "redirect".', t.literal('redirect')),
    url: doc('The payment page.', t.goName('URL', t.string())),
    order_id: doc('The order, or empty.', t.string()),
    subscription_id: doc('The subscription when the order made exactly one, or empty.', t.string()),
  }),
)

d.define(
  'CheckoutBankTransferPlaced',
  'is a placed order to be paid by bank transfer: show the details. Nothing starts until the money arrives.',
  t.object({
    status: doc('Always "bank_transfer".', t.literal('bank_transfer')),
    order_id: doc('The order.', t.string()),
    subscription_id: doc('The subscription when the order made exactly one, or empty.', t.string()),
    details: doc('Where to send the money, and how much.', t.ref('CheckoutBankTransferDetails')),
  }),
)

d.define(
  'CheckoutPaid',
  'is a placed order that needed no payment step: a free or free-trial plan, or a total covered by credit or a promotion. Send the customer to /checkout/success.',
  t.object({
    status: doc('Always "paid".', t.literal('paid')),
    order_id: doc('The order, or empty for a free or free-trial plan.', t.string()),
    subscription_id: doc('The subscription when the order made exactly one, or empty.', t.string()),
  }),
)

d.define(
  'CheckoutStartOutcome',
  'is what placing an order resolves to.',
  t.union('status', {
    redirect: 'CheckoutRedirect',
    bank_transfer: 'CheckoutBankTransferPlaced',
    paid: 'CheckoutPaid',
    signed_out: 'CheckoutSignedOut',
    error: 'CheckoutError',
  }),
)

d.define(
  'CheckoutConfirmed',
  'is a payment the platform has confirmed: "paid", or "processing" while the provider settles it, after which the order starts by itself.',
  t.object({
    status: doc('Always "confirmed".', t.literal('confirmed')),
    payment: doc('"paid" or "processing".', t.enum(['paid', 'processing'])),
  }),
)

d.define(
  'CheckoutConfirmOutcome',
  'is what confirming a payment resolves to. The success page must confirm: confirming is what completes a payment and starts the order.',
  t.union('status', { confirmed: 'CheckoutConfirmed', signed_out: 'CheckoutSignedOut', error: 'CheckoutError' }),
)

d.define('CheckoutCancelled', 'is an order whose abandoned payment has been cancelled.', t.object({ status: doc('Always "cancelled".', t.literal('cancelled')) }))

d.define(
  'CheckoutCancelOutcome',
  'is what cancelling an abandoned payment resolves to.',
  t.union('status', { cancelled: 'CheckoutCancelled', signed_out: 'CheckoutSignedOut', error: 'CheckoutError' }),
)

d.define('DomainDraftFound', 'is a saved domain draft.', t.object({ status: doc('Always "found".', t.literal('found')), draft: doc('The pick.', t.ref('DomainDraft')) }))

d.define('DomainDraftNone', 'is the absence of a saved domain draft.', t.object({ status: doc('Always "none".', t.literal('none')) }))

d.define(
  'DomainDraftOutcome',
  'is what reading the domain draft resolves to.',
  t.union('status', { found: 'DomainDraftFound', none: 'DomainDraftNone', error: 'CheckoutError' }),
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
    'checkout.plan': 'CheckoutPlanData',
    'checkout.domains': 'CheckoutDomainsData',
    'checkout.success': 'CheckoutSuccessData',
    'checkout.cancel': 'CheckoutCancelData',
  },
  envelope: 'PageEnvelope',
  inputs: ['DomainSearchRequest', 'BillingAddress', 'DomainContact', 'DomainConfig', 'CheckoutItem', 'CheckoutQuoteRequest', 'CheckoutStartRequest', 'DomainDraft'],
}
