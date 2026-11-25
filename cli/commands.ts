import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every hct command, its flags and the environment it reads. `hct --help`,
 * `hct <command> --help` and the CLI reference `hct docs` writes are all
 * printed from this table, so they cannot disagree.
 */

export interface FlagDoc {
  /** As typed, with its value: `--out <dir>`. */
  flag: string
  text: string
}

export interface CommandDoc {
  /** The command as typed: `check`, `runtime build`. */
  name: string
  usage: string
  summary: string
  /** Paragraphs for `hct <command> --help` and the reference. */
  description: string[]
  flags: FlagDoc[]
  env?: FlagDoc[]
}

/** What --toolchain-revision does, for hct build and hct runtime build. */
const TOOLCHAIN_REVISION_TEXT =
  "For the platform's builders, not authors: the revision of the toolchain line the build environment provides, a non-negative whole number recorded in the toolchain field of manifest.json (format 2) or runtime.json (default: this toolkit's revision). A build's id covers it; a runtime's id depends only on its files."

/** The source files of the template hct init writes: those of examples/basic, by kind. */
export function scaffoldFiles(): { layout: boolean; pages: string[]; islands: string[] } {
  const src = join(fileURLToPath(new URL('..', import.meta.url)), 'examples', 'basic', 'src')
  const names = (dir: string) => {
    try {
      return readdirSync(join(src, dir))
        .filter((f) => /\.(tsx|jsx|ts|js)$/.test(f))
        .map((f) => f.replace(/\.(tsx|jsx|ts|js)$/, ''))
        .sort()
    } catch {
      return []
    }
  }
  return { layout: names('').includes('layout'), pages: names('pages'), islands: names('islands') }
}

/** What hct init writes, in words: read from the scaffold itself. */
export function scaffoldContents(): string {
  const f = scaffoldFiles()
  const list = (kind: string, items: string[]) => (items.length === 0 ? [] : [`${items.length === 1 ? kind : `${kind}s`} ${items.join(', ')}`])
  return [...(f.layout ? ['a layout'] : []), ...list('page', f.pages), ...list('island', f.islands)].join('; ')
}

export const COMMANDS: readonly CommandDoc[] = [
  {
    name: 'init',
    usage: 'hct init [dir] [--minimal] [--id <id>] [--name <name>]',
    summary: 'start a new format-2 template',
    description: [
      `Writes a working format-2 template into <dir> (default: the current directory), which must be empty or not exist yet: ${scaffoldContents()}; and settings, design tokens and public files. It passes hct validate, hct check and hct build as written.`,
      'Install its dependencies (bun install) before building it.',
    ],
    flags: [
      { flag: '--minimal', text: 'Write only template.json, with design tokens, and package.json: the platform\'s default template renders every page.' },
      { flag: '--id <id>', text: 'The template id (default: from the directory name).' },
      { flag: '--name <name>', text: 'The display name (default: from the id).' },
    ],
  },
  {
    name: 'dev',
    usage: 'hct dev [dir] [--port <n>] [--payload <file>]',
    summary: 'preview a template locally against the contract fixtures',
    description: [
      'Format 2: builds the template and serves it the way the platform renders it, through its real server entry, hydrated by its real client entry. The start page lists every page id with every fixture for it; each preview of a page the template implements has a switch between the default and minimal layout variants. A page the template does not implement shows that the platform\'s default template renders all of it, header and footer included, and a platform page shows that it is the platform\'s own, with nothing of the template. The template is rebuilt and the browser reloads when a file changes.',
      'The checkout pages talk to a stand-in for the platform, so the whole flow can be taken offline: the toolbar switches the customer between signed in, with a sample profile, and signed out, and chooses how a placed order ends — on a stand-in payment page that returns to the success or cancel page, with bank transfer details, or paid at once. Quotes are priced from the fixtures, and /_dev/requests shows every request the pages sent.',
      "Format 1: runs the template's own Vite dev server, as before.",
    ],
    flags: [
      { flag: '--port <n>', text: 'Port to listen on (default 4173; 0 picks a free one).' },
      { flag: '--payload <file>', text: 'Also preview this page payload: a 2026-11 page envelope in a JSON file you write, for example a copy of a contract fixture you have changed. Fields that do not fit the contract are named in the preview.' },
    ],
  },
  {
    name: 'validate',
    usage: 'hct validate [dir]',
    summary: 'check a template against the build policy',
    description: [
      'Checks template.json, the dependencies, the files under src/ and what the source imports and reaches for. Every import must be of a package the platform allows and, when template.json declares allowedPackages, of one listed there (@hostcore/toolkit, react and react-dom need not be). Format 2 also flags hand-built platform URLs, useSetting() ids template.json does not declare, the checkout hooks and calls anywhere but the checkout pages and the files they import, pages without a layout and a layout without pages, and a src/slots/ directory (slots are no longer supported).',
      'Every stylesheet may only load files from the store\'s own site: each @import and url() must be relative, root-relative (/fonts/a.woff2), a data: URI or a fragment (#id). The stylesheet is also used on your checkout pages, where nothing may load from another site.',
    ],
    flags: [],
  },
  {
    name: 'check',
    usage: 'hct check [dir] [--dist <dir>] [--runtime <dir>] [--json] [--budget-server <size>] [--budget-client-js <size>] [--budget-css <size>]',
    summary: 'render every page against every contract fixture',
    description: [
      'Builds the template into a temporary directory, then renders every page it implements against every contract fixture for that page, as a whole document: its layout, in the minimal variant for a checkout page and the default one otherwise, with the page inside, the way the platform does before it accepts a build. A page it does not implement is rendered by the platform\'s default template and is not rendered here. A format-1 template renders every contract "1" fixture. The bundle runs in an empty context with nothing but the runtime\'s modules.',
      'Prints one line per failed render with its page, fixture and kind, then the build\'s sizes against budgets: server bundle 1 MB, client JavaScript 250 KB, stylesheet 100 KB. A build over budget is reported but still passes. Exits 0 only when every render succeeded.',
      'A page that renders nothing fails: when the page\'s own markup (the inside of the layout\'s outlet) is empty once HTML comments and whitespace are left out, as when the page component returns null, the render fails with HC_EMPTY_RENDER naming the page, fixture and variant. One element, even an empty one, or any text is enough to pass. The layout is not held to this.',
      'Before rendering, the build itself is checked: every file manifest.json lists must be in the build with the listed digest and size, and nothing else may be (format 2), and the stylesheet may not load from another site. A build that fails this is not rendered.',
      'With --json it prints only { build_id, contract, protocol, ok, results: [{ page, fixture, kind, variant, ok, html_sha256, bytes, error }], sizes: { server, client_js, css } }. variant is the layout variant of a document render. Two builds render the same when their results have the same page, fixture, kind and variant and equal html_sha256 for each. A problem with the build itself is a result of kind "build" with ok false, an empty page, fixture and variant, and an error starting HC_BUILD_FILES or HC_STYLESHEET_EXTERNAL; the report then has ok false, no render results and zero sizes.',
    ],
    flags: [
      { flag: '--dist <dir>', text: 'Check this build instead of building the template.' },
      { flag: '--runtime <dir>', text: 'Render with the runtime hct runtime build wrote to <dir> (default: build one from the React installed for the template).' },
      { flag: '--json', text: 'Print the machine-readable report only.' },
      { flag: '--budget-server <size>', text: 'Server bundle budget, in bytes or with a kb/mb suffix.' },
      { flag: '--budget-client-js <size>', text: 'Budget for all client JavaScript together.' },
      { flag: '--budget-css <size>', text: 'Stylesheet budget.' },
    ],
  },
  {
    name: 'build',
    usage: 'hct build [dir] [--local-paths | --media-base <url>] [--out <dir>] [--runtime <dir>] [--sign <base64-key>] [--skip-validation] [--toolchain-revision <n>]',
    summary: 'validate, build, and emit a manifest',
    description: [
      'Runs hct validate, then builds the template. Format 2 writes manifest.json, server/entry.server.cjs and the client files under client/; format 1 builds exactly as before, with the Vite the template has installed.',
      'The built stylesheet is checked as well, since a package or a preprocessor can add a URL your own CSS does not have: a build whose stylesheet loads anything from another site fails.',
    ],
    flags: [
      { flag: '--local-paths', text: 'Build for local use: a format-2 build gets an empty media_base, a format-1 build addresses its assets at a platform-local path and needs no $CDN_BASE_URL.' },
      { flag: '--media-base <url>', text: "Format 2: where the build's client files will be served from, recorded as the manifest's media_base. Required unless --local-paths." },
      { flag: '--out <dir>', text: 'Output directory (default: <dir>/dist).' },
      { flag: '--runtime <dir>', text: 'Format 2: build against the runtime hct runtime build wrote to <dir> instead of building it again. Its React must be the template\'s.' },
      { flag: '--sign <base64-key>', text: 'Raw base64 ed25519 private key (default: $TEMPLATE_SIGNING_PRIVATE_KEY).' },
      { flag: '--skip-validation', text: 'Build without the policy check (local only).' },
      { flag: '--toolchain-revision <n>', text: TOOLCHAIN_REVISION_TEXT },
    ],
    env: [
      { flag: 'CDN_BASE_URL', text: "Format 1: where a published template's client assets are served from. Required unless --local-paths." },
      { flag: 'TEMPLATE_SIGNING_PRIVATE_KEY', text: 'The signing key, when --sign is not given.' },
    ],
  },
  {
    name: 'push',
    usage: 'hct push [dir] --listing <id> [--tag <version>] [--changelog <text>] [--api <url>] [--org <id>]',
    summary: 'build, then upload the template as a new version',
    description: [
      "Builds the template to make sure it builds, then uploads its source (every file except node_modules/, dist/, build/ and names starting with a dot) as a new version of your marketplace listing. Prints the platform's checks and, when the build succeeded there, a preview link.",
      'A template without a package.json (one that is only template.json, for example) is uploaded without building it here, since nothing is installed to build it with. The version tag is template.json\'s version unless --tag says otherwise, and has the form 1.2.3.',
    ],
    flags: [
      { flag: '--listing <id>', text: 'The listing to add the version to (default: $HOSTCORE_LISTING).' },
      { flag: '--tag <version>', text: "The version's tag (default: template.json's version)." },
      { flag: '--changelog <text>', text: 'What changed in this version.' },
      { flag: '--api <url>', text: 'The platform API origin (default: $HOSTCORE_API_URL).' },
      { flag: '--org <id>', text: 'The organisation to act for, when you are in more than one (default: $HOSTCORE_ORG).' },
    ],
    env: [
      { flag: 'HOSTCORE_API_URL', text: 'The platform API origin, such as https://api.example.com.' },
      { flag: 'HOSTCORE_TOKEN', text: 'Your access token, sent as a bearer token. Read from the environment only, so it stays out of your shell history.' },
      { flag: 'HOSTCORE_LISTING', text: 'The listing id, when --listing is not given.' },
      { flag: 'HOSTCORE_ORG', text: 'The organisation id, when --org is not given.' },
    ],
  },
  {
    name: 'upgrade',
    usage: 'hct upgrade [dir] [--dry-run]',
    summary: 'move a format-1 template to format 2',
    description: [
      "Converts what has a one-to-one mapping: template.json gets format, contract and toolchain; each page of App's page switch or page map becomes src/pages/<page-id>.tsx; markup around the page becomes src/layout.tsx with an <Outlet/>; data access is renamed to the format-2 hooks and fields; the standard settings the template reads are declared; package.json moves to the format-2 dependency ranges.",
      'Then prints what is left for you: every hand-built platform URL with the payload field to use instead, every data access with no one-to-one mapping, and every setting to review. The work happens in a copy that replaces the template only when it is complete, so a failure leaves the template as it was.',
    ],
    flags: [{ flag: '--dry-run', text: 'Print the plan and what would be left, and change nothing.' }],
  },
  {
    name: 'docs',
    usage: 'hct docs --out <dir>',
    summary: 'write the reference documentation as Markdown',
    description: [
      'Writes the reference generated from the contract and the page registry: pages and their data, every type and field of contract 2026-11, the standard settings and setting types, the design tokens, the SDK, these commands, and what changed from contract 1.',
    ],
    flags: [{ flag: '--out <dir>', text: 'Where to write the pages.' }],
  },
  {
    name: 'runtime build',
    usage: 'hct runtime build --out <dir> [--root <dir>] [--sign <base64-key>] [--toolchain-revision <n>]',
    summary: 'build the shared React runtime format-2 builds use',
    description: [
      'Writes server.cjs, the browser modules client bundles import by bare name, and runtime.json. The same installed packages always give the same files and runtime_id.',
    ],
    flags: [
      { flag: '--out <dir>', text: 'Where to write the runtime.' },
      { flag: '--root <dir>', text: 'Where react and vite are resolved from (default: the current directory).' },
      { flag: '--sign <base64-key>', text: 'Sign runtime.json (default: $TEMPLATE_SIGNING_PRIVATE_KEY).' },
      { flag: '--toolchain-revision <n>', text: TOOLCHAIN_REVISION_TEXT },
    ],
  },
  {
    name: 'keygen',
    usage: 'hct keygen',
    summary: 'generate a signing keypair',
    description: ['Prints a new ed25519 keypair as raw base64, the form --sign takes.'],
    flags: [],
  },
  {
    name: 'contract',
    usage: 'hct contract generate | check | accept | generate-go …',
    summary: 'generate and check the page contract (toolkit development)',
    description: [
      'hct contract generate [--contract-dir <dir>] rewrites contract/dist, the contract "1" fixtures and the rule tables (fixtures/links.json, fixtures/tokens.json). hct contract check fails when any of them is out of date, and compares each contract version with its frozen baseline in contract/baselines/ (what a template can observe: types and fields, enum values, pages and their paths and tiers, actions, tokens, standard settings and the link rule). A breaking difference fails with what changed and the advice that it needs a new contract version with a downgrade; an additive one fails until hct contract accept records it in the baseline, so the change is reviewed as a diff of that file. hct contract generate-go --kind contract|frontend-prefixes --package <name> --out <path> writes Go source into another project.',
    ],
    flags: [
      { flag: '--contract-dir <dir>', text: 'The contract directory (default: the one in this toolkit).' },
      { flag: '--kind <kind>', text: 'generate-go: contract or frontend-prefixes.' },
      { flag: '--package <name>', text: 'generate-go: the Go package name.' },
      { flag: '--out <path>', text: 'generate-go: the directory or file to write.' },
    ],
  },
]

/** Flags that never take a value, so a positional argument after one is not swallowed as its value. */
export const BOOLEAN_FLAGS = new Set(['local-paths', 'skip-validation', 'json', 'minimal', 'dry-run', 'help'])

function wrap(text: string, width: number, indent: string): string {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line !== '' && line.length + 1 + word.length > width) {
      out.push(indent + line)
      line = word
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  if (line !== '') out.push(indent + line)
  return out.join('\n')
}

/** `hct --help`. */
export function overviewHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length))
  return [
    'hct — the HostCore template toolchain',
    '',
    'Usage: hct <command> [options]     hct <command> --help for its options',
    '       hct --version                print the toolkit version',
    '',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    'Writing a template: hct init, then hct dev while you work, hct check before',
    'you publish, and hct push to upload a version. hct upgrade moves a format-1',
    'template to format 2.',
    '',
  ].join('\n')
}

export function findCommand(name: string): CommandDoc | undefined {
  return COMMANDS.find((c) => c.name === name)
}

/** `hct <command> --help`. */
export function commandHelp(command: CommandDoc): string {
  const lines = [`Usage: ${command.usage}`, '']
  for (const paragraph of command.description) lines.push(wrap(paragraph, 76, ''), '')
  if (command.flags.length > 0) {
    lines.push('Options:')
    for (const f of command.flags) lines.push(`  ${f.flag}`, wrap(f.text, 72, '      '))
    lines.push('')
  }
  if (command.env && command.env.length > 0) {
    lines.push('Environment:')
    for (const e of command.env) lines.push(`  ${e.flag}`, wrap(e.text, 72, '      '))
    lines.push('')
  }
  return lines.join('\n')
}

export type Flags = Record<string, string | boolean>

/** A mistake in how a command was called, or a condition it cannot work in: printed as it is, without a stack. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

export function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name]
  if (value === true) throw new CommandError(`--${name} needs a value`)
  return typeof value === 'string' ? value : undefined
}

/**
 * Runs `work` with console.log and console.info written to stderr, so that
 * nothing a build prints reaches stdout while stdout is machine-readable.
 */
export async function quietStdout<T>(work: () => Promise<T>): Promise<T> {
  const { log, info } = console
  console.log = (...args: unknown[]) => console.error(...args)
  console.info = (...args: unknown[]) => console.error(...args)
  try {
    return await work()
  } finally {
    console.log = log
    console.info = info
  }
}
