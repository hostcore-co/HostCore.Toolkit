import type { NormalisedRegistry } from '../registry'
import { STANDARD_SETTINGS, type SettingSchemaEntry, type SettingValue } from '../settings'
import { TOKEN_PATTERNS, TOKENS } from '../tokens'
import { alignRows, goComment, goFileHeader, goString, type GoRow } from './go'
import { goIdentifier } from './text'

function pageConst(id: string): string {
  return `Page${goIdentifier(id)}`
}

function settingConst(id: string): string {
  return `Setting${goIdentifier(id)}`
}

function goNumber(value: number): string {
  return String(value)
}

/** A default value in the form encoding/json decodes JSON into `any`. */
function goValue(value: SettingValue | Record<string, unknown> | unknown): string {
  if (typeof value === 'string') return goString(value)
  if (typeof value === 'number') return goNumber(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[]any{${value.map(goValue).join(', ')}}`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${goString(k)}: ${goValue(v)}`)
    return `map[string]any{${entries.join(', ')}}`
  }
  throw new Error(`cannot write ${JSON.stringify(value)} as a Go value`)
}

function settingLiteral(s: SettingSchemaEntry): string {
  const parts = [`ID: ${settingConst(s.id)}`, `Type: ${goString(s.type)}`]
  if (s.label !== undefined) parts.push(`Label: ${goString(s.label)}`)
  if (s.description !== undefined) parts.push(`Description: ${goString(s.description)}`)
  if (s.max !== undefined) parts.push(`Max: ${goNumber(s.max)}`)
  if (s.min !== undefined) throw new Error('standard settings do not set min')
  if (s.of !== undefined) parts.push(`Of: ${goString(s.of)}`)
  if (s.fields !== undefined) {
    const fields = s.fields.map((f) => {
      const fp = [`ID: ${goString(f.id)}`, `Type: ${goString(f.type)}`]
      if (f.label !== undefined) fp.push(`Label: ${goString(f.label)}`)
      if (f.max !== undefined) fp.push(`Max: ${goNumber(f.max)}`)
      return `{${fp.join(', ')}}`
    })
    parts.push(`Fields: []SettingField{${fields.join(', ')}}`)
  }
  if (s.options !== undefined) {
    const options = s.options.map((o) => `{Value: ${goString(o.value)}, Label: ${goString(o.label)}}`)
    parts.push(`Options: []SettingOption{${options.join(', ')}}`)
  }
  if (s.default !== undefined) parts.push(`Default: ${goValue(s.default)}`)
  return `{${parts.join(', ')}},`
}

function stringConsts(type: string, values: readonly string[], name: (v: string) => string): string[] {
  const rows: GoRow[] = values.map((v) => ({ cells: [name(v), type, `= ${goString(v)}`] }))
  return ['const (', ...alignRows(rows, '\t'), ')']
}

/** Renders the page registry, standard settings and design tokens as Go. */
export function generateGoRegistry(registry: NormalisedRegistry, packageName: string): string {
  const lines = goFileHeader(
    packageName,
    `Package ${packageName} is the storefront page contract: the shapes of page payloads for each contract version, the page registry, the standard template settings and the design tokens.`,
  )

  const tiers = [...new Set(registry.pages.map((p) => p.tier))]
  const upstreams = [...new Set(registry.pages.map((p) => p.upstream))]

  lines.push(...goComment('PageID identifies a page in the page registry.'))
  lines.push('type PageID string', '')
  lines.push(...stringConsts('PageID', registry.pages.map((p) => p.id), pageConst), '')

  lines.push(...goComment('Tier is who may see a page.'))
  lines.push('type Tier string', '')
  lines.push(...stringConsts('Tier', tiers, (v) => `Tier${goIdentifier(v)}`), '')

  lines.push(...goComment('Upstream is the part of the platform that serves a page.'))
  lines.push('type Upstream string', '')
  lines.push(...stringConsts('Upstream', upstreams, (v) => `Upstream${goIdentifier(v)}`), '')

  lines.push(
    ...goComment(
      'CachePolicy is how long a rendered page may be served from cache. TTL is the seconds a page is fresh; SWR is the seconds a stale copy may be served while a fresh one renders.',
    ),
  )
  lines.push('type CachePolicy struct {')
  lines.push(...alignRows([{ cells: ['TTL', 'int', '`json:"ttl"`'] }, { cells: ['SWR', 'int', '`json:"swr"`'] }], '\t'))
  lines.push('}', '')

  lines.push(
    ...goComment(
      'Page is one entry of the page registry. Path is empty for a page no path reaches. A Prefix page also owns every path below its own, on a "/" boundary. Cache is set for engine pages only. Requires names what a store must offer for the page to exist, or is empty.',
    ),
  )
  lines.push('type Page struct {')
  lines.push(
    ...alignRows(
      [
        { cells: ['ID', 'PageID', '`json:"id"`'] },
        { cells: ['Path', 'string', '`json:"path"`'] },
        { cells: ['Prefix', 'bool', '`json:"prefix"`'] },
        { cells: ['Tier', 'Tier', '`json:"tier"`'] },
        { cells: ['Upstream', 'Upstream', '`json:"upstream"`'] },
        { cells: ['Cache', 'CachePolicy', '`json:"cache"`'] },
        { cells: ['Requires', 'string', '`json:"requires"`'] },
      ],
      '\t',
    ),
  )
  lines.push('}', '')

  lines.push(...goComment('Pages lists every page in registry order.'))
  lines.push('var Pages = []Page{')
  for (const p of registry.pages) {
    const parts = [`ID: ${pageConst(p.id)}`]
    if (p.path !== null) parts.push(`Path: ${goString(p.path)}`)
    if (p.prefix) parts.push('Prefix: true')
    parts.push(`Tier: Tier${goIdentifier(p.tier)}`, `Upstream: Upstream${goIdentifier(p.upstream)}`)
    if (p.cache) parts.push(`Cache: CachePolicy{TTL: ${p.cache.ttl}, SWR: ${p.cache.swr}}`)
    if (p.requires) parts.push(`Requires: ${goString(p.requires)}`)
    lines.push(`\t{${parts.join(', ')}},`)
  }
  lines.push('}', '')

  lines.push(
    ...goComment(
      'ReservedSlugs are path segments a store may not use as a group slug, because a page of the platform lives there or may in future.',
    ),
  )
  lines.push('var ReservedSlugs = []string{')
  for (const slug of registry.reserved_slugs) lines.push(`\t${goString(slug)},`)
  lines.push('}', '')

  lines.push(...goComment('IsReservedSlug reports whether a group slug is reserved.'))
  lines.push('func IsReservedSlug(slug string) bool {')
  lines.push('\tfor _, reserved := range ReservedSlugs {')
  lines.push('\t\tif reserved == slug {')
  lines.push('\t\t\treturn true')
  lines.push('\t\t}')
  lines.push('\t}')
  lines.push('\treturn false')
  lines.push('}', '')

  lines.push(
    ...goComment(
      "DefaultCachePolicy returns the registry's cache policy for an engine page, and false for any other page. A store's own per-page setting overrides it.",
    ),
  )
  lines.push('func DefaultCachePolicy(id PageID) (CachePolicy, bool) {')
  lines.push('\tfor _, page := range Pages {')
  lines.push('\t\tif page.ID == id && page.Upstream == UpstreamEngine {')
  lines.push('\t\t\treturn page.Cache, true')
  lines.push('\t\t}')
  lines.push('\t}')
  lines.push('\treturn CachePolicy{}, false')
  lines.push('}', '')

  lines.push(...goComment('The ids of the standard settings every store has.'))
  lines.push('const (')
  lines.push(
    ...alignRows(
      STANDARD_SETTINGS.map((s) => ({ cells: [settingConst(s.id), `= ${goString(s.id)}`] })),
      '\t',
    ),
  )
  lines.push(')', '')

  lines.push(...goComment('SettingField is one field of each entry of an object-list setting.'))
  lines.push('type SettingField struct {')
  lines.push(
    ...alignRows(
      [
        { cells: ['ID', 'string', '`json:"id"`'] },
        { cells: ['Type', 'string', '`json:"type"`'] },
        { cells: ['Label', 'string', '`json:"label,omitempty"`'] },
        { cells: ['Max', 'float64', '`json:"max,omitempty"`'] },
      ],
      '\t',
    ),
  )
  lines.push('}', '')

  lines.push(...goComment('SettingOption is one choice of a select setting.'))
  lines.push('type SettingOption struct {')
  lines.push(
    ...alignRows(
      [
        { cells: ['Value', 'string', '`json:"value"`'] },
        { cells: ['Label', 'string', '`json:"label"`'] },
      ],
      '\t',
    ),
  )
  lines.push('}', '')

  lines.push(
    ...goComment(
      'SettingSchema declares one template setting. Max counts characters for text types, entries for lists and the largest value for numbers. Default holds the value in the form encoding/json decodes JSON into any.',
    ),
  )
  lines.push('type SettingSchema struct {')
  lines.push(
    ...alignRows(
      [
        { cells: ['ID', 'string', '`json:"id"`'] },
        { cells: ['Type', 'string', '`json:"type"`'] },
        { cells: ['Label', 'string', '`json:"label,omitempty"`'] },
        { cells: ['Description', 'string', '`json:"description,omitempty"`'] },
        { cells: ['Max', 'float64', '`json:"max,omitempty"`'] },
        { cells: ['Min', '*float64', '`json:"min,omitempty"`'] },
        { cells: ['Of', 'string', '`json:"of,omitempty"`'] },
        { cells: ['Fields', '[]SettingField', '`json:"fields,omitempty"`'] },
        { cells: ['Options', '[]SettingOption', '`json:"options,omitempty"`'] },
        { cells: ['Default', 'any', '`json:"default,omitempty"`'] },
      ],
      '\t',
    ),
  )
  lines.push('}', '')

  lines.push(
    ...goComment(
      'StandardSettings are the well-known settings every store has. The built-in default template declares exactly these, and contract "1" payloads rebuild their content from them.',
    ),
  )
  lines.push('var StandardSettings = []SettingSchema{')
  for (const s of STANDARD_SETTINGS) lines.push(`\t${settingLiteral(s)}`)
  lines.push('}', '')

  lines.push(...goComment('TokenKind is the kind of value a design token holds.'))
  lines.push('type TokenKind string', '')
  const kinds = [...new Set(TOKENS.map((t) => t.kind))]
  lines.push(...stringConsts('TokenKind', kinds, (v) => `TokenKind${goIdentifier(v)}`), '')

  lines.push(
    ...goComment(
      'TokenPatterns are the regular expressions a value of each token kind must match. Colours are hex only; fonts are a font-family list; radius and space are a number of px or rem.',
    ),
  )
  lines.push('var TokenPatterns = []struct {')
  lines.push(...alignRows([{ cells: ['Kind', 'TokenKind'] }, { cells: ['Pattern', 'string'] }], '\t'))
  lines.push('}{')
  for (const kind of kinds) {
    lines.push(`\t{Kind: TokenKind${goIdentifier(kind)}, Pattern: \`${TOKEN_PATTERNS[kind]}\`},`)
  }
  lines.push('}', '')

  lines.push(
    ...goComment(
      "Token is one design token and the CSS custom property the rendering engine writes it to. ThemeKey names the store theme colour that overrides it, or is empty.",
    ),
  )
  lines.push('type Token struct {')
  lines.push(
    ...alignRows(
      [
        { cells: ['Name', 'string', '`json:"name"`'] },
        { cells: ['Property', 'string', '`json:"property"`'] },
        { cells: ['Kind', 'TokenKind', '`json:"kind"`'] },
        { cells: ['ThemeKey', 'string', '`json:"theme_key,omitempty"`'] },
      ],
      '\t',
    ),
  )
  lines.push('}', '')

  lines.push(...goComment('Tokens lists every design token.'))
  lines.push('var Tokens = []Token{')
  for (const tk of TOKENS) {
    const parts = [
      `Name: ${goString(tk.name)}`,
      `Property: ${goString(tk.property)}`,
      `Kind: TokenKind${goIdentifier(tk.kind)}`,
    ]
    if (tk.theme_key) parts.push(`ThemeKey: ${goString(tk.theme_key)}`)
    lines.push(`\t{${parts.join(', ')}},`)
  }
  lines.push('}')

  return `${lines.join('\n')}\n`
}

/**
 * Renders a Go file exporting FrontendPrefixes: the path of every page the
 * platform's front end serves. Match a request path against them on a "/"
 * boundary: a prefix owns itself and every path below it.
 */
export function generateGoFrontendPrefixes(registry: NormalisedRegistry, packageName: string): string {
  const lines = goFileHeader(packageName)
  lines.push(
    ...goComment(
      'FrontendPrefixes are the paths of every page the platform front end serves. A path belongs to one when it equals the prefix or continues it with "/".',
    ),
  )
  lines.push('var FrontendPrefixes = []string{')
  for (const page of registry.pages) {
    if (page.upstream === 'frontend' && page.path !== null) lines.push(`\t${goString(page.path)},`)
  }
  lines.push('}')
  return `${lines.join('\n')}\n`
}
