# HostCore Toolkit

Everything you need to write a storefront template for HostCore: the data
contract your components are written against, and the toolchain that turns
them into a bundle the platform will run.

```bash
bun add github:hostcore-co/HostCore.Toolkit#v1.0.0
```

That gives you both — `@hostcore/toolkit` to import from, and `hct` to build
with.

## Writing a template

A template is a directory with a `template.json` and, optionally, React
components for the parts of the storefront you want to look different:

```
template.json
src/layout.tsx              the header, footer and frame around every page
src/pages/<page-id>.tsx     one file per page: home, catalog.group,
                            catalog.service, domains, not-found
src/islands/<name>.tsx      components hydrated on their own (see Islands)
public/                     fonts, images and other files, served as they are
```

Every file under `src/` is optional. A page you leave out, or the layout,
is filled in by the platform's built-in default template, so you can start
with only `template.json` and replace one page at a time. The platform's
own pages (checkout, login, the account area) are drawn inside your layout
with `variant="minimal"`.

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

- `tokens` set your defaults for the design tokens; the store's own colours
  override the eight `color.*` ones. They reach your CSS as custom
  properties (`--hc-accent`, `--hc-radius-md`, …). See
  [`contract/README.md`](contract/README.md) for the full list.
- `settings` are what a store can edit for your template, each with a type,
  limits and a default. The standard ids (`hero.title`, `faq.items`, …)
  keep a store's values when it switches between templates that use them.

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
| `usePage<'home'>()` | the whole payload: `page`, `meta`, `store`, `nav`, `settings`, `actions`, `data` |
| `useStore()` | the store: name, logo, locale, currency, business details, theme |
| `useNav()` | the store's groups, and `links`: home, login, signup, account, domains, terms, privacy (empty when not offered) |
| `useSetting(id)` | the store's value for a setting, or the default you declared |
| `useAction(name)` | an endpoint the page may call from the browser, such as `domain_search`, or `undefined` |
| `useEnv()` | the build id, asset base, locale, currency and render mode |
| `<Link href>` | a link; take every `href` from the payload |
| `<Outlet/>` | where the layout puts the page |
| `asset(path)` | the URL of a file in `public/` |
| `island(Component)` | see Islands |
| `formatMoney`, `formatPrice`, `formatPricePerInterval`, `formatInterval`, `useMoney()` | prices and billing intervals |
| `PageProps<id>`, `LayoutProps`, `Contract.*` | types; `Contract` is the whole 2026-11 contract |

Your template never builds a platform URL: every link is in the payload
(`nav.links`, `group.url`, `service.url`, `plan.checkout_url`), and
`hct validate` flags strings such as `"/login"` or `` `/checkout/${slug}` ``
with the field to use instead.

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

### Dependencies

```jsonc
// package.json
{
  "dependencies": {
    "@hostcore/toolkit": "github:hostcore-co/HostCore.Toolkit#<commit>",
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

### Format 1

A `template.json` without `"format": 2` is a format-1 template: one `App`
component that switches on `data.page_type` and reads contract "1" data
through `useHC()`. It builds exactly as before, with the Vite it has
installed.

## The commands

```
hct validate [dir]     check a template against the build policy
hct build [dir]        validate, build, and emit a manifest (--local-paths, --media-base <url>, --sign <key>)
hct runtime build      build the shared React runtime (--out <dir>)
hct dev [dir]          run the template's local dev server
hct keygen             generate a signing keypair
hct contract generate  regenerate contract/dist from the contract definitions
hct contract check     fail when contract/dist is out of date
```

`hct build` runs the policy check first, so a template that reaches for
something it cannot have fails at build time rather than at render time. Your
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

The examples are workspaces of this package, so `bun install` installs
their dependencies too, including the older Vite `examples/legacy` builds
with.
