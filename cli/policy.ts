import { PAGES } from '../contract/dist/ts/registry'

/**
 * What a template is allowed to contain.
 *
 * Your template is compiled and then run on shared infrastructure, so these
 * limits are checked at build time, where a rejection is a build error you
 * can read and fix. The alternative is finding out at render time, which is
 * a broken storefront.
 *
 * A template's own `allowedPackages` in template.json narrows the packages
 * its source may import but never widens them: every package it lists must
 * be on PLATFORM_ALLOWED_PACKAGES, and when it declares the key, an import
 * of anything else outside SDK_PACKAGES fails validation.
 */

/**
 * Packages a template may depend on.
 *
 * Anything that reaches the filesystem, the network, a child process or the
 * module system is absent by design — none of it would work at render time
 * anyway. If you need something that is not here, ask rather than vendor it:
 * a copy inside your template fails the source scan for the same reasons.
 */
export const PLATFORM_ALLOWED_PACKAGES: readonly string[] = [
  '@hostcore/toolkit',
  'react',
  'react-dom',
  // Presentation-only libraries. None of them touch host capabilities.
  'clsx',
  'embla-carousel-react',
  'gsap',
  'react-icons',
  'tailwind-merge',
]

/**
 * Packages every template may import whether or not its `allowedPackages`
 * lists them: the SDK, and the React the platform provides to every build
 * (JSX alone imports React).
 */
export const SDK_PACKAGES: readonly string[] = ['@hostcore/toolkit', 'react', 'react-dom']

/**
 * Packages allowed as devDependencies — the build toolchain. These run
 * in the build container, never in the render sandbox, so the bar is
 * lower, but the list is still closed.
 */
export const PLATFORM_ALLOWED_DEV_PACKAGES: readonly string[] = [
  '@hostcore/cli',
  '@hostcore/toolkit',
  '@tailwindcss/vite',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  'tailwindcss',
  'typescript',
  'vite',
]

/**
 * Module specifiers a template may not import.
 *
 * None of these exist where your template runs, so an import would fail at
 * render time. Failing the build instead turns a broken storefront into a
 * build error with a file and a line.
 */
export const BANNED_IMPORT_PREFIXES: readonly string[] = [
  'node:',
  'bun:',
  'fs',
  'path',
  'os',
  'child_process',
  'worker_threads',
  'http',
  'https',
  'net',
  'dgram',
  'tls',
  'crypto',
  'vm',
  'module',
  'process',
  'cluster',
  'inspector',
  'v8',
  'perf_hooks',
]

export interface BannedPattern {
  readonly id: string
  readonly pattern: RegExp
  readonly reason: string
}

/**
 * Source patterns that are rejected outright.
 *
 * Deliberately conservative, and matched on source text: these are
 * constructs with no legitimate use in a storefront template, so a false
 * positive is a template doing something worth a conversation.
 */
export const BANNED_PATTERNS: readonly BannedPattern[] = [
  {
    id: 'eval',
    pattern: /\beval\s*\(/,
    reason: 'eval() executes code the build never saw and cannot check',
  },
  {
    id: 'new-function',
    pattern: /\bnew\s+Function\s*\(/,
    reason: 'new Function() executes code the build never saw and cannot check',
  },
  {
    id: 'require',
    pattern: /(^|[^.\w])require\s*\(/,
    reason: 'runtime module loading is not available in the render sandbox',
  },
  {
    id: 'dynamic-import',
    pattern: /\bimport\s*\(\s*[^'"\s)]/,
    reason:
      'import() with a computed specifier cannot be resolved at build time',
  },
  {
    id: 'process',
    pattern: /(^|[^.\w])process\s*(\.|\[)/,
    reason:
      'the render sandbox exposes no process object; use page data instead',
  },
  {
    id: 'global-escape',
    pattern: /\bglobalThis\s*\[/,
    reason: 'computed access to globals is used to work around the sandbox',
  },
  {
    id: 'constructor-escape',
    pattern: /\.constructor\s*\(\s*['"`]/,
    reason:
      'reaching Function through .constructor is a sandbox escape, not a feature',
  },
]

/** Files the validator reads. */
export const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs}'

/** Stylesheets the validator reads. */
export const STYLESHEET_GLOB = '**/*.css'

/**
 * Packages that only do anything in a browser. In a format-2 server build
 * each is replaced by an inert stand-in that is safe to call during a server
 * render (see stubs.ts), so none of their code is in the server bundle. The
 * browser build gets the real package.
 */
export const CLIENT_ONLY_PACKAGES: readonly string[] = ['embla-carousel-react', 'gsap']

/**
 * The modules a format-2 server bundle receives from the shared runtime
 * instead of carrying its own copy. A server bundle may require these and
 * nothing else.
 */
export const RUNTIME_SERVER_MODULES: readonly string[] = ['react', 'react/jsx-runtime', 'react-dom/server']

/**
 * The modules a format-2 browser bundle imports by bare name. The page maps
 * each one to the shared runtime's copy with an import map.
 */
export const RUNTIME_CLIENT_MODULES: readonly string[] = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

export interface PlatformUrlRule {
  /** The path a hand-built URL starts with, such as `/checkout`. */
  readonly path: string
  /** Where the URL comes from instead, or null when the page data has no link to the page. */
  readonly use: string | null
}

/** Where a template takes the link to each platform page it may link to. */
const PAGE_LINKS: Readonly<Record<string, string>> = {
  domains: "useNav().links.domains, which is empty when the store sells no domains",
  checkout: "a plan's checkout_url, or service.url for a card (it already points at checkout for a single-plan service)",
  login: 'useNav().links.login',
  signup: 'useNav().links.signup',
  dashboard: 'useNav().links.account',
}

/**
 * Platform URLs a format-2 template must not write by hand: the path of
 * every page in the page registry that has a fixed path, so a page added to
 * the registry is covered too, `/checkout/domains`, where a searched domain
 * is bought through actionHref and the domain_checkout action, and `/api`,
 * whose endpoints come from useAction(name). A link a template needs is in
 * the page payload, so a template that takes it from there keeps working if
 * the platform moves the page; a page the payload has no link to is not one
 * a template links to. A string matches the longest path it starts with.
 *
 * The home page, `/`, is not among them. Its path is the root of the
 * store's site and does not move, and a string that is only "/" is far more
 * often a path separator than a link; `useNav().links.home` is still the
 * way to link to it.
 */
export const PLATFORM_URL_RULES: readonly PlatformUrlRule[] = [
  ...PAGES.filter((p) => p.path !== null && p.path !== '/' && !p.path.includes('{')).map((p) => ({
    path: p.path!,
    use: PAGE_LINKS[p.id] ?? null,
  })),
  { path: '/checkout/domains', use: "actionHref(useAction('domain_checkout'), { domain, action, years })" },
  { path: '/api', use: 'useAction(name), whose url is the endpoint to call' },
]

const PLATFORM_URL = new RegExp(
  `(['"\`])(${[...PLATFORM_URL_RULES].sort((a, b) => b.path.length - a.path.length).map((r) => r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=[/?#'"\`$]|$)`,
  'g',
)

/**
 * The hand-built platform URLs in one line of source: each string that
 * starts with the path of a rule, followed by the end of the string or by
 * `/`, `?`, `#` or `${`.
 */
export function platformUrlsIn(line: string): PlatformUrlRule[] {
  return [...line.matchAll(PLATFORM_URL)].map((m) => PLATFORM_URL_RULES.find((r) => r.path === m[2])!)
}

/** What to do instead of writing a rule's URL by hand. */
export function platformUrlAdvice(rule: PlatformUrlRule): string {
  return rule.use === null
    ? 'the page data has no link to this platform page, so a template does not link to it'
    : `take it from the page data instead: ${rule.use}`
}
