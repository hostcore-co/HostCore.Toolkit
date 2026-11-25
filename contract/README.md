# The page contract

This directory is the single definition of the data a storefront template is
rendered with, and of the pages a store's domain serves. Everything else —
the SDK types, the Go structs, the JSON Schemas, the fixtures — is generated
from it, so no two copies can drift apart.

```
src/                     the definitions (a small TypeScript schema language)
registry.json            the page registry
fixtures/2026-11/*.json  example payloads, written by hand
fixtures/1/*.json        the same payloads downgraded to contract "1" (generated)
fixtures/links.json      the cases of the link rule (generated)
fixtures/tokens.json     the cases of the colour rule (generated)
fixtures/domain-search.json  domain search answers and their outcomes (generated)
fixtures/checkout-calls.json checkout call answers and their outcomes (generated)
baselines/<version>.json what a template can observe of each version, frozen (hct contract accept)
dist/                    generated, committed; copy these files, do not edit them
  ts/contract-1.ts  ts/contract-2026-11.ts  ts/registry.ts
  go/contract/v1.go  go/contract/v202611.go  go/contract/registry.go
  json-schema/1.json  json-schema/2026-11.json
  registry.json          the registry with every optional key spelled out
```

```bash
hct contract generate     # rewrite dist/, fixtures/1/, links.json and tokens.json
hct contract check        # exit 1 if anything generated is out of date, or the contract differs from baselines/
hct contract accept       # record additive changes in baselines/
hct contract generate-go --kind contract --package <name> --out <dir>
hct contract generate-go --kind frontend-prefixes --package <name> --out <file>
```

The generated TypeScript files import nothing, so they can be copied into any
project. Import each contract file as a namespace
(`import type * as V1 from './contract-1'`): both contracts have a `Price`.
The Go files form one package; contract types carry a prefix (`V1Price`,
`V202611Price`) so every version fits in it.

For tools, `@hostcore/toolkit/contract` exports the runtime validator
(`validate(contract, pageId, value)` → `{ path, message }[]`), the reference
`downgrade`, `matchRoute`, and the setting and token rules.

## Contract versions

A template states the contract it is written against (`"contract"` in
template.json; a template without one is on `"1"`). The platform always
builds the newest shape and converts it down to the version the template
asked for, so an old template keeps receiving exactly what it was written
against.

- **`"1"`** — the payload format-1 templates receive. Frozen: it describes
  what the platform sends today, down to which keys can be absent
  (`meta.og_image`, `meta.no_index`, `pricing.original_price`, the per-type
  order form keys) and which arrays can be `null` (`order_form`, an order form
  region's `children`). Contract `"1"` as served now always sends
  `order_form` as an array, empty for a plan with no form; older responses
  could send `null` there, which is why the schema still allows it.
  `service.type` is one of the five known values or the empty string, which
  is what a service whose store has not set a type has.
- **`"2026-11"`** — every response is a `PageEnvelope`: `page`, `redirect`,
  `meta`, `store`, `nav`, `settings`, `actions`, and `data` whose type depends
  on `page.id`. Templates never build a platform URL: every link target is in
  the payload (`nav.links`, `group.url`, `service.url`, `plan.checkout_url`).

### Additive versus breaking

- **Additive** — a new optional or always-present field, a new page, a new
  value of an *open* enum, a new action. Ships in the current version. Code
  reading the payload must ignore keys it does not know.
- **Breaking** — removing, renaming or retyping a field, changing its unit or
  meaning, adding a value to a *closed* enum, making a present field absent or
  nullable. Needs a new contract version and a downgrade to every older one.

### Baselines

`baselines/<version>.json` freezes what a template can observe of each
contract version: every type with its fields, their types and whether they
may be absent, enum values and whether the enum is open, the page data
types, and for `"2026-11"` the page registry (path, prefix, tier, upstream,
requirement), the design tokens, the standard settings' shapes and limits,
and the link rule's cases. `hct contract check` compares the current
contract with them and classifies each difference:

- **additive**, allowed: a new type, field, page, token, action or standard
  setting; a value added to an open enum; a limit widened; a field of data
  a template reads that is now always present; a value the link rule now
  accepts;
- **breaking**: a type, field, page, token, action or standard setting
  removed or renamed; a type changed; a field of data a template reads
  that may now be absent; a value added to a closed enum, or any enum
  value removed; a page's path, prefix, tier, upstream or requirement
  changed; a standard setting's shape changed or a limit narrowed; a value
  the link rule accepted that it now refuses. For data a template sends
  (the contract's `inputs`), a field becoming required, or a new required
  field, is breaking instead.

A breaking difference fails the check with what changed and the advice
that it needs a new contract version with a downgrade for the old one. An
additive difference fails it too until `hct contract accept` records it in
the baseline, so a reviewer sees the change as a diff of that file;
`accept` refuses while any difference is breaking.

### Open enums

`service.type` in `"2026-11"` is an open enum: any string may arrive, and a
template must render something sensible for a value it does not know. Its
definition names a fallback (`"other"`). A contract that predates a value
receives the fallback in its place; in `"1"`, where the enum is closed, any
value outside `game-server`, `web-hosting`, `dedicated-server`, `vps` and
`other` becomes `other`. The empty string, a service with no type set, is
passed through unchanged in both contracts.

## Domain search

`actions.domain_search` is not for templates to request themselves. The
SDK's `searchDomains(action, query)` resolves to a `DomainSearchOutcome`:
a `DomainSearchSuccess` (`{ status: "ok", results: DomainSearchResult[],
currency }`) or a `DomainSearchError` (`{ status: "error", code, message }`,
`code` an open set of `invalid_query`, `rate_limited`, `unavailable`,
`failed`). A `DomainSearchResult` has `domain`, `sld`, `tld`, `available`,
`premium`, `reason`, `action` (`register`, `transfer` or `none`) and
`register`, `transfer`, `renew`: arrays of `DomainTermPrice` (`{ years,
amount, amount_minor, currency }`, the whole price of the term) by years
ascending. `DomainSearchRequest` (`{ query }`) is what is sent.

**The page interface.** A store page may provide
`window.hc.searchDomains(query: string): Promise<DomainSearchOutcome>`.
When it is a function, `searchDomains` calls it with the query and uses
what it resolves to, making no request of its own; it must resolve to a
`DomainSearchOutcome` and never reject (a rejection, or a value of another
shape, becomes the error `failed`). Without it, `searchDomains` posts
`{ "query": … }` as JSON to the action's url and reads the answer as
`src/domain-search.ts` describes. `fixtures/domain-search.json`
(generated from `src/domain-search-cases.ts`, each case checked) lists
`{ name, status, body, outcome }`: an HTTP status and body the endpoint
answers, and the outcome a page's implementation must give for it.

## Checkout calls

A checkout page (registry tier `checkout`) is rendered with nothing about the
customer in its data. What depends on the customer happens in the browser,
through the SDK's checkout calls, each typed here with an outcome that is
never a rejection:

| call | action | request | outcome |
| --- | --- | --- | --- |
| read the customer | `checkout_customer` (GET) | none | `CheckoutCustomerOutcome`: `CheckoutCustomer` (`{ status: "signed_in", billing: BillingAddress }`), `CheckoutSignedOut` or `CheckoutError` |
| save the billing address | `checkout_customer` (PATCH) | `BillingAddress` | `CheckoutSaveOutcome`: `CheckoutDone`, `CheckoutSignedOut` or `CheckoutError` |
| price the order | `checkout_quote` (QUERY) | `CheckoutQuoteRequest` | `CheckoutQuoteOutcome`: `CheckoutQuote` or `CheckoutError` |
| place the order | `checkout_start` (POST) | `CheckoutStartRequest` | `CheckoutStartOutcome`: `CheckoutRedirect` (go to `url`), `CheckoutBankTransferPlaced` (show `details`), `CheckoutPaid` (go to `/checkout/success`), `CheckoutSignedOut` or `CheckoutError` |
| confirm a payment | `checkout_confirm` (GET, `subscription_id`, `session_id`) | none | `CheckoutConfirmOutcome`: `CheckoutConfirmed` (`payment` `paid` or `processing`), `CheckoutSignedOut` or `CheckoutError` |
| cancel an abandoned payment | `checkout_cancel` (GET, `subscription_id`) | none | `CheckoutCancelOutcome`: `CheckoutCancelled`, `CheckoutSignedOut` or `CheckoutError` |
| read, save, clear the domain draft | `checkout_draft` (GET, PUT, DELETE) | `DomainDraft` | `DomainDraftOutcome` (`DomainDraftFound`, `DomainDraftNone`, `CheckoutError`); `CheckoutSaveOutcome` |

`CheckoutItem`, `DomainConfig` and `DomainContact` make up the requests. The
`actions` entries are present on checkout pages only, with
`session_refresh` (POST), which renews an expired session. Money is in the
contract's usual convention (`Money`, `amount = amount_minor / 100`); a quote
is in the store currency, and its tax is an estimate.

**Signed out.** A call that needs a signed-in customer and gets 401 renews
the session once (`session_refresh`, one renewal shared by calls made at the
same time), retries once, and if that is 401 as well, or the renewal fails,
resolves to `CheckoutSignedOut`, whose `sign_in_url` is `nav.links.login`
with `redirectTo` set to the page's path and query, so the customer comes
back to the same checkout page.

**The page interface.** A checkout page may provide `window.hc.checkout`, an
object with these methods, each resolving to the outcome above and never
rejecting, and handling an expired session as just described:
`customer()`, `saveBillingAddress(address)`, `quote(request)`,
`start(request)`, `confirm(reference, sessionId)`, `cancel(reference)`,
`readDraft()`, `saveDraft(draft)`, `clearDraft()`, and the synchronous
`displayCurrency()` (the visitor's chosen currency, else the store's,
uppercase) and `setDisplayCurrency(code)`. `PageCheckout` in
`src/checkout-calls.ts` is its type. When it is there, the SDK uses it and
makes no requests of its own; otherwise the SDK makes the requests itself
and converts the answers with `src/checkout-calls.ts`.
`fixtures/checkout-calls.json` (generated from `src/checkout-call-cases.ts`,
each case checked) is `{ sign_in_url, cases: [{ name, call, status, body,
outcome }] }`: what each endpoint answers, after the one renewal and retry,
and the outcome an implementation must give for it.

## Standard settings

The fixed `content` block of contract `"1"` is, from `"2026-11"`, a set of
template settings with well-known ids. The built-in default template declares
exactly these; `src/settings.ts` has their labels, limits and defaults.

| id | type |
| --- | --- |
| `hero.title`, `hero.subtitle` | text (160 / 600 characters) |
| `hero.highlights` | list of text, at most 6, each at most 160 characters |
| `hero.primary_cta`, `hero.secondary_cta` | link `{ label, href }`: label at most 160 characters, href at most 600 |
| `categories.title`, `categories.subtitle` | text (160 / 600 characters) |
| `features.title`, `features.subtitle` | text (160 / 600 characters) |
| `features.cards` | object-list `{ title (160), description (600) }`, at most 12 |
| `faq.title`, `faq.subtitle` | text (160 / 600 characters) |
| `faq.items` | object-list `{ question (600), answer (2000) }`, at most 24 |

A setting entry is `{ id, type, label?, description?, max?, href_max?, min?,
step?, of?, item_max?, fields?, options?, default? }` with type one of `text`,
`textarea`, `url`, `link`, `color`, `boolean`, `number`, `select`, `image`,
`list`, `object-list`. `validateSettingSchema` checks a template's
declarations. A template that declares a standard id may change its label,
limits and default, but not its shape (its type, a list's item type, or an
object list's fields), so a store's content carries over between templates.

- `description` is help text shown beside the setting in the editor.
- `max` counts characters for text types; for a `link` it limits the label,
  and the href too when `href_max` is absent. It counts entries for `list`
  and `object-list`, and is the largest value for `number`.
- `href_max` is for `link` only: the characters of the href.
- A declared `0` is a limit like any other; a key that is absent sets no
  limit.
- `min` and `step` are for `number` only. A value must be a whole number of
  steps from `min` (or from zero when there is no `min`).
- `item_max` is for `list` only: the characters of each text item.
- A field of an `object-list` (`{ id, type, label?, description?, max?, min?,
  step? }`) takes the same optional keys as a top-level setting of its type.

### Links

A `link` setting's `href` and every `url` and `image` value, including list
items and object-list fields of those types, follow one rule
(`linkValueError` in `src/settings.ts`), which is what a store can save:

- an `https://` URL;
- a path on the store's own site: it starts with `/` but not `//` or `/\`;
- for a link's `href` only, a fragment of the same page, starting with `#`;
- the empty string, which means nothing is set.

Anything else is refused, including every other scheme and a value with a
control character (U+0000 to U+001F, or U+007F) anywhere in it. Values are
not trimmed, and `https://` is matched in lowercase. `settingValueError`
applies the rule, so a template's declared default must follow it too.
`fixtures/links.json` (generated by `hct contract generate` from
`src/link-cases.ts`, each case checked against the rule) is the table every
implementation tests against: an array of `{ kind, value, ok }`, `kind`
being `link`, `url` or `image`.

## Design tokens

| token | CSS property | value |
| --- | --- | --- |
| `color.background` `color.surface` `color.surface-raised` `color.border` `color.text` `color.text-muted` `color.accent` `color.accent-strong` | `--hc-background` … `--hc-accent-strong` | `#rgb` or `#rrggbb` |
| `radius.sm` `radius.md` `radius.lg` | `--hc-radius-sm` … | `<number>px` or `<number>rem` |
| `font.body` `font.heading` | `--hc-font-body` `--hc-font-heading` | font-family list, `^[A-Za-z0-9 ,'"-]{1,200}$` |
| `space.unit` | `--hc-space-unit` | `<number>px` or `<number>rem` |

A store has all eight theme colours set at all times: to the platform
default palette until its owner changes one. So a token's value is:

- for a colour the store has changed from the platform default, the store's
  colour, whatever the template declares;
- for a colour the store has never changed, the template's value;
- where the template declares no value, the platform default.

A store colour equal to its default compared without regard to case counts
as unchanged (`#34d0ff` is the default accent; `#fff` is not the default
text colour, `#FFFFFF` is). The radius, font and space tokens are the
template's value where it sets one, and otherwise a platform default the
rendering engine sets.

| theme key | token | platform default |
| --- | --- | --- |
| `background` | `color.background` | `#141517` |
| `surface` | `color.surface` | `#111214` |
| `surface_raised` | `color.surface-raised` | `#191A1C` |
| `border` | `color.border` | `#27282A` |
| `text` | `color.text` | `#FFFFFF` |
| `text_muted` | `color.text-muted` | `#A2A3A7` |
| `accent` | `color.accent` | `#34D0FF` |
| `accent_strong` | `color.accent-strong` | `#1F9DFF` |

`effectiveTokens(template, theme)` in `src/tokens.ts` computes the result
(by token name), with `THEME_KEYS`, `THEME_TOKENS` and `PLATFORM_THEME`
beside it; the generated `dist/ts/registry.ts` carries the same, and the Go
package has `ThemeKeys`, `ThemeTokens`, `PlatformTheme` and
`EffectiveTokens(template, theme map[string]string) map[string]string`.
`fixtures/tokens.json` (generated from `src/token-cases.ts`, each case
checked) is an array of `{ name, template, theme, tokens }` that every
implementation tests against.

A `color` setting takes the same two forms as a colour token; `#rgba` and
`#rrggbbaa` are refused.

## The page registry

`registry.json` lists every page a store's domain serves: `id`, `path`
(`null` for a page no path reaches), `prefix`, `tier` (`open`, `guarded`,
`private`, `staff`), `upstream` (`engine` renders it from the template,
`frontend` is the platform's own app), `cache` (`ttl` seconds fresh, `swr`
seconds a stale copy may be served while refreshing; engine pages only) and
`requires`.

Matching (`matchPath` in `dist/ts/registry.ts`):

- one trailing `/` is ignored; an empty segment matches nothing;
- a path with any segment starting with `_` matches nothing;
- a `{param}` in first position never captures the first segment of a
  page's path (`/domains/x` is no group's service page), but captures any
  other segment, reserved or not;
- a prefix page owns its path and everything below it on a `/` boundary
  (`/order` matches `/order/1`, not `/orders`);
- static segments beat parameters, then the longer pattern wins, then an
  exact page beats a prefix page.

`reserved_slugs` is about what a store may name a group, not about
matching. It must include the first segment of every static page path,
and also holds names kept for pages to come (`blog`, `support`, …). The
platform refuses a reserved name when a group is created or renamed
(`isReservedSlug`, `IsReservedSlug`), so no new group shadows a page; but a
group that already has a reserved name keeps its page until a page really
lives at that path, because matching refuses only segments a page in the
registry owns.

### Adding a page

1. Add it to `registry.json`. Reserve its first segment if it is static.
2. For an engine page, add its data type to `src/contract-2026-11.ts` and to
   `pages` there. If contract `"1"` has no such page, the page is only served
   to `"2026-11"` templates; otherwise extend the downgrade.
3. Add a fixture under `fixtures/2026-11/`.
4. `hct contract generate` and `hct contract accept`, then commit `dist/`,
   `fixtures/1/` and `baselines/` with it.

### Cutting a new contract version

1. Copy the newest definitions to `src/contract-<version>.ts`, give it a
   `goPrefix`, and make the breaking change there.
2. Register it in `src/validate.ts` (`CONTRACTS`) and `src/generate/index.ts`.
3. Write the downgrade from the new version to the previous one, document it
   below, and generate `fixtures/<previous>/` from `fixtures/<version>/`.
4. Run `hct contract accept` to record the new version's first baseline.
5. Freeze the previous definitions: from then on they change only to describe
   what is actually sent more precisely, never to change what is sent.

## Downgrade `2026-11` → `1`

`src/downgrade.ts` is the reference implementation; `fixtures/1/` is its
output for `fixtures/2026-11/`, and an implementation in any language must
produce the same JSON (compared as canonical JSON: sorted keys, no
whitespace). `e` is the envelope, `d` its `data`.

Every page:

| contract `1` field | from |
| --- | --- |
| `page_type` | `e.page.id`: `home`→`home`, `catalog.group`→`group`, `catalog.service`→`service`, `domains`→`domains`, `not-found`→`not-found`. Any other page has no contract `1` payload. |
| `meta.title`, `meta.description` | `e.meta.title`, `e.meta.description` |
| `meta.og_image` | `e.meta.og_image`; the key is left out when it is `""` |
| `meta.no_index` | `true` when `e.meta.no_index`; the key is left out when it is `false` |
| `store.store_name` | `e.store.name` |
| `store.website_domain` | `e.store.domain` |
| `store.logo_url`, `store.favicon_url` | `e.store.logo_url`, `e.store.favicon_url` |
| `store.terms_of_service_url` | `e.nav.links.terms` |
| `store.privacy_policy_url` | `e.nav.links.privacy` |
| `store.root_redirect_url`, `store.login_image_url`, `store.signup_image_url` | the same keys of `e.store` |
| `store.business_info` | `e.store.business`, key for key (including `tax_number`) |
| `store.theme` | `e.store.theme`, key for key |
| `service_groups` | `e.nav.groups`, each as a group (below) |
| `content` | rebuilt from `e.settings` (below) |
| `domains_enabled` | `e.nav.links.domains !== ""` |

`e.store.locale`, `e.store.currency`, `e.page.params`, `e.redirect`,
`e.actions` and any non-standard setting have no contract `1` counterpart and
are dropped.

Per page:

| page | contract `1` fields |
| --- | --- |
| `home` | nothing beyond the above (`d.groups` is the same list as `e.nav.groups`) |
| `catalog.group` | `group` ← `d.group` as a group; `services[i]` ← `{ service: d.services[i].service as a service, cheapest_plan: d.services[i].from as a plan }` |
| `catalog.service` | `service` ← `d.service` as a service; `plans` ← `d.plans` as plans. `d.group` is dropped. A single-plan service's envelope has `redirect` set *and* carries `data`, so its contract `1` page is the same service page it always was, with `single_plan: true`. |
| `domains` | `tlds` ← `d.tlds` key for key; `currency` ← `d.currency` |
| `not-found` | nothing beyond the above |

A **group** is `{ id, name, slug, description, image, marketing }`: `url` is
dropped. A **service** is `{ id, group_id, name, slug, description, image,
type, marketing, single_plan }`: `url` is dropped and `type` goes through the
open-enum fallback (the empty string is kept as it is). **marketing** is copied key for key.

A **plan** is:

| contract `1` field | from |
| --- | --- |
| `id`, `service_id`, `name`, `slug`, `description`, `image` | the same keys |
| `pricing.price` | `{ amount, currency, interval }` of `plan.price` (`amount_minor` is dropped; `amount` is copied, not recomputed) |
| `pricing.original_price` | the same of `plan.original_price`; the key is left out when it is `null` |
| `trial_days`, `payment_type`, `provisioning` | the same keys |
| `order_form` | `plan.order_form`, each component as below. Always an array (contract `1` also allows `null`, which a downgrade never produces). |

An **order form component** keeps `order`, `type`, `label`, `description`,
`key` and `required`, and keeps `placeholder`, `regex`, `default_value`,
`price`, `children`, `dropdown` and `preset_id` only when they are present and
not empty, `false` or `0` — the same keys contract `1` leaves out. Options
are copied key for key; a region keeps all five keys, and its `children` is always an
array (a region without children gets `[]`).

**content** is rebuilt from the standard settings. For each id, the store's
value is used when it is present and fits the setting (`settingValueError`
returns null); otherwise the setting's default from `src/settings.ts`. A
value is used as it is: an empty string stays empty and an empty list stays
empty.

| contract `1` field | setting |
| --- | --- |
| `content.hero.title`, `.subtitle`, `.highlights` | `hero.title`, `hero.subtitle`, `hero.highlights` |
| `content.hero.primary_cta`, `.secondary_cta` | `hero.primary_cta`, `hero.secondary_cta` as `{ label, href }` |
| `content.categories.title`, `.subtitle` | `categories.title`, `categories.subtitle` |
| `content.features.title`, `.subtitle`, `.cards` | `features.title`, `features.subtitle`, `features.cards` as `{ title, description }` |
| `content.faq.title`, `.subtitle`, `.items` | `faq.title`, `faq.subtitle`, `faq.items` as `{ question, answer }` |
