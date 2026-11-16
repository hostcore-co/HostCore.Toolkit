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

Your template is a Vite + React project that exports a page component per page
type. `useHC()` hands you the data the platform renders it with:

```tsx
import { useHC, type HomePageData } from '@hostcore/toolkit'

export function HomePage() {
  const { data } = useHC<HomePageData>()
  return <h1>{data.content.hero.title}</h1>
}
```

The types are generated from the contract in [`contract/`](contract/README.md)
— if a field is not in there, it is not something your template can read. A
contract version is frozen once published: a change that would break a
template ships as a new version instead, and templates written against the
old one keep receiving exactly what they were written against.

## The commands

```
hct validate [dir]     check a template against the build policy
hct build [dir]        validate, build, and emit a signed manifest
hct dev [dir]          run the template's local dev server
hct keygen             generate a signing keypair
hct contract generate  regenerate contract/dist from the contract definitions
hct contract check     fail when contract/dist is out of date
```

`hct build` runs the policy check first, so a template that reaches for
something it cannot have fails at build time rather than at render time. Your
bundle runs with no filesystem, no network and no module system — the check is
there to tell you early, not to be the only thing enforcing it.

Vite and the build plugins are resolved from your template's own
dependencies, not from here — you control which versions build your template.

## Developing the toolkit

```bash
bun install
bun run check
bun test
bun cli/index.ts contract check
```
