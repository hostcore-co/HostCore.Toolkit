import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { contract202611 } from '../contract/src/contract-2026-11'
import type { Contract, Definition, Field, Schema } from '../contract/src/dsl'
import { TOOLKIT_CONTRACT_DIR } from '../contract/src/generate'
import { normaliseRegistry, readRegistry } from '../contract/src/registry'
import { SETTING_SCALAR_TYPES, SETTING_TYPES, STANDARD_SETTINGS, type SettingSchemaEntry, type SettingType } from '../contract/src/settings'
import { PLATFORM_THEME, TOKEN_PATTERNS, TOKENS, type ThemeKey } from '../contract/src/tokens'
import { COMMANDS, CommandError, stringFlag, type Flags } from './commands'
import { platformPageChrome, platformPagesSentence, type PlatformPageChrome } from './sources'
import { FIELD_MOVES, HOOK_MOVES, NEW_IN_2026_11 } from './legacy-map'
import { PLATFORM_URL_RULES } from './policy'

/**
 * hct docs — the reference documentation, generated from the contract, the
 * page registry, the setting and token rules, the SDK table below and the
 * command table. The same toolkit always writes the same bytes.
 */

// ─── The SDK ──────────────────────────────────────────────────────────────

export interface SdkEntry {
  name: string
  kind: 'hook' | 'component' | 'function' | 'type'
  signature: string
  text: string
}

/**
 * Everything a format-2 template imports from `@hostcore/toolkit`. A test
 * checks that every value the SDK exports for format 2 is listed here.
 */
export const SDK: readonly SdkEntry[] = [
  { name: 'usePage', kind: 'hook', signature: "usePage('catalog.service'): Page", text: "The whole page payload: page (id and params), meta, store, nav, settings, actions and data. Name the page for typed data: usePage('catalog.service') throws when the current page is another one or carries no data, so a shared component can rely on its data; usePage<'catalog.service'>() gives the same type without the check." },
  { name: 'useStore', kind: 'hook', signature: 'useStore(): Store', text: "The store: name, domain, logo, favicon, locale, currency, business details and theme." },
  { name: 'useNav', kind: 'hook', signature: 'useNav(): Nav', text: "The store's groups and links: home, login, signup, account, domains, terms and privacy. A link the store does not offer is \"\"." },
  { name: 'useSetting', kind: 'hook', signature: "useSetting(id): value", text: 'The store\'s value for a setting your template.json declares, or the default you declared. Typed for the standard settings.' },
  { name: 'useAction', kind: 'hook', signature: "useAction('domain_search'): Action | undefined", text: 'An action the page may use from the browser, as { method, url }: an endpoint to call (domain_search) or a page to send a visitor to (domain_checkout, with actionHref); undefined when the store does not offer it.' },
  { name: 'useEnv', kind: 'hook', signature: 'useEnv(): Env', text: 'The build id, the asset base, the locale, the currency and the render mode (document or composed).' },
  { name: 'useMoney', kind: 'hook', signature: 'useMoney(): { money, price, pricePerInterval }', text: "Formatters bound to the store's locale and currency." },
  { name: 'Link', kind: 'component', signature: '<Link href={…}>', text: 'A link. Take every href from the payload: nav.links, group.url, service.url, plan.checkout_url.' },
  { name: 'Outlet', kind: 'component', signature: '<Outlet/>', text: 'Where the layout puts the page; render it (or children) exactly once. It renders an <hc-outlet> element.' },
  { name: 'searchDomains', kind: 'function', signature: "searchDomains(useAction('domain_search'), query): Promise<DomainSearchOutcome>", text: "Searches for domains and resolves to { status: 'ok', results, currency } or { status: 'error', code, message }; it never rejects. Each result has the domain, whether it is available, the action a visitor can take (register, transfer or none) and the terms and prices of each action. On a store page the platform's own script makes the request, so its wire format can change without a new template." },
  { name: 'actionHref', kind: 'function', signature: "actionHref(useAction('domain_checkout')!, { domain, action: 'register', years: 1 }): string", text: "The href that sends a visitor to an action with query parameters, such as checkout for a domain they searched: each name and value encoded, undefined values left out, after any query the action's url has. The parameters of domain_checkout are typed: domain, action (register or transfer) and years." },
  { name: 'asset', kind: 'function', signature: "asset('images/logo.svg'): string", text: 'The URL of a file in public/, wherever the build is served from.' },
  { name: 'island', kind: 'function', signature: 'island(Component): Component', text: 'Makes the default export of a file in src/islands/ hydrate on its own on a page that sets export const hydrate = "islands". Its props must be JSON values.' },
  { name: 'formatMoney', kind: 'function', signature: "formatMoney(9.5, 'USD', 'en'): '$9.50'", text: 'Formats an amount in major units.' },
  { name: 'formatPrice', kind: 'function', signature: 'formatPrice(price, locale?): string', text: 'Formats a plan price for one billing cycle.' },
  { name: 'formatInterval', kind: 'function', signature: "formatInterval('month', 'short'): 'mo'", text: 'Words a billing interval: long (month), short (mo) or adverb (monthly).' },
  { name: 'formatPricePerInterval', kind: 'function', signature: 'formatPricePerInterval(price, locale?): \'$9.50/mo\'', text: 'A price with its interval.' },
  { name: 'PageProps', kind: 'type', signature: "PageProps<'home'>", text: 'What a page file\'s default export receives: { page, data }.' },
  { name: 'LayoutProps', kind: 'type', signature: 'LayoutProps', text: "What src/layout.tsx's default export receives: { children, variant }. variant is default on the storefront pages and minimal on the platform's guarded pages, such as checkout and sign-in." },
  { name: 'Contract', kind: 'type', signature: 'Contract.Plan, Contract.Group, …', text: 'Every type of contract 2026-11, as a namespace.' },
  { name: 'Env', kind: 'type', signature: 'Env', text: 'What useEnv() returns.' },
  { name: 'StandardSettingValues', kind: 'type', signature: 'StandardSettingValues', text: 'The value type of each standard setting, by id.' },
]

/** Format-1 exports, kept for templates that have not moved to format 2. */
export const SDK_FORMAT1: readonly string[] = ['useHC', 'useServiceGroups', 'usePageData', 'HCContext']

// ─── Helpers ──────────────────────────────────────────────────────────────

function anchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** A Markdown table. Every column has a heading. */
function table(header: string[], rows: string[][]): string {
  if (header.some((h) => h.trim() === '')) throw new Error(`a table heading is empty: ${JSON.stringify(header)}`)
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
}

function code(text: string): string {
  return `\`${text}\``
}

function typeOf(schema: Schema, page = ''): string {
  switch (schema.kind) {
    case 'string':
      return schema.pattern ? `string matching ${code(schema.pattern)}` : 'string'
    case 'number':
      return 'number'
    case 'integer':
      return 'integer'
    case 'boolean':
      return 'boolean'
    case 'literal':
      return code(JSON.stringify(schema.value))
    case 'enum':
      return schema.values.map((v) => code(JSON.stringify(v))).join(' or ')
    case 'array':
      return `array of ${typeOf(schema.items, page)}`
    case 'nullable':
      return `${typeOf(schema.inner, page)} or ${code('null')}`
    case 'record':
      return `object of ${typeOf(schema.values, page)} by key`
    case 'ref':
      return `[${schema.name}](${page}#${anchor(schema.name)})`
    case 'union':
      return Object.values(schema.variants).map((v) => `[${v}](${page}#${anchor(v)})`).join(' or ')
    case 'json':
      return 'any JSON value'
    case 'page-id':
      return 'page id'
    case 'page-data':
      return 'the data of the page (see [Pages](pages.md))'
    case 'object':
      return 'object'
  }
}

/**
 * Every type and field of a contract that has no description. The reference
 * is written for authors, so `hct docs` refuses to write a page with a gap.
 */
export function missingDescriptions(contract: Contract): string[] {
  const missing: string[] = []
  for (const def of contract.definitions) {
    if (!def.doc.trim()) missing.push(def.name)
    if (def.schema.kind !== 'object') continue
    for (const [key, field] of Object.entries(def.schema.fields)) {
      if (!field.doc?.trim()) missing.push(`${def.name}.${key}`)
    }
  }
  return missing
}

// ─── Pages ────────────────────────────────────────────────────────────────

function fixtureNames(contractDir: string): Record<string, string[]> {
  const dir = join(contractDir, 'fixtures', contract202611.version)
  const byPage: Record<string, string[]> = {}
  const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
  for (const file of names.map((n) => `${n}.json`)) {
    const id = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { page: { id: string } }).page.id
    ;(byPage[id] ??= []).push(file.replace(/\.json$/, ''))
  }
  return byPage
}

const PLATFORM_CHROME_DOCS: Record<PlatformPageChrome, string> = {
  'minimal-layout': 'your layout, `variant="minimal"`, and your design tokens',
  tokens: 'your design tokens, no layout',
  none: 'nothing',
}

function pagesPage(contractDir: string): string {
  const registry = normaliseRegistry(readRegistry(contractDir))
  const fixtures = fixtureNames(contractDir)
  const engine = registry.pages.filter((p) => p.upstream === 'engine')
  const platform = registry.pages.filter((p) => p.upstream !== 'engine')
  const out = [
    '# Pages',
    '',
    'Every page a store\'s domain serves. A template implements the storefront pages, one file each in `src/pages/<page id>.tsx`; a page it leaves out is rendered by the platform\'s default template. It may also implement the checkout pages (below); one it leaves out is the platform\'s own checkout page. ' + platformPagesSentence(code),
    '',
    '## Pages a template implements',
    '',
    table(
      ['page id', 'path', 'tier', 'data', 'cache', 'fixtures'],
      engine.map((p) => [
        code(p.id),
        p.paths.length === 0 ? 'no path; shown for any path no page matches' : p.paths.map(code).join(' and '),
        p.tier,
        `[${contract202611.pages[p.id]}](contract-2026-11.md#${anchor(contract202611.pages[p.id]!)})`,
        p.cache ? `fresh ${p.cache.ttl} s, stale up to ${p.cache.swr} s` : '',
        (fixtures[p.id] ?? []).map(code).join(', '),
      ]),
    ),
    '',
    'Every page receives a [PageEnvelope](contract-2026-11.md#pageenvelope); `data` has the type in the table. Paths with `{group}`, `{service}` and `{plan}` take the slugs, and `page.params` carries them.',
    '',
    '### Checkout pages',
    '',
    `The pages of the \`checkout\` tier (${engine.filter((p) => p.tier === 'checkout').map((p) => code(p.id)).join(', ')}) are the order flow. Each is rendered from a store's template when the template implements it and the platform has turned the template's checkout on for the store, and otherwise by the platform's own checkout page, as the registry's \`fallback\` says. A checkout page is drawn inside your layout in its \`minimal\` variant.`,
    '',
  ]
  for (const p of engine) {
    const type = contract202611.definitions.find((d) => d.name === contract202611.pages[p.id])!
    out.push(`### ${p.id}`, '', `${type.name} ${type.doc}`, '')
    if (type.schema.kind === 'object' && Object.keys(type.schema.fields).length > 0) {
      out.push(fieldTable(type.schema.fields, `contract-${contract202611.version}.md`), '')
    }
    if (p.requires === 'domains') out.push('Served only when the store sells domains (`nav.links.domains` is not `""`).', '')
  }
  out.push(
    '## Platform pages',
    '',
    table(
      ['page id', 'path', 'who sees it', 'what it shows of your template'],
      platform.map((p) => [code(p.id), `${code(p.path ?? '')} and below`, p.tier, PLATFORM_CHROME_DOCS[platformPageChrome(p.tier)]]),
    ),
    '',
    '## Slots',
    '',
    'A slot is a named place on a page the platform renders where your template may put static content of its own. Put it in `src/slots/<slot id>.tsx`, named after the slot id with its dots. It is rendered on the server only and shown with no script, in a style scope of its own with your stylesheet and design tokens; it can read the store, the navigation and your settings, never the page\'s data, the visitor or the cart. It may render nothing.',
    '',
    table(
      ['slot id', 'file', 'page', 'where it appears'],
      registry.slots.map((slot) => [code(slot.id), code(`src/slots/${slot.id}.tsx`), code(slot.page), slot.description]),
    ),
    '',
    `## Reserved slugs`,
    '',
    'A store cannot give a new group one of these names: each is the path of a platform page, or kept for one to come. Matching a path is another matter: a group path never captures the first segment of a page in the registry, and captures any other name.',
    '',
    registry.reserved_slugs.map(code).join(', '),
    '',
  )
  return out.join('\n')
}

// ─── Contract ─────────────────────────────────────────────────────────────

function fieldTable(fields: Record<string, Field>, page = ''): string {
  return table(
    ['field', 'type', 'description'],
    Object.entries(fields).map(([key, f]) => [code(key), `${typeOf(f.schema, page)}${f.optional ? ' (may be absent)' : ''}`, f.doc ?? '']),
  )
}

function definitionSection(def: Definition): string {
  const out = [`## ${def.name}`, '', `${def.name} ${def.doc}`, '']
  const schema = def.schema
  if (schema.kind === 'object') {
    if (schema.base) out.push(`It has every field of [${schema.base}](#${anchor(schema.base)}).`, '')
    out.push(Object.keys(schema.fields).length > 0 ? fieldTable(schema.fields) : 'It has no fields.', '')
  } else if (schema.kind === 'enum') {
    out.push(`One of ${schema.values.map((v) => code(JSON.stringify(v))).join(', ')}.`, '')
    if (schema.open) out.push(`An open set: any other string may arrive. Contracts that do not know a value receive ${code(JSON.stringify(schema.open.fallback))} in its place.`, '')
  } else {
    out.push(`A ${typeOf(schema)}.`, '')
  }
  return out.join('\n')
}

function contractPage(): string {
  const missing = missingDescriptions(contract202611)
  if (missing.length > 0) {
    throw new CommandError(`contract ${contract202611.version} has no description for: ${missing.join(', ')}`)
  }
  return [
    `# Contract ${contract202611.version}`,
    '',
    'The data a format-2 template is rendered with. Every page receives a [PageEnvelope](#pageenvelope) whose `data` depends on the page id ([Pages](pages.md)). A field is never renamed, retyped or removed within a contract version; new fields may appear, so ignore keys you do not know.',
    '',
    '## Types',
    '',
    contract202611.definitions.map((d) => `- [${d.name}](#${anchor(d.name)})`).join('\n'),
    '',
    ...contract202611.definitions.map(definitionSection),
  ].join('\n')
}

// ─── Settings ─────────────────────────────────────────────────────────────

/** What a value of each setting type is, and the keys an entry of that type takes. */
export const SETTING_TYPE_DOCS: Readonly<Record<SettingType, { value: string; keys: string }>> = {
  text: { value: 'a string on one line', keys: '`max`: characters' },
  textarea: { value: 'a string that may span lines', keys: '`max`: characters' },
  url: { value: 'a URL, as a string, in a form the link rule accepts', keys: '`max`: characters' },
  link: { value: '`{ label, href }`, two strings; the href is in a form the link rule accepts', keys: '`max`: characters of the label, and of the href unless `href_max` is set; `href_max`: characters of the href' },
  color: { value: 'a colour, `#rgb` or `#rrggbb`', keys: 'none' },
  boolean: { value: '`true` or `false`', keys: 'none' },
  number: { value: 'a number', keys: '`min`, `max`: the smallest and largest value; `step`: the increment, counted from `min` (or zero)' },
  select: { value: 'the `value` of one of its options', keys: '`options`: `[{ value, label }]`, at least one' },
  image: { value: 'an image URL, as a string, in a form the link rule accepts', keys: '`max`: characters' },
  list: { value: 'an array of values of one type', keys: `\`of\`: the item type, one of ${SETTING_SCALAR_TYPES.map(code).join(', ')} (default \`text\`); \`max\`: entries; \`item_max\`: characters of each text item` },
  'object-list': { value: 'an array of objects with the same fields', keys: '`fields`: `[{ id, type, label?, description?, max?, min?, step? }]`, each field taking the keys of its type; `max`: entries' },
}

function limits(s: SettingSchemaEntry): string {
  const parts: string[] = []
  if (s.type === 'link') {
    if (s.max !== undefined) parts.push(`label ${s.max}`)
    if (s.href_max !== undefined) parts.push(`href ${s.href_max}`)
  } else if (s.type === 'list' || s.type === 'object-list') {
    if (s.max !== undefined) parts.push(`${s.max} entries`)
    if (s.item_max !== undefined) parts.push(`${s.item_max} characters each`)
  } else if (s.max !== undefined) {
    parts.push(`${s.max} characters`)
  }
  for (const f of s.fields ?? []) if (f.max !== undefined) parts.push(`${f.id} ${f.max}`)
  return parts.join(', ')
}

function settingsPage(): string {
  for (const type of SETTING_TYPES) {
    if (!SETTING_TYPE_DOCS[type]) throw new CommandError(`setting type ${type} has no description`)
  }
  return [
    '# Settings',
    '',
    'Settings are what a store can edit for your template. Declare each one in `template.json` `settings`, read it with `useSetting(id)`, and the store\'s value (or your default) arrives in the page payload\'s `settings`. That object also always holds every standard setting id, with the store\'s value or the standard default, whether or not your template declares it; a setting of your own with neither a value nor a default is absent. When a store switches template, values whose id and type both match carry over.',
    '',
    '```jsonc',
    '{ "id": "hero.title", "type": "text", "label": "Headline", "description": "Shown above the fold.", "max": 160, "default": "Hosting that stays out of your way" }',
    '```',
    '',
    'Every entry has `id` (lowercase words joined by dots) and `type`, and may have `label`, `description` (help text in the editor) and `default` (what a store that has not set it gets). A declared `0` is a limit like any other; a key that is absent sets no limit.',
    '',
    '## Setting types',
    '',
    table(
      ['type', 'value', 'keys'],
      SETTING_TYPES.map((t) => [code(t), SETTING_TYPE_DOCS[t].value, SETTING_TYPE_DOCS[t].keys]),
    ),
    '',
    '## Links',
    '',
    'A store can save a link\'s href, a `url` and an `image` only in these forms, so a default you declare must take one of them too (`hct validate` refuses one that does not):',
    '',
    '- an `https://` URL, such as `https://docs.example.com/guide`;',
    '- a path on the store\'s own site, starting with a single `/`, such as `/domains` (not `//` or `/\\`);',
    '- for a link\'s href only, a fragment of the same page, such as `#faq`;',
    '- the empty string, for nothing set.',
    '',
    'No other scheme is accepted (`http:`, `mailto:`, `tel:` and the rest are refused), a value is not trimmed, and a value with a control character anywhere (U+0000 to U+001F, or U+007F) is refused. The rule applies to list items and object-list fields of these types as well. `contract/fixtures/links.json` lists the cases.',
    '',
    '## Standard settings',
    '',
    'Well-known ids every store has. The platform\'s default template declares exactly these, and a store keeps its values for them across templates that declare them too. Declare one with its standard type and limits to use it.',
    '',
    table(
      ['id', 'type', 'label', 'limits', 'default'],
      STANDARD_SETTINGS.map((s) => [
        code(s.id),
        s.type === 'list' ? `list of ${s.of ?? 'text'}` : s.type === 'object-list' ? `object-list { ${(s.fields ?? []).map((f) => f.id).join(', ')} }` : s.type,
        s.label ?? '',
        limits(s),
        code(JSON.stringify(s.default)).length > 80 ? 'see below' : code(JSON.stringify(s.default)),
      ]),
    ),
    '',
    '### Long defaults',
    '',
    ...STANDARD_SETTINGS.filter((s) => code(JSON.stringify(s.default)).length > 80).flatMap((s) => [
      `#### ${s.id}`,
      '',
      '```json',
      JSON.stringify(s.default, null, 2),
      '```',
      '',
    ]),
  ].join('\n')
}

// ─── Tokens ───────────────────────────────────────────────────────────────

const TOKEN_RULES: Record<string, string> = {
  color: '`#rgb` or `#rrggbb`',
  font: "a font-family list: letters, digits, spaces, commas, quotes and dashes, at most 200 characters",
  radius: 'a number followed by `px` or `rem`',
  space: 'a number followed by `px` or `rem`',
}

function tokensPage(): string {
  return [
    '# Design tokens',
    '',
    'The named values a template styles itself with. The rendering engine writes each token to a CSS custom property on `:root` (and `:host`), so your CSS reads `var(--hc-accent)`. Set your values in `tokens` in template.json:',
    '',
    '```jsonc',
    '// template.json',
    '{ "tokens": { "color.accent": "#5b8cff", "radius.md": "0.5rem", "font.heading": "\\"Space Grotesk\\", system-ui, sans-serif" } }',
    '```',
    '',
    '## Tokens',
    '',
    table(
      ['token', 'CSS property', 'value', 'store theme colour', 'platform default'],
      TOKENS.map((t) => [
        code(t.name),
        code(t.property),
        TOKEN_RULES[t.kind]!,
        t.theme_key ? code(`theme.${t.theme_key}`) : 'none',
        t.theme_key ? code(PLATFORM_THEME[t.theme_key as ThemeKey]) : 'set by the rendering engine',
      ]),
    ),
    '',
    '## How a value is chosen',
    '',
    'Every store has its eight theme colours set at all times, to the platform defaults above until its owner changes one. For each colour token:',
    '',
    '- a colour the store has changed from its platform default overrides your value;',
    '- a colour the store has never changed shows your value;',
    '- where you declare no value, the platform default applies.',
    '',
    'A store colour is compared with its default without regard to case. The radius, font and space tokens are your value where you set one, and a platform default otherwise.',
    '',
    '## Value patterns',
    '',
    'A value must match the pattern of its kind exactly:',
    '',
    table(['kind', 'pattern'], Object.entries(TOKEN_PATTERNS).map(([k, p]) => [k, code(p)])),
    '',
  ].join('\n')
}

// ─── SDK ──────────────────────────────────────────────────────────────────

function sdkPage(): string {
  const kinds: [SdkEntry['kind'], string][] = [
    ['hook', 'Hooks'],
    ['component', 'Components'],
    ['function', 'Functions'],
    ['type', 'Types'],
  ]
  return [
    '# The SDK',
    '',
    'A format-2 template imports everything from `@hostcore/toolkit`:',
    '',
    '```tsx',
    "import { Link, useNav, useSetting, type PageProps } from '@hostcore/toolkit'",
    '```',
    '',
    ...kinds.flatMap(([kind, title]) => [
      `## ${title}`,
      '',
      table(['name', 'signature', 'what it does'], SDK.filter((e) => e.kind === kind).map((e) => [code(e.name), code(e.signature), e.text])),
      '',
    ]),
    '## Files',
    '',
    table(
      ['file', 'default export'],
      [
        ['`template.json`', 'id, version (`MAJOR.MINOR.PATCH`, no pre-release), name, `"format": 2`, `"contract": "2026-11"`, `"toolchain": 2`, tokens, settings, and optionally allowedPackages: the packages beyond the SDK and React the source may import'],
        ['`src/layout.tsx`', 'the layout: `({ children, variant }: LayoutProps)`; renders `children` (or `<Outlet/>`) exactly once'],
        ['`src/pages/<page id>.tsx`', 'a page: `({ page, data }: PageProps<id>)`; may `export const hydrate = "islands"`'],
        ['`src/islands/<name>.tsx`', 'a component hydrated on its own; wrap it with `island()` where a page uses it'],
        ['`src/slots/<slot id>.tsx`', 'static content for a slot on a platform page (see Pages): rendered on the server only, with no islands, state, effects or event handlers, and no page data'],
        ['`public/`', 'files served as they are; reference them with `asset(path)`'],
      ],
    ),
    '',
    '## In the browser',
    '',
    'The client entry hydrates the page when it loads. It also exports `mount(part?, options?)`: `part` is `document`, `layout`, `body` or `islands`, and for `body`, `options.root` names the element holding the page and `options.env` the environment it was rendered with. Problems are reported with `console.error`; it never throws.',
    '',
    `Format-1 templates keep ${SDK_FORMAT1.map(code).join(', ')}.`,
    '',
  ].join('\n')
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function cliPage(): string {
  const out = ['# Commands', '', '`hct` comes with the toolkit. `hct <command> --help` prints the same as this page.', '']
  for (const c of COMMANDS) {
    out.push(`## hct ${c.name}`, '', `${c.summary[0]!.toUpperCase()}${c.summary.slice(1)}.`, '', '```', c.usage, '```', '')
    for (const p of c.description) out.push(p, '')
    if (c.flags.length > 0) out.push(table(['option', 'what it does'], c.flags.map((f) => [code(f.flag), f.text])), '')
    if (c.env && c.env.length > 0) out.push(table(['environment variable', 'what it is'], c.env.map((e) => [code(e.flag), e.text])), '')
  }
  return out.join('\n')
}

// ─── Upgrading ────────────────────────────────────────────────────────────

function upgradingPage(): string {
  return [
    '# From contract 1 to 2026-11',
    '',
    'A format-1 template is one `App` that switches on `data.page_type` and reads contract "1" through `useHC()`. A format-2 template has a layout and one file per page, and reads contract 2026-11 through the page props and hooks. `hct upgrade` moves a template across and lists what it leaves for you.',
    '',
    '## Fields',
    '',
    table(
      ['contract 1', 'in a format-2 template', 'same value', 'note'],
      FIELD_MOVES.map((m) => [code(m.v1), code(m.v2), m.oneToOne ? 'yes' : 'no', m.note ?? '']),
    ),
    '',
    '## Hooks',
    '',
    table(['format 1', 'format 2', 'one to one', 'note'], HOOK_MOVES.map((m) => [code(m.v1), m.v2, m.oneToOne ? 'yes' : 'no', m.note ?? ''])),
    '',
    '## New in 2026-11',
    '',
    table(['field', 'use it to'], NEW_IN_2026_11.map((n) => [code(n.field), n.use])),
    '',
    '## Links you no longer build',
    '',
    'Every link target is in the payload. A string that starts with one of these is a hand-built platform URL; `hct validate` reports it with the field to use instead.',
    '',
    table(['starts with', 'use'], PLATFORM_URL_RULES.map((u) => [code(u.path), u.use ?? 'nothing: the payload has no link to this page, so a template does not link to it'])),
    '',
    'The list is every page of the page registry with a fixed path, and `/api`. A link to the home page, `"/"`, is not reported: the root of the store\'s site does not move, and `"/"` alone is more often a path separator than a link. Link to it with `useNav().links.home` all the same.',
    '',
    "A link to a group or service built from its slug (`` `/${group.slug}` ``) is `group.url` or `service.url`.",
    '',
  ].join('\n')
}

function indexPage(): string {
  return [
    '# HostCore template reference',
    '',
    'Generated by `hct docs` from the toolkit that wrote it.',
    '',
    '- [Pages](pages.md): every page id, its path and its data',
    `- [Contract ${contract202611.version}](contract-${contract202611.version}.md): every type and field a template receives`,
    '- [Settings](settings.md): setting types, their keys, and the standard settings',
    '- [Design tokens](tokens.md): token names, CSS properties and value rules',
    '- [The SDK](sdk.md): what a template imports from `@hostcore/toolkit`',
    '- [Commands](cli.md): every `hct` command and option',
    '- [From contract 1 to 2026-11](upgrading.md): for authors moving a format-1 template',
    '',
  ].join('\n')
}

/** Every reference page, by file name. */
export function generateDocs(contractDir = TOOLKIT_CONTRACT_DIR): Record<string, string> {
  return {
    'index.md': indexPage(),
    'pages.md': pagesPage(contractDir),
    [`contract-${contract202611.version}.md`]: contractPage(),
    'settings.md': settingsPage(),
    'tokens.md': tokensPage(),
    'sdk.md': sdkPage(),
    'cli.md': cliPage(),
    'upgrading.md': upgradingPage(),
  }
}

/** hct docs --out <dir> */
export async function docsCommand(flags: Flags): Promise<number> {
  const out = stringFlag(flags, 'out')
  if (!out) throw new CommandError('docs needs --out <dir>')
  const dir = resolve(out)
  const files = generateDocs()
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content)
  process.stdout.write(`wrote ${Object.keys(files).length} pages to ${dir}:\n${Object.keys(files).map((f) => `  ${f}`).join('\n')}\n`)
  return 0
}
