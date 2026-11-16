import type { Contract, Schema } from './dsl'
import type { LinkCase } from './link-cases'
import type { NormalisedRegistry } from './registry'
import type { SettingSchemaEntry } from './settings'
import type { TokenDefinition } from './tokens'

/**
 * What a template can observe of a contract version, as plain data: every
 * type with its fields, enum values and optionality, the page data types,
 * and for a contract format-2 templates use, the page registry, the design
 * tokens, the standard settings and the link rule. `hct contract check`
 * compares it with the frozen baseline in `baselines/<version>.json` and
 * classifies every difference with diffSurface.
 */

export interface SurfaceField {
  /** The field's type, written out (`string`, `Price | null`, `Plan[]`, `enum`). */
  type: string
  optional: boolean
  /** For an enum field: its values. */
  values?: string[]
  /** For an enum field: whether any other string may arrive. */
  open?: boolean
}

export interface SurfaceType {
  /** `object`, `enum` or the type written out. */
  kind: string
  /** Data a template writes (a request it sends) rather than reads. */
  input?: boolean
  fields?: Record<string, SurfaceField>
  values?: string[]
  open?: boolean
}

export interface SurfacePage {
  path: string | null
  prefix: boolean
  tier: string
  upstream: string
  requires: string | null
}

export interface SurfaceToken {
  property: string
  kind: string
  pattern: string
}

export interface SurfaceSetting {
  type: string
  of?: string
  fields?: Record<string, string>
  max?: number
  href_max?: number
  item_max?: number
  min?: number
  step?: number
}

export interface ContractSurface {
  contract: string
  types: Record<string, SurfaceType>
  /** Page id → the type of its data. */
  page_data: Record<string, string>
  registry?: Record<string, SurfacePage>
  tokens?: Record<string, SurfaceToken>
  standard_settings?: Record<string, SurfaceSetting>
  /** `<kind> <value as JSON>` → whether the link rule accepts it. */
  link_rule?: Record<string, boolean>
}

export interface SurfaceSources {
  registry: NormalisedRegistry
  tokens: readonly TokenDefinition[]
  tokenPatterns: Record<string, string>
  settings: readonly SettingSchemaEntry[]
  links: readonly LinkCase[]
}

function typeText(schema: Schema): string {
  switch (schema.kind) {
    case 'string':
      return schema.pattern ? `string /${schema.pattern}/` : 'string'
    case 'literal':
      return JSON.stringify(schema.value)
    case 'enum':
      return 'enum'
    case 'array':
      return `${typeText(schema.items)}[]`
    case 'nullable':
      return `${typeText(schema.inner)} | null`
    case 'record':
      return `Record<string, ${typeText(schema.values)}>`
    case 'ref':
      return schema.name
    case 'union':
      return `union(${schema.tag}: ${Object.entries(schema.variants).map(([k, v]) => `${k}=${v}`).join(', ')})`
    case 'object':
      return `{ ${Object.entries(schema.fields).map(([k, f]) => `${k}${f.optional ? '?' : ''}: ${typeText(f.schema)}`).join(', ')} }`
    default:
      return schema.kind
  }
}

function sorted<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The surface of a contract; `sources` is given for a contract format-2 templates use. */
export function contractSurface(contract: Contract, sources?: SurfaceSources): ContractSurface {
  const inputs = new Set(contract.inputs ?? [])
  const types = sorted(
    contract.definitions.map((def): [string, SurfaceType] => {
      const s = def.schema
      const input = inputs.has(def.name) ? { input: true } : {}
      if (s.kind === 'object') {
        const fields = sorted(
          Object.entries(s.fields).map(([name, f]): [string, SurfaceField] => [
            name,
            f.schema.kind === 'enum'
              ? { type: 'enum', optional: f.optional, values: [...f.schema.values], open: f.schema.open !== undefined }
              : { type: typeText(f.schema), optional: f.optional },
          ]),
        )
        return [def.name, { kind: 'object', ...input, fields }]
      }
      if (s.kind === 'enum') return [def.name, { kind: 'enum', ...input, values: [...s.values], open: s.open !== undefined }]
      return [def.name, { kind: typeText(s), ...input }]
    }),
  )
  const surface: ContractSurface = { contract: contract.version, types, page_data: sorted(Object.entries(contract.pages)) }
  if (!sources) return surface
  surface.registry = sorted(
    sources.registry.pages.map((p): [string, SurfacePage] => [
      p.id,
      { path: p.path, prefix: p.prefix, tier: p.tier, upstream: p.upstream, requires: p.requires },
    ]),
  )
  surface.tokens = sorted(
    sources.tokens.map((t): [string, SurfaceToken] => [t.name, { property: t.property, kind: t.kind, pattern: sources.tokenPatterns[t.kind]! }]),
  )
  surface.standard_settings = sorted(
    sources.settings.map((s): [string, SurfaceSetting] => {
      const out: SurfaceSetting = { type: s.type }
      if (s.of !== undefined) out.of = s.of
      if (s.fields) out.fields = sorted(s.fields.map((f): [string, string] => [f.id, f.type]))
      for (const key of ['max', 'href_max', 'item_max', 'min', 'step'] as const) if (s[key] !== undefined) out[key] = s[key]
      return [s.id, out]
    }),
  )
  surface.link_rule = sorted(sources.links.map((c): [string, boolean] => [`${c.kind} ${JSON.stringify(c.value)}`, c.ok]))
  return surface
}

// ─── Differences ──────────────────────────────────────────────────────────

export type ChangeKind = 'additive' | 'breaking'

export interface ContractChange {
  kind: ChangeKind
  /** Where: `type Plan field price`, `page checkout`, `token color.accent`, … */
  at: string
  /** What changed, in a sentence fragment. */
  what: string
}

function keys<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): string[] {
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function enumChanges(at: string, before: { values?: string[]; open?: boolean }, after: { values?: string[]; open?: boolean }): ContractChange[] {
  const out: ContractChange[] = []
  const was = before.values ?? []
  const now = after.values ?? []
  const removed = was.filter((v) => !now.includes(v))
  const added = now.filter((v) => !was.includes(v))
  if (removed.length > 0) out.push({ kind: 'breaking', at, what: `enum values removed: ${removed.join(', ')}` })
  if (added.length > 0) {
    out.push(
      after.open
        ? { kind: 'additive', at, what: `values added to an open enum: ${added.join(', ')}` }
        : { kind: 'breaking', at, what: `values added to a closed enum, which a template may not handle: ${added.join(', ')}` },
    )
  }
  if (before.open && !after.open) out.push({ kind: 'breaking', at, what: 'an open enum became closed' })
  if (!before.open && after.open) out.push({ kind: 'additive', at, what: 'a closed enum became open' })
  return out
}

function fieldChanges(at: string, input: boolean, before: SurfaceField | undefined, after: SurfaceField | undefined): ContractChange[] {
  if (!before && after) {
    if (input && !after.optional) return [{ kind: 'breaking', at, what: 'a required field was added to data a template sends' }]
    return [{ kind: 'additive', at, what: `a${after.optional ? 'n optional' : ''} field was added` }]
  }
  if (before && !after) return [{ kind: 'breaking', at, what: 'the field was removed or renamed' }]
  const b = before!
  const a = after!
  const out: ContractChange[] = []
  if (b.type !== a.type) out.push({ kind: 'breaking', at, what: `the type changed from ${b.type} to ${a.type}` })
  else if (b.type === 'enum') out.push(...enumChanges(at, b, a))
  if (b.optional !== a.optional) {
    const nowOptional = a.optional
    // A template reading data handles a field that is always there; one sending data cannot leave out a field that became required.
    const breaking = input ? !nowOptional : nowOptional
    out.push({
      kind: breaking ? 'breaking' : 'additive',
      at,
      what: nowOptional ? 'a required field may now be absent' : 'an optional field is now required',
    })
  }
  return out
}

function typeChanges(name: string, before: SurfaceType | undefined, after: SurfaceType | undefined): ContractChange[] {
  const at = `type ${name}`
  if (!before && after) return [{ kind: 'additive', at, what: 'a type was added' }]
  if (before && !after) return [{ kind: 'breaking', at, what: 'the type was removed or renamed' }]
  const b = before!
  const a = after!
  if (b.kind !== a.kind) return [{ kind: 'breaking', at, what: `the type changed from ${b.kind} to ${a.kind}` }]
  if (Boolean(b.input) !== Boolean(a.input)) return [{ kind: 'breaking', at, what: 'the type changed between data a template reads and data it sends' }]
  if (b.kind === 'enum') return enumChanges(at, b, a)
  if (b.kind !== 'object') return []
  return keys(b.fields, a.fields).flatMap((f) => fieldChanges(`${at} field ${f}`, Boolean(a.input), b.fields?.[f], a.fields?.[f]))
}

function limitChanges(at: string, before: SurfaceSetting, after: SurfaceSetting): ContractChange[] {
  const out: ContractChange[] = []
  for (const key of ['max', 'href_max', 'item_max'] as const) {
    const b = before[key]
    const a = after[key]
    if (b === a) continue
    const narrowed = a !== undefined && (b === undefined || a < b)
    out.push({ kind: narrowed ? 'breaking' : 'additive', at, what: `${key} ${narrowed ? 'narrowed' : 'widened'} from ${b ?? 'none'} to ${a ?? 'none'}` })
  }
  if (before.min !== after.min) {
    const narrowed = after.min !== undefined && (before.min === undefined || after.min > before.min)
    out.push({ kind: narrowed ? 'breaking' : 'additive', at, what: `min ${narrowed ? 'narrowed' : 'widened'} from ${before.min ?? 'none'} to ${after.min ?? 'none'}` })
  }
  if (before.step !== after.step) out.push({ kind: 'breaking', at, what: `step changed from ${before.step ?? 'none'} to ${after.step ?? 'none'}` })
  return out
}

function added(at: string, what: string): ContractChange {
  return { kind: 'additive', at, what }
}

function removed(at: string, what: string): ContractChange {
  return { kind: 'breaking', at, what }
}

/** Every difference between a baseline surface and the current one, classified. */
export function diffSurface(before: ContractSurface, after: ContractSurface): ContractChange[] {
  const out: ContractChange[] = []
  for (const name of keys(before.types, after.types)) out.push(...typeChanges(name, before.types[name], after.types[name]))

  for (const id of keys(before.page_data, after.page_data)) {
    const at = `page data ${id}`
    const b = before.page_data[id]
    const a = after.page_data[id]
    if (b === undefined) out.push(added(at, 'a page was added'))
    else if (a === undefined) out.push(removed(at, 'the page was removed'))
    else if (a !== b) out.push(removed(at, `its data type changed from ${b} to ${a}`))
  }

  for (const id of keys(before.registry, after.registry)) {
    const at = `page ${id}`
    const b = before.registry?.[id]
    const a = after.registry?.[id]
    if (!b) out.push(added(at, 'a page was added to the registry'))
    else if (!a) out.push(removed(at, 'the page was removed from the registry'))
    else {
      for (const key of ['path', 'prefix', 'tier', 'upstream', 'requires'] as const) {
        if (!same(b[key], a[key])) out.push(removed(at, `its ${key} changed from ${JSON.stringify(b[key])} to ${JSON.stringify(a[key])}`))
      }
    }
  }

  for (const name of keys(before.tokens, after.tokens)) {
    const at = `token ${name}`
    const b = before.tokens?.[name]
    const a = after.tokens?.[name]
    if (!b) out.push(added(at, 'a token was added'))
    else if (!a) out.push(removed(at, 'the token was removed'))
    else {
      for (const key of ['property', 'kind', 'pattern'] as const) {
        if (b[key] !== a[key]) out.push(removed(at, `its ${key} changed from ${b[key]} to ${a[key]}`))
      }
    }
  }

  for (const id of keys(before.standard_settings, after.standard_settings)) {
    const at = `standard setting ${id}`
    const b = before.standard_settings?.[id]
    const a = after.standard_settings?.[id]
    if (!b) out.push(added(at, 'a standard setting was added'))
    else if (!a) out.push(removed(at, 'the standard setting was removed'))
    else if (b.type !== a.type || b.of !== a.of || !same(b.fields, a.fields)) {
      out.push(removed(at, 'its shape (type, list item type or fields) changed'))
    } else out.push(...limitChanges(at, b, a))
  }

  for (const c of keys(before.link_rule, after.link_rule)) {
    const at = `link rule ${c}`
    const b = before.link_rule?.[c]
    const a = after.link_rule?.[c]
    if (b === undefined || a === undefined) out.push(added(at, b === undefined ? 'a case was added' : 'a case was dropped from the table'))
    else if (b && !a) out.push(removed(at, 'a value the rule accepted is now refused'))
    else if (!b && a) out.push(added(at, 'a value the rule refused is now accepted'))
  }
  return out
}
