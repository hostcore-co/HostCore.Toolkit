/**
 * The platform's build policy for template code.
 *
 * A template is source we compile and then execute on our own
 * infrastructure, so the useful place to say no is here, at build time,
 * where a rejection is a failed build the author can read — rather than
 * at render time, where it is an outage for a store.
 *
 * These lists are owned by the platform. A template's own
 * `allowedPackages` may only narrow them, never widen them: a template
 * cannot grant itself a dependency by editing its own manifest.
 */

/**
 * Packages a template may depend on.
 *
 * Anything reaching the filesystem, the network, a child process or the
 * module system is absent by design. Adding to this list means agreeing
 * to run that package's code inside the render sandbox for every store
 * that uses it, so entries need a reason beyond convenience.
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
 * The render worker already strips these capabilities, so an import
 * would fail at runtime. Failing the build instead turns a production
 * incident into a build error with a file and line.
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
