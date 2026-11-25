/**
 * Where each contract "1" field a format-1 template reads lives in contract
 * "2026-11", for authors moving a template to format 2. `hct upgrade`
 * rewrites the accesses this table marks one-to-one and lists the rest;
 * `hct docs` prints the table.
 *
 * Paths are written from the contract "1" page data (`data` in useHC()) and
 * from the 2026-11 side as a format-2 page or layout reads them. `<sec>` and
 * `<key>` stand for any segment.
 */

export interface FieldMove {
  /** The contract "1" path, relative to the page data. */
  v1: string
  /** Where it is in a format-2 template. */
  v2: string
  /** Whether the value is the same, so an access can be rewritten as it is. */
  oneToOne: boolean
  /** What differs, when something does. */
  note?: string
}

export const FIELD_MOVES: readonly FieldMove[] = [
  {
    v1: 'page_type',
    v2: 'page.page.id (or usePage().page.id)',
    oneToOne: false,
    note: 'Page ids are named differently: "group" is "catalog.group" and "service" is "catalog.service". A format-2 page file is already one page, so most checks of it go away.',
  },
  { v1: 'meta.title', v2: 'page.meta.title', oneToOne: true },
  { v1: 'meta.description', v2: 'page.meta.description', oneToOne: true },
  { v1: 'meta.og_image', v2: 'page.meta.og_image', oneToOne: true, note: 'Always present; "" when unset, where contract "1" left the key out.' },
  { v1: 'meta.no_index', v2: 'page.meta.no_index', oneToOne: true, note: 'Always present; false when unset, where contract "1" left the key out.' },
  { v1: 'store.store_name', v2: 'useStore().name', oneToOne: true },
  { v1: 'store.website_domain', v2: 'useStore().domain', oneToOne: true },
  { v1: 'store.logo_url', v2: 'useStore().logo_url', oneToOne: true },
  { v1: 'store.favicon_url', v2: 'useStore().favicon_url', oneToOne: true },
  { v1: 'store.root_redirect_url', v2: 'useStore().root_redirect_url', oneToOne: true },
  { v1: 'store.login_image_url', v2: 'useStore().login_image_url', oneToOne: true },
  { v1: 'store.signup_image_url', v2: 'useStore().signup_image_url', oneToOne: true },
  { v1: 'store.terms_of_service_url', v2: 'useNav().links.terms', oneToOne: true },
  { v1: 'store.privacy_policy_url', v2: 'useNav().links.privacy', oneToOne: true },
  { v1: 'store.business_info.<key>', v2: 'useStore().business.<key>', oneToOne: true },
  {
    v1: 'store.theme.<key>',
    v2: 'useStore().theme.<key>',
    oneToOne: true,
    note: 'In CSS, prefer the design tokens: var(--hc-accent) and the others are set on :root for you.',
  },
  { v1: 'service_groups', v2: 'useNav().groups', oneToOne: true, note: 'Each group also has url, its catalogue page.' },
  { v1: 'content.<sec>.<key>', v2: "useSetting('<sec>.<key>')", oneToOne: true, note: 'The standard settings; declare the ones you read in template.json.' },
  {
    v1: 'content.<sec>',
    v2: "useSetting('<sec>.<key>') for each key",
    oneToOne: false,
    note: 'A whole content section has no single setting; read each key on its own.',
  },
  { v1: 'domains_enabled', v2: "useNav().links.domains !== ''", oneToOne: true },
  { v1: 'group', v2: 'data.group (catalog.group)', oneToOne: true, note: 'Also has url.' },
  { v1: 'services', v2: 'data.services (catalog.group)', oneToOne: true, note: 'Each entry is { service, from }.' },
  { v1: 'services[].cheapest_plan', v2: 'data.services[].from', oneToOne: true },
  { v1: 'service', v2: 'data.service (catalog.service)', oneToOne: true, note: 'Also has url: the plan listing, or checkout for a single-plan service.' },
  { v1: 'plans', v2: 'data.plans (catalog.service)', oneToOne: true, note: 'Each plan also has checkout_url.' },
  { v1: 'tlds', v2: 'data.tlds (domains)', oneToOne: true },
  { v1: 'currency', v2: 'data.currency (domains)', oneToOne: true },
  { v1: '<plan>.pricing.price', v2: '<plan>.price', oneToOne: true, note: 'Also has amount_minor, the amount in cents.' },
  {
    v1: '<plan>.pricing.original_price',
    v2: '<plan>.original_price',
    oneToOne: true,
    note: 'null when there is none, where contract "1" left the key out.',
  },
  { v1: '<plan>.pricing', v2: '<plan>.price and <plan>.original_price', oneToOne: false, note: 'The pricing object is gone; read its two prices directly.' },
  {
    v1: '<service>.type',
    v2: '<service>.type',
    oneToOne: true,
    note: 'An open set in 2026-11: render something sensible for a value you do not know.',
  },
]

/** The hooks of format 1 and what replaces them. */
export const HOOK_MOVES: readonly FieldMove[] = [
  {
    v1: 'useHC()',
    v2: 'the page props, usePage(), useStore(), useNav(), useSetting()',
    oneToOne: false,
    note: 'useHC() returned everything; format 2 has a hook for each part.',
  },
  { v1: 'useHC().store, useStore()', v2: 'useStore()', oneToOne: true, note: 'The 2026-11 store; see the store fields above.' },
  { v1: 'useHC().service_groups, useServiceGroups()', v2: 'useNav().groups', oneToOne: true },
  { v1: 'usePageData()', v2: "the page's data prop, or usePage().data", oneToOne: false },
]

/** What 2026-11 has that contract "1" did not: links a template used to build itself, and more. */
export const NEW_IN_2026_11: readonly { field: string; use: string }[] = [
  { field: 'group.url', use: 'link a group; never build "/<group slug>" yourself' },
  { field: 'service.url', use: 'link a service card; it already points at checkout for a single-plan service' },
  { field: 'plan.checkout_url', use: 'link to order a plan; never build "/checkout/…" yourself' },
  { field: 'nav.links.home, login, signup, account, domains', use: 'every platform link a layout needs; "" when the store does not offer it' },
  { field: 'actions.domain_search', use: 'search for domains with searchDomains(useAction("domain_search"), query), which returns typed results; never request the endpoint or read its answer yourself' },
  { field: 'actions.domain_checkout', use: 'link to buy a searched domain: actionHref(useAction("domain_checkout"), { domain, action, years }); never build "/checkout/domains?…" yourself' },
  { field: 'store.locale, store.currency', use: 'format numbers and prices (useMoney())' },
  { field: 'page.params', use: 'the path parameters the page was matched with' },
  { field: 'redirect', use: 'set when the platform answers with a redirect; a page never renders it' },
  { field: 'settings', use: "the store's values for every setting your template declares" },
  { field: 'checkout pages (checkout.plan, checkout.domains, checkout.success, checkout.cancel)', use: "render the order flow yourself, with useCheckoutPlan(), useCheckoutDomains(), useCheckoutSuccess() and useCheckoutCancel(); a store uses them once HostCore has reviewed them, and keeps the platform's checkout for any you leave out" },
  { field: 'actions.checkout_*, actions.session_refresh', use: 'the checkout calls, present on checkout pages; the checkout hooks use them for you' },
]
