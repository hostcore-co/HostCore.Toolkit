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
dist/                    generated, committed; copy these files, do not edit them
  ts/contract-1.ts  ts/contract-2026-11.ts  ts/registry.ts
  go/contract/v1.go  go/contract/v202611.go  go/contract/registry.go
  json-schema/1.json  json-schema/2026-11.json
  registry.json          the registry with every optional key spelled out
```

```bash
hct contract generate     # rewrite dist/ and fixtures/1/
hct contract check        # exit 1 if anything generated is out of date
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

### Open enums

`service.type` in `"2026-11"` is an open enum: any string may arrive, and a
template must render something sensible for a value it does not know. Its
definition names a fallback (`"other"`). A contract that predates a value
receives the fallback in its place; in `"1"`, where the enum is closed, any
value outside `game-server`, `web-hosting`, `dedicated-server`, `vps` and
`other` becomes `other`. The empty string, a service with no type set, is
passed through unchanged in both contracts.

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
| `faq.items` | object-list `{ question (160), answer (2000) }`, at most 24 |

A setting entry is `{ id, type, label?, description?, max?, href_max?, min?,
step?, of?, item_max?, fields?, options?, default? }` with type one of `text`,
`textarea`, `url`, `link`, `color`, `boolean`, `number`, `select`, `image`,
`list`, `object-list`. `validateSettingSchema` checks a template's
declarations.

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

## Design tokens

| token | CSS property | value |
| --- | --- | --- |
| `color.background` `color.surface` `color.surface-raised` `color.border` `color.text` `color.text-muted` `color.accent` `color.accent-strong` | `--hc-background` … `--hc-accent-strong` | `#rgb` or `#rrggbb` |
| `radius.sm` `radius.md` `radius.lg` | `--hc-radius-sm` … | `<number>px` or `<number>rem` |
| `font.body` `font.heading` | `--hc-font-body` `--hc-font-heading` | font-family list, `^[A-Za-z0-9 ,'"-]{1,200}$` |
| `space.unit` | `--hc-space-unit` | `<number>px` or `<number>rem` |

A value resolves from the platform default, then the template's `tokens`,
then the store's theme (the eight colours), last one winning. A `color`
setting takes the same two forms; `#rgba` and `#rrggbbaa` are refused.

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
- a `{param}` in first position never captures a reserved slug;
- a prefix page owns its path and everything below it on a `/` boundary
  (`/order` matches `/order/1`, not `/orders`);
- static segments beat parameters, then the longer pattern wins, then an
  exact page beats a prefix page.

`reserved_slugs` must include the first segment of every static page path;
group slugs are checked against it, so a store can never create a group that
shadows a platform page.

### Adding a page

1. Add it to `registry.json`. Reserve its first segment if it is static.
2. For an engine page, add its data type to `src/contract-2026-11.ts` and to
   `pages` there. If contract `"1"` has no such page, the page is only served
   to `"2026-11"` templates; otherwise extend the downgrade.
3. Add a fixture under `fixtures/2026-11/`.
4. `hct contract generate`, then commit `dist/` and `fixtures/1/` with it.

### Cutting a new contract version

1. Copy the newest definitions to `src/contract-<version>.ts`, give it a
   `goPrefix`, and make the breaking change there.
2. Register it in `src/validate.ts` (`CONTRACTS`) and `src/generate/index.ts`.
3. Write the downgrade from the new version to the previous one, document it
   below, and generate `fixtures/<previous>/` from `fixtures/<version>/`.
4. Freeze the previous definitions: from then on they change only to describe
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
