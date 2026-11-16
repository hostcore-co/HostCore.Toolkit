# HostCore Toolkit

Everything you need to write a storefront template for HostCore: the data
contract your components are written against, and the toolchain that turns
them into a bundle the platform will run.

```bash
bun add github:hostcore-co/HostCore.Toolkit#v2.0.0
```

That gives you both — `@hostcore/toolkit` to import from, and `hct` to build
with.

## From first file to upload

```bash
hct init acme              # a working template: layout, pages, islands, settings
cd acme && bun install
hct dev                    # preview every page against the contract fixtures
hct check                  # render every page the way the platform does
hct push --listing <id>    # upload it as a new version and get a preview link
```

- **`hct init [dir]`** writes a template that validates, checks and builds as
  it is. `--minimal` writes only `template.json` with design tokens (and a
  `package.json`): the platform renders every page and the layout, in your
  colours, radii and fonts.
- **`hct dev [dir]`** builds the template and serves it at
  `http://127.0.0.1:4173/`. The start page lists every page id with every
  example payload for it (the fixtures in [`contract/fixtures`](contract)).
  Each preview is rendered by your template's real server entry and
  hydrated by its real client entry, with a switch between the `default` and
  `minimal` layout variants. A page you have not written shows where the
  platform's default page appears; the platform's own pages show where they
  appear: checkout, sign-in and the other guarded pages inside your
  layout's `minimal` variant, the account area in your design tokens with
  no layout. Links
  in the preview go to the fixture for that page. Save a file and the
  template rebuilds and the browser reloads. `--payload <file>` previews a
  page payload of your own as well: a 2026-11 page envelope in a JSON file
  you write, most easily by copying one of the fixtures and changing it.
  The preview names any field that does not fit the contract.
- **`hct check [dir]`** builds the template and renders every page it
  implements against every fixture for that page, as a whole document and
  as a body, its layout once per variant, and every slot it fills — what the platform does before
  it accepts a version. It prints a line for each render that fails, with
  its page, fixture and kind, and the build's sizes against budgets (server
  bundle 1 MB, client JavaScript 250 KB, stylesheet 100 KB; change them with
  `--budget-server`, `--budget-client-js`, `--budget-css`). A budget is
  advice: only a failed render fails the check. A page that renders
  nothing fails too, with `HC_EMPTY_RENDER`: its markup, leaving out HTML
  comments and whitespace, must have at least one element or some text,
  so a page component that returns `null` for a fixture fails, while one
  that renders a single empty element passes. `--json` prints a
  machine-readable report, and `--dist <dir>` checks a build you already
  have. Before it renders anything, it checks the build itself: every file
  `manifest.json` lists must be there with the listed digest and size, with
  no file it does not list, and the stylesheet may not load from another
  site (below). A build that fails this is not rendered; in the `--json`
  report each problem is a result with `"kind": "build"`, `"ok": false`,
  empty `page`, `fixture` and `variant`, and an `error` that starts with
  `HC_BUILD_FILES` or `HC_STYLESHEET_EXTERNAL`, and the report's `ok` is
  `false`.
- **`hct push [dir]`** builds the template, then uploads its source as a new
  version of your marketplace listing and prints the platform's checks and
  a preview link. Set `HOSTCORE_API_URL` and `HOSTCORE_TOKEN` in the
  environment, and pass `--listing <id>` (or set `HOSTCORE_LISTING`). The
  version is `template.json`'s `version` unless you pass `--tag`;
  `--changelog` says what changed. Everything but `node_modules/`, `dist/`,
  `build/` and names starting with a dot is uploaded. A template without a
  `package.json` (one that is only `template.json`, say) has nothing
  installed to build it with, so it is uploaded without building it first,
  and you get the platform's answer.
- **`hct upgrade [dir]`** moves a format-1 template to format 2 (below).
- **`hct docs --out <dir>`** writes the reference as Markdown: every page and
  its data, every type and field of the contract, settings, design tokens,
  the SDK, the commands, and what changed from contract `"1"`.

Every command explains itself with `hct <command> --help`.

## Writing a template

A template is a directory with a `template.json` and, optionally, React
components for the parts of the storefront you want to look different:

```
template.json
src/layout.tsx              the header, footer and frame around every page
src/pages/<page-id>.tsx     one file per page: home, catalog.group,
                            catalog.service, domains, not-found
src/islands/<name>.tsx      components hydrated on their own (see Islands)
src/slots/<slot-id>.tsx     static content for a place on the platform's
                            own pages (see Slots)
public/                     fonts, images and other files, served as they are
```

Every file under `src/` is optional. A page you leave out, or the layout,
is filled in by the platform's built-in default template, so you can start
with only `template.json` and replace one page at a time. The platform's
own pages use your template by their tier in the
[page registry](contract/registry.json): the `guarded` ones (checkout,
login, signup, forgotpassword, auth, connect, order) are drawn inside your
layout with `variant="minimal"`; the `private` one, the account area
(dashboard), takes your design tokens but not your layout.

```jsonc
// template.json
{
  "id": "acme",
  "version": "2.1.0",
  "name": "Acme",
  "format": 2,
  "contract": "2026-11",
  "toolchain": 2,
  "allowedPackages": ["@hostcore/toolkit", "react", "react-dom", "gsap"],
  "tokens": { "color.accent": "#5b8cff", "radius.md": "0.5rem" },
  "settings": [
    { "id": "hero.title", "type": "text", "label": "Headline", "max": 160, "default": "Hosting that stays out of your way" }
  ]
}
```

- `version` is three numbers, `MAJOR.MINOR.PATCH` (`2.1.0`). The platform
  publishes no other form, so a pre-release such as `2.1.0-beta` fails
  `hct validate`.
- `allowedPackages`, when present, lists the packages your source may
  import besides `@hostcore/toolkit`, `react` and `react-dom`, which any
  template may import. Each must be one the platform allows (`clsx`,
  `embla-carousel-react`, `gsap`, `react-icons`, `tailwind-merge`), and an
  import of a package it does not list fails `hct validate`. Leave it out
  to allow every package the platform allows.
- `tokens` set your values for the design tokens. Of the eight `color.*`
  ones, a colour the store has changed from the platform default overrides
  yours; a colour it has never changed shows yours, and where you set none
  the platform default applies. They reach your CSS as custom
  properties (`--hc-accent`, `--hc-radius-md`, …). See
  [`contract/README.md`](contract/README.md) for the full list.
- `settings` are what a store can edit for your template, each with a type,
  limits and a default. The standard ids (`hero.title`, `faq.items`, …)
  keep a store's values when it switches between templates that use them.
- A link's `href`, a `url` and an `image` are an `https://` URL or a path
  on the store's own site (`/domains`, never `//…`); a link's `href` may
  also be a fragment of the page (`#faq`). That is all a store can save, so
  a default in another form fails `hct validate`.

[`examples/`](examples) has a template that is only `template.json`
(`minimal`), one with a layout, three pages, settings, public files and
islands (`basic`), and a format-1 one (`legacy`).

### Pages and the layout

A page is the default export of its file and receives the page payload,
typed for that page:

```tsx
// src/pages/catalog.service.tsx
import { Link, formatInterval, useMoney, type PageProps } from '@hostcore/toolkit'

export default function Service({ data }: PageProps<'catalog.service'>) {
  const money = useMoney()
  return data.plans.map((plan) => (
    <Link key={plan.id} href={plan.checkout_url}>
      {plan.name}: {money.price(plan.price)} / {formatInterval(plan.price.interval)}
    </Link>
  ))
}
```

The layout receives `{ children, variant }` and renders `children` (or
`<Outlet/>`) exactly once, where the page goes:

```tsx
// src/layout.tsx
import { Link, asset, useNav, useStore, type LayoutProps } from '@hostcore/toolkit'

export default function Layout({ children, variant }: LayoutProps) {
  const store = useStore()
  const nav = useNav()
  return (
    <>
      <header>
        <img src={asset('images/logo.svg')} alt="" />
        <Link href={nav.links.home}>{store.name}</Link>
        {variant === 'default' && nav.groups.map((g) => <Link key={g.id} href={g.url}>{g.name}</Link>)}
        <Link href={nav.links.login}>Log in</Link>
      </header>
      <main>{children}</main>
    </>
  )
}
```

The page goes inside an `<hc-outlet>` element; add
`hc-outlet, hc-island { display: contents }` to your CSS if your layout
needs the page's elements to be direct children of their container.

### The SDK

Everything is imported from `@hostcore/toolkit`:

| | |
| --- | --- |
| `usePage('home')` | the whole payload: `page`, `meta`, `store`, `nav`, `settings`, `actions`, `data` (see Typed data in shared components) |
| `useStore()` | the store: name, logo, locale, currency, business details, theme |
| `useNav()` | the store's groups, and `links`: home, login, signup, account, domains, terms, privacy (empty when not offered) |
| `useSetting(id)` | the store's value for a setting, or the default you declared |
| `useAction(name)` | an action the page may use from the browser, or `undefined`: an endpoint to call (`domain_search`) or a page to send a visitor to (`domain_checkout`) |
| `searchDomains(action, query)` | search for domains: typed results, or a typed failure (below) |
| `actionHref(action, params)` | the href to an action with query parameters, such as checkout for a searched domain (below) |
| `useEnv()` | the build id, asset base, locale, currency and render mode |
| `<Link href>` | a link; take every `href` from the payload |
| `<Outlet/>` | where the layout puts the page |
| `asset(path)` | the URL of a file in `public/` |
| `island(Component)` | see Islands |
| `formatMoney`, `formatPrice`, `formatPricePerInterval`, `formatInterval`, `useMoney()` | prices and billing intervals |
| `PageProps<id>`, `LayoutProps`, `Contract.*` | types; `Contract` is the whole 2026-11 contract |

Your template never builds a platform URL: every link is in the payload
(`nav.links`, `group.url`, `service.url`, `plan.checkout_url`), and
`hct validate` flags a string that starts with the path of a platform page
in the [page registry](contract/registry.json), such as `"/login"`,
`"/domains"` or `` `/checkout/${slug}` ``, or with `/api`, and names the
field to use instead. A link to the home page, `"/"`, is not flagged: the
root of the store's site never moves, and `"/"` alone is more often a path
separator than a link; `useNav().links.home` is still the way to link to
it.

A link to buy a searched domain is
`actionHref(useAction('domain_checkout'), { domain, action, years })`
rather than a `/checkout/domains?…` string:

```tsx
const checkout = useAction('domain_checkout')   // absent when the store sells no domains
{checkout && <Link href={actionHref(checkout, { domain: 'acme.example', action: 'register', years: 1 })}>Register</Link>}
```

`actionHref` encodes each parameter, leaves out an `undefined` one and
adds them after any query the action's URL already has; for
`domain_checkout` the parameters are typed: `domain`, `action`
(`'register'` or `'transfer'`) and `years`, a whole number of years
offered by the search result.

### Domain search

`searchDomains(useAction('domain_search'), query)` searches and resolves to
a `DomainSearchOutcome`; it never rejects:

```tsx
const outcome = await searchDomains(useAction('domain_search'), 'acme')
if (outcome.status === 'ok') {
  for (const result of outcome.results) {
    // result.domain, result.available, result.action: 'register' | 'transfer' | 'none',
    // result.register / result.transfer / result.renew: [{ years, amount, amount_minor, currency }]
  }
} else {
  outcome.message   // outcome.code: 'invalid_query' | 'rate_limited' | 'unavailable' | 'failed'
}
```

Send a visitor to checkout for a result with
`actionHref(useAction('domain_checkout'), { domain: result.domain, action:
result.action, years })`, `years` one of that action's terms.
`examples/basic/src/islands/domain-search.tsx` does both. Never request
`actions.domain_search` yourself or read its answer: on a store page the
platform's own script makes the request, so it can change what the
endpoint takes and answers without your template changing. `hct dev` has
no such script and serves no domain search, so there `searchDomains`
makes the request itself and resolves to the error `unavailable`.

### Typed data in shared components

A page file gets its data typed through `PageProps<'catalog.service'>`. A
component it shares with other files reads the same data by naming the
page:

```tsx
// src/components/plan-list.tsx
import { usePage } from '@hostcore/toolkit'

export function PlanList() {
  const { data } = usePage('catalog.service')   // data: CatalogServiceData
  return <ul>{data.plans.map((plan) => <li key={plan.id}>{plan.name}</li>)}</ul>
}
```

`usePage('catalog.service')` types `data` as that page's data, and checks
that the page being rendered is `catalog.service` and carries its data. On
any other page, or in the layout rendered on its own, it throws an error
naming both pages, so the render fails where the mistake is rather than on
a missing field. `usePage<'catalog.service'>()` gives the same type without
the check, and `usePage()` with no page id types `data` as any page's data.

The data types are generated from the contract in
[`contract/`](contract/README.md): if a field is not in there, it is not
something your template can read. A contract version is frozen once
published; a change that would break a template ships as a new version.

### Islands

By default the browser hydrates the whole page. A page that is mostly
static can hydrate only a few components instead:

```tsx
// src/islands/faq.tsx — any component, default-exported
export default function Faq({ items }: { items: { question: string; answer: string }[] }) { … }

// src/pages/home.tsx
import { island, useSetting } from '@hostcore/toolkit'
import Faq from '../islands/faq'

export const hydrate = 'islands'
const FaqIsland = island(Faq)

export default function Home() {
  return <FaqIsland items={useSetting('faq.items')} />
}
```

Only the islands' JavaScript is downloaded, each in its own chunk, and each
island is hydrated on its own with the same hooks available. Island props
travel to the browser as JSON, so they must be strings, numbers, booleans,
null, arrays and plain objects; a function, an element or a `Date` fails the
render with an error naming the prop.

### Slots

The platform's own pages have named places where your template may put
static content: a slot. They are listed in the
[page registry](contract/registry.json) (`slots`); today there is one,
`checkout.summary`, under the order summary on the checkout pages. Fill one
with `src/slots/<slot id>.tsx`, named after the id with its dots:

```tsx
// src/slots/checkout.summary.tsx
import { useStore } from '@hostcore/toolkit'

export default function CheckoutSummary() {
  const email = useStore().business.billing_email
  return email ? <p>Questions about this order? Write to <a href={`mailto:${email}`}>{email}</a>.</p> : null
}
```

A slot is rendered on the server only and shown with no script, in a style
scope of its own with your stylesheet and design tokens. It can read the
store, the navigation and your settings (`useStore()`, `useNav()`,
`useSetting()`), never the page's data, its actions, the visitor or the
cart. `hct validate` refuses a slot id the registry does not have, and in a
slot: islands, state and effects (`useState`, `useEffect`, …), event
handlers, scripts, `usePage()` and `useAction()`. A slot may render
nothing. `hct check` renders every slot against every fixture, and `hct
dev` shows it in place on the checkout preview.

### Dependencies

```jsonc
// package.json
{
  "dependencies": {
    "@hostcore/toolkit": "github:hostcore-co/HostCore.Toolkit#v2.0.0",
    "react": "~19.3.1",
    "react-dom": "~19.3.1"
  },
  "devDependencies": {
    "vite": "^8.3.8",
    "@vitejs/plugin-react": "^6.3.0",
    "@tailwindcss/vite": "^4.3.5",   // optional
    "tailwindcss": "^4.3.5",         // optional
    "typescript": "~5.9.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0"
  }
}
```

`hct init` writes the dependency on the toolkit release that ran it.

With Tailwind, write `@import "tailwindcss" source(".");` so it scans only
your own source for class names. `gsap` and `embla-carousel-react` run only
in the browser: on the server they are inert, so start animations and
carousels in effects.

### Build output

`hct build` writes:

```
dist/manifest.json                  what is in the build, with a digest and size per file
dist/server/entry.server.cjs        renders your layout and pages on the server
dist/client/entry.client.<hash>.js  hydrates them in the browser
dist/client/chunk.<hash>.js         one per page, layout and island, loaded when needed
dist/client/assets.<hash>.css       all your CSS, with relative URLs
dist/client/**                      your public/ files
```

React is not in your bundles: the platform provides one shared copy (the
runtime, built with `hct runtime build`), which keeps a build small and
fast to load. Your packages are bundled, and the manifest's `inventory`
lists each one with its version and where it ended up. The manifest's
`build_id` is derived from its content, so the same source always gives the
same id.

### Stylesheets load only from your store

Your stylesheet is also applied to the platform's own pages, checkout and
sign-in among them, where nothing may load from another site. So every
`@import` and every `url()` (and `image-set()`) in it must be one of:

- relative: `url(images/grid.svg)`, `@import "./fonts.css"`;
- root-relative: `url(/images/grid.svg)`;
- a `data:` URI;
- a fragment: `url(#clip)`.

An absolute URL (`https://fonts.example.com/…`) or one that starts with
`//` fails. Put the file in `public/` and reference it relatively instead;
for a web font, put its font files in `public/` and declare them with
`@font-face`. `hct validate` checks your `.css` files, and `hct build` and
`hct check` check the built stylesheet too, since a package or a
preprocessor can add a URL your own CSS does not have:

```
src/styles.css:3  [stylesheet-external-url] url("https://images.example.com/hero.jpg") loads from another site. …
```

The CSS is read the way a browser reads it, so comments, quotes, escapes
and whitespace make no difference to the result. A build whose stylesheet
breaks the rule fails rather than recording it, so the manifest has no
field for it: every manifest's stylesheet stays on the store's own site.

### In the browser

The client entry hydrates the page when it loads. It also exports
`mount(part?, options?)` for a page that sets `window.__HC__.defer = true`:
`part` is `document`, `layout`, `body` or `islands`, and for `body`,
`options.root` is the element holding the page (it may be inside a shadow
root) and `options.env` the environment it was rendered with. It reports
problems with `console.error` and never throws.

### Format 1

A `template.json` without `"format": 2` is a format-1 template: one `App`
component that switches on `data.page_type` and reads contract "1" data
through `useHC()`. It builds exactly as before, with the Vite it has
installed, and `hct dev` runs its own Vite dev server as before.

### Moving to format 2

```bash
hct upgrade --dry-run      # see what it would do and what it leaves for you
hct upgrade
```

`hct upgrade` does the mechanical part:

- `template.json` gets `"format": 2`, `"contract": "2026-11"` and
  `"toolchain": 2`, and declares the standard settings your template reads;
- each page of the page switch (`switch (data.page_type)`) or page map
  (`pages[data.page_type]`) in `App` becomes `src/pages/<page-id>.tsx`;
- the markup `App` renders around the page becomes `src/layout.tsx`, with an
  `<Outlet />` where the page goes, and the rest of `App.tsx` moves to
  `src/shared.tsx`;
- data read through `useHC()`, `usePageData()`, `useStore()` and
  `useServiceGroups()` is rewritten to `usePage()`, `useStore()`, `useNav()`
  and `useSetting()` wherever the 2026-11 field holds the same value —
  `content.hero.title` becomes `useSetting('hero.title')`,
  `store.store_name` becomes `useStore().name`, `cheapest_plan` becomes
  `from`, `pricing.price` becomes `price`;
- files in `src/pages/` and `src/islands/` move to `src/views/` and
  `src/widgets/`, since format 2 reads those directories by name;
- `package.json` moves to the format-2 versions of React, Vite and the
  plugins.

Then it lists, file and line, what is left for you: every link built by
hand with the payload field to take it from (`plan.checkout_url`,
`group.url`, `useNav().links.login`, …), every data access with no
one-to-one replacement (`data.page_type`, the page data passed around
whole, a `pricing` object), the settings it declared for you to review, and
files format 2 does not use. It works in a copy of your template and swaps
it in only when the copy is complete, so a template it cannot convert is
left exactly as it was. `hct docs` writes the full field-by-field table
(`upgrading.md`).

## The commands

```
hct --help             list the commands (hct <command> --help for one)
hct --version          print the toolkit version
hct init [dir]         start a new format-2 template (--minimal, --id, --name)
hct dev [dir]          preview it against the contract fixtures (--port, --payload <file>)
hct validate [dir]     check a template against the build policy
hct check [dir]        render every page against every fixture (--dist, --runtime, --json, --budget-server, --budget-client-js, --budget-css)
hct build [dir]        validate, build, and emit a manifest (--local-paths, --media-base <url>, --out, --runtime, --sign <key>, --skip-validation, --toolchain-revision <n>)
hct push [dir]         build, then upload a new version (--listing, --tag, --changelog, --api, --org)
hct upgrade [dir]      move a format-1 template to format 2 (--dry-run)
hct docs --out <dir>   write the reference documentation
hct runtime build      build the shared React runtime (--out <dir>, --root, --sign, --toolchain-revision <n>)
hct keygen             generate a signing keypair
hct contract generate  regenerate contract/dist and the generated fixtures (--contract-dir)
hct contract check     fail when any of them is out of date, or the contract differs from its baselines (--contract-dir)
hct contract accept    record additive contract changes in the baselines (--contract-dir)
hct contract generate-go  write the Go contract into another project (--kind contract|frontend-prefixes, --package, --out)
```

`hct build` runs the policy check first, so a template that reaches for
something it cannot have fails at build time rather than at render time.
`--skip-validation` leaves the check out, for a local build only: the
platform always runs it.

`--toolchain-revision <n>` is for whoever runs builds for the platform, and
an author never needs it. A build records the toolchain it was built with
(`toolchain: { line, revision }` in `manifest.json` and `runtime.json`);
the line is the toolkit's, but the revision belongs to the environment
that installed the packages, which can move to a later revision of the
same line when a dependency is patched. The flag records that revision (a
whole number, by default this toolkit's own). It is part of what a
build's `build_id` covers; a runtime's `runtime_id` depends only on its
files, so the same runtime files on two revisions are one runtime. Your
bundle runs with no filesystem, no network and no module system other than
the shared React runtime — the check is there to tell you early, not to be
the only thing enforcing it.

Vite and the build plugins are resolved from your template's own
dependencies, not from here — you control which versions build your template.

## Developing the toolkit

```bash
bun install
bun run check
bun test
bun cli/index.ts contract check
```

`hct contract check` also compares the contract with its frozen
baselines and fails on a change that would break a template; see
[`contract/README.md`](contract/README.md#baselines). The same steps, and
validating, checking and building each example, run on every push and pull
request on both supported Bun versions
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

The examples are workspaces of this package, so `bun install` installs
their dependencies too, including the older Vite `examples/legacy` builds
with.

A release is tagged `v<version>`, with `version` from `package.json`
(`hct --version` prints it); the `#v2.0.0` in a template's dependency is
that tag, and `hct init` writes the tag of the release that ran it.
