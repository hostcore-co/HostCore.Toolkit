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

`src/types.ts` is the whole contract. It is mirrored by the platform's API and
by the rendering engine, so a change to it is a breaking change for every
published template — it moves on major versions only.

## The commands

```
hct validate [dir]     check a template against the build policy
hct build [dir]        validate, build, and emit a signed manifest
hct dev [dir]          run the template's local dev server
hct keygen             generate a signing keypair
```

`hct build` runs the policy check first, so a template that reaches for a host
capability fails at build time rather than silently at render time. The engine
runs your bundle in a realm with no filesystem, no network and no module
system, so the check is there to tell you early rather than to be the thing
standing between your template and the platform.

Vite and the build plugins are resolved from your template's own
dependencies, not from here — you control which versions build your template.

## Developing the toolkit

```bash
bun install
bun run check
bun test
```
