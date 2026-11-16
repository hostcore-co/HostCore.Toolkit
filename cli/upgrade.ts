import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import type * as TS from 'typescript'
import { STANDARD_SETTINGS } from '../contract/src/settings'
import { CommandError, type Flags } from './commands'
import { HAND_BUILT_URLS } from './legacy-map'
import { discoverSources, MINIMAL_LAYOUT_PAGE_IDS, SOURCE_EXTENSIONS } from './sources'
import { isFormat2, loadTemplate } from './template'
import { FORMAT2_PACKAGE_RANGES, FORMAT2_REQUIRED, TOOLCHAIN } from './toolchain'

/**
 * hct upgrade — moves a format-1 template to format 2.
 *
 * It converts what has a one-to-one mapping and lists the rest:
 *
 *   - template.json gets format 2, contract 2026-11 and the toolchain line,
 *     and declares the standard settings the template reads;
 *   - the page switch (`switch (data.page_type)`) or page map
 *     (`{ home: Home, group: Group }[data.page_type]`) in App becomes one
 *     file per page in src/pages/, and markup App renders around the page
 *     becomes src/layout.tsx with an <Outlet/>;
 *   - data read through useHC(), usePageData(), useStore() and
 *     useServiceGroups() is rewritten to usePage(), useStore(), useNav()
 *     and useSetting() wherever the contract-2026-11 field is the same value
 *     (see legacy-map.ts);
 *   - package.json moves to the format-2 dependency ranges.
 *
 * Every access it cannot rewrite is left as it was and listed, with the
 * hand-built platform URLs and the files format 2 no longer reads.
 */

type TypeScript = typeof TS

// ─── Plan ─────────────────────────────────────────────────────────────────

export interface Leftover {
  kind: 'url' | 'data' | 'setting' | 'other'
  /** Path relative to the template, after the upgrade; "" for the template as a whole. */
  file: string
  line: number
  text: string
}

export interface UpgradePlan {
  /** New contents by path relative to the template. */
  writes: Map<string, string>
  deletes: Set<string>
  /** Directory or file moves, applied before writes. */
  moves: Array<[string, string]>
  leftovers: Leftover[]
  /** One line per conversion made. */
  done: string[]
}

export class UpgradeError extends CommandError {}

// ─── Text edits ───────────────────────────────────────────────────────────

interface Edit {
  start: number
  end: number
  text: string
}

/** Replacements by position in one source text, rendered over any range. */
class Edits {
  private list: Edit[] = []
  constructor(readonly source: string) {}

  /** Adds an edit unless it overlaps one already made; returns whether it was added. */
  add(start: number, end: number, text: string): boolean {
    if (this.list.some((e) => start < e.end && e.start < end && !(start === end && (start === e.start || start === e.end)))) return false
    this.list.push({ start, end, text })
    return true
  }

  covers(start: number, end: number): boolean {
    return this.list.some((e) => e.start <= start && end <= e.end && e.start !== e.end)
  }

  render(start = 0, end = this.source.length): string {
    const inside = this.list.filter((e) => e.start >= start && e.end <= end).sort((a, b) => a.start - b.start || a.end - b.end)
    let out = ''
    let at = start
    for (const e of inside) {
      out += this.source.slice(at, e.start) + e.text
      at = e.end
    }
    return out + this.source.slice(at, end)
  }
}

// ─── The contract "1" → 2026-11 mapping, as code ───────────────────────────

/** Placeholders a rewritten access uses, replaced with the names each file declares. */
const P = {
  page: '\u0000page\u0000',
  store: '\u0000store\u0000',
  nav: '\u0000nav\u0000',
  setting: (id: string) => `\u0000setting:${id}\u0000`,
}
const PLACEHOLDER = /\u0000(page|store|nav|setting:[^\u0000]+)\u0000/g

const STORE_FIELDS: Record<string, string> = {
  store_name: 'name',
  website_domain: 'domain',
  business_info: 'business',
  theme: 'theme',
  logo_url: 'logo_url',
  favicon_url: 'favicon_url',
  root_redirect_url: 'root_redirect_url',
  login_image_url: 'login_image_url',
  signup_image_url: 'signup_image_url',
}
const STORE_TO_NAV: Record<string, string> = { terms_of_service_url: 'terms', privacy_policy_url: 'privacy' }
const PAGE_DATA_FIELDS = new Set(['group', 'services', 'service', 'plans', 'tlds', 'currency'])
const STANDARD_IDS = new Set(STANDARD_SETTINGS.map((s) => s.id))

/** Why an access has no rewrite, by its first field. */
const NO_MAPPING: Record<string, string> = {
  page_type: 'page ids are named differently in format 2 (group is catalog.group, service is catalog.service); a page file is already one page, or read page.page.id',
  content: "read each value with useSetting('<section>.<key>')",
  pricing: 'the pricing object is gone; read plan.price and plan.original_price',
  data: "the page data is split up in format 2: the page's own data is the data prop (or usePage().data), the rest is usePage(), useStore(), useNav() and useSetting()",
  store: 'the 2026-11 store has different fields; read the fields you need from useStore() and useNav().links',
}

interface Rewrite {
  text: string
}

interface NoRewrite {
  reason: string
}

/** Renames inside a chain below the mapped part: cheapest_plan, pricing.price, pricing.original_price. */
function renameRest(rest: Array<{ name: string; dot: string }>): string | NoRewrite {
  let out = ''
  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i]!
    if (seg.name === 'cheapest_plan') {
      out += `${seg.dot}from`
    } else if (seg.name === 'pricing') {
      const next = rest[i + 1]
      if (next && (next.name === 'price' || next.name === 'original_price')) continue
      return { reason: NO_MAPPING.pricing! }
    } else if (seg.name === 'page_type') {
      return { reason: NO_MAPPING.page_type! }
    } else {
      out += `${seg.dot}${seg.name}`
    }
  }
  return out
}

/**
 * The format-2 expression for a contract "1" access, given its path from
 * the useHC() value: ['data', 'content', 'hero', 'title'], ['store', …].
 */
export function rewriteAccess(path: Array<{ name: string; dot: string }>): Rewrite | NoRewrite {
  let segs = path
  if (segs[0]?.name === 'data' && (segs[1]?.name === 'store' || segs[1]?.name === 'service_groups')) segs = segs.slice(1)
  const head = segs[0]?.name
  const withRest = (base: string, rest: Array<{ name: string; dot: string }>): Rewrite | NoRewrite => {
    const tail = renameRest(rest)
    return typeof tail === 'string' ? { text: base + tail } : tail
  }
  if (head === 'service_groups') return withRest(`${P.nav}.groups`, segs.slice(1))
  if (head === 'store') {
    const field = segs[1]?.name
    if (!field) return { reason: NO_MAPPING.store! }
    if (STORE_FIELDS[field]) return withRest(`${P.store}.${STORE_FIELDS[field]}`, segs.slice(2))
    if (STORE_TO_NAV[field]) return withRest(`${P.nav}.links.${STORE_TO_NAV[field]}`, segs.slice(2))
    return { reason: `store.${field} is not in contract 2026-11` }
  }
  if (head !== 'data') return { reason: NO_MAPPING.data! }
  const field = segs[1]?.name
  if (!field) return { reason: NO_MAPPING.data! }
  if (field === 'page_type') return { reason: NO_MAPPING.page_type! }
  if (field === 'meta') return withRest(`${P.page}.meta`, segs.slice(2))
  if (field === 'domains_enabled') {
    if (segs.length > 2) return { reason: 'domains_enabled is a boolean' }
    return { text: `(${P.nav}.links.domains !== '')` }
  }
  if (field === 'content') {
    const id = segs[2] && segs[3] ? `${segs[2].name}.${segs[3].name}` : null
    if (!id) return { reason: NO_MAPPING.content! }
    if (!STANDARD_IDS.has(id)) return { reason: `content.${id} is not a standard setting` }
    return withRest(P.setting(id), segs.slice(4))
  }
  if (PAGE_DATA_FIELDS.has(field)) return withRest(`${P.page}.data.${field}`, segs.slice(2))
  return { reason: `data.${field} is not in contract 2026-11` }
}

// ─── Source analysis ──────────────────────────────────────────────────────

const LEGACY_PAGE_IDS: Record<string, string> = {
  home: 'home',
  group: 'catalog.group',
  service: 'catalog.service',
  domains: 'domains',
  'not-found': 'not-found',
}
const PAGE_ORDER = ['home', 'domains', 'catalog.group', 'catalog.service', 'not-found']

const COMPONENT_NAMES: Record<string, string> = {
  home: 'Home',
  'catalog.group': 'CatalogGroup',
  'catalog.service': 'CatalogService',
  domains: 'Domains',
  'not-found': 'NotFound',
}

const LEGACY_HOOKS: Record<string, string[]> = {
  useHC: [],
  usePageData: ['data'],
  useStore: ['store'],
  useServiceGroups: ['service_groups'],
}

interface Binding {
  name: string
  path: string[]
  /** Where the name is visible. */
  scopeStart: number
  scopeEnd: number
  /** The declaration that introduces it. */
  declaration: TS.VariableDeclaration
  /** The statement holding the declaration. */
  statement: TS.VariableStatement
  /** The name node in the declaration. */
  nameNode: TS.Identifier
}

interface Use {
  binding: Binding
  start: number
  end: number
  original: string
  result: Rewrite | NoRewrite
}

interface FileAnalysis {
  file: string
  source: string
  sf: TS.SourceFile
  edits: Edits
  bindings: Binding[]
  uses: Use[]
  /** Accesses outside any binding that still need the author: page_type, pricing, … */
  stray: Array<{ start: number; text: string; reason: string }>
  /** Names imported from @hostcore/toolkit. */
  toolkitImports: Set<string>
  /** Every identifier in the file. */
  identifiers: Set<string>
}

function unwrap(ts: TypeScript, node: TS.Expression): TS.Expression {
  let e = node
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression
    } else {
      return e
    }
  }
}

function scopeOf(ts: TypeScript, node: TS.Node): TS.Node {
  let n: TS.Node | undefined = node.parent
  while (n && !ts.isBlock(n) && !ts.isCaseClause(n) && !ts.isDefaultClause(n) && !ts.isSourceFile(n) && !ts.isFunctionLike(n)) n = n.parent
  return n ?? node.getSourceFile()
}

function analyse(ts: TypeScript, file: string, source: string): FileAnalysis {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const a: FileAnalysis = { file, source, sf, edits: new Edits(source), bindings: [], uses: [], stray: [], toolkitImports: new Set(), identifiers: new Set() }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === '@hostcore/toolkit') {
      const named = stmt.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) for (const el of named.elements) a.toolkitImports.add(el.name.text)
    }
  }

  function visible(name: string, at: number): Binding | undefined {
    return a.bindings.filter((b) => b.name === name && b.scopeStart <= at && at < b.scopeEnd).sort((x, y) => y.scopeStart - x.scopeStart)[0]
  }

  function pathOf(expr: TS.Expression): string[] | null {
    const e = unwrap(ts, expr)
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.arguments.length === 0) {
      const hook = e.expression.text
      if (LEGACY_HOOKS[hook] && a.toolkitImports.has(hook)) return [...LEGACY_HOOKS[hook]!]
      return null
    }
    if (ts.isIdentifier(e)) {
      const b = visible(e.text, e.getStart())
      return b ? [...b.path] : null
    }
    if (ts.isPropertyAccessExpression(e)) {
      const base = pathOf(e.expression)
      return base ? [...base, e.name.text] : null
    }
    return null
  }

  // Bindings, in source order so an alias of an alias resolves.
  function collectBindings(node: TS.Node): void {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)) {
      const path = pathOf(node.initializer)
      if (path) {
        const scope = scopeOf(ts, node.parent.parent)
        const add = (name: TS.Identifier, p: string[]) =>
          a.bindings.push({ name: name.text, path: p, scopeStart: node.getStart(), scopeEnd: scope.getEnd(), declaration: node, statement: node.parent.parent as TS.VariableStatement, nameNode: name })
        if (ts.isIdentifier(node.name)) add(node.name, path)
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (el.dotDotDotToken || el.initializer || !ts.isIdentifier(el.name)) continue
            const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
            add(el.name, [...path, prop])
          }
        }
      }
    }
    const jsxTag = node.parent !== undefined && (ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent) || ts.isJsxClosingElement(node.parent)) && node.parent.tagName === node
    // <nav> and <header> are tag names, not identifiers a declaration could clash with.
    if (ts.isIdentifier(node) && !(jsxTag && INTRINSIC_TAG.test(node.text))) a.identifiers.add(node.text)
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sf)

  // Uses: each reference to a binding, with the property chain above it.
  function findUses(node: TS.Node): void {
    if (ts.isIdentifier(node) && !a.bindings.some((b) => b.nameNode === node)) {
      const parent = node.parent
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        ts.isJsxAttribute(parent) ||
        (ts.isImportSpecifier(parent) || ts.isImportClause(parent))
      const b = isPropertyName ? undefined : visible(node.text, node.getStart())
      if (b) {
        let top: TS.Expression = node
        const segs: Array<{ name: string; dot: string }> = b.path.map((name) => ({ name, dot: '.' }))
        while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) {
          top = top.parent
          const pa = top as TS.PropertyAccessExpression
          segs.push({ name: pa.name.text, dot: pa.questionDotToken ? '?.' : '.' })
        }
        // A shorthand property ({ data }) is not a value access we can rename in place.
        const result: Rewrite | NoRewrite = ts.isShorthandPropertyAssignment(parent)
          ? { reason: 'passed on as a shorthand property' }
          : ts.isBindingElement(parent) || (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name))
            ? { reason: '' }
            : rewriteAccess(segs)
        a.uses.push({ binding: b, start: node.getStart(), end: top.getEnd(), original: source.slice(node.getStart(), top.getEnd()), result })
        return
      }
    }
    ts.forEachChild(node, findUses)
  }
  findUses(sf)

  // A use that only initialises another binding is accounted for by that binding.
  a.uses = a.uses.filter((u) => !a.bindings.some((b) => b.declaration.initializer && b.declaration.initializer.getStart() <= u.start && u.end <= b.declaration.initializer.getEnd()))

  // Distinctive contract "1" field names on values that are not bindings: loop variables and props.
  function renames(node: TS.Node): void {
    // ({ cheapest_plan }) => …: the property is now `from`; the local name stays.
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && ts.isObjectBindingPattern(node.parent)) {
      const prop = node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName : null
      const key = prop?.text ?? node.name.text
      if (key === 'cheapest_plan') {
        if (prop) a.edits.add(prop.getStart(), prop.getEnd(), 'from')
        else a.edits.add(node.name.getStart(), node.name.getStart(), 'from: ')
      } else if (key === 'pricing') {
        a.stray.push({ start: node.getStart(), text: node.getText(), reason: NO_MAPPING.pricing! })
      }
    }
    if (ts.isPropertyAccessExpression(node) && !a.uses.some((u) => u.start <= node.getStart() && node.getEnd() <= u.end)) {
      const name = node.name.text
      const at = node.name.getStart()
      if (name === 'cheapest_plan') a.edits.add(at, node.name.getEnd(), 'from')
      else if (name === 'store_name') a.edits.add(at, node.name.getEnd(), 'name')
      else if (name === 'website_domain') a.edits.add(at, node.name.getEnd(), 'domain')
      else if (name === 'business_info') a.edits.add(at, node.name.getEnd(), 'business')
      else if ((name === 'price' || name === 'original_price') && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'pricing') {
        a.edits.add(node.expression.name.getStart(), node.name.getEnd(), name)
      } else if (name === 'pricing' && !(ts.isPropertyAccessExpression(node.parent) && ['price', 'original_price'].includes(node.parent.name.text))) {
        a.stray.push({ start: node.getStart(), text: node.getText(), reason: NO_MAPPING.pricing! })
      } else if (name === 'page_type') {
        a.stray.push({ start: node.getStart(), text: node.getText(), reason: NO_MAPPING.page_type! })
      } else if (name === 'terms_of_service_url' || name === 'privacy_policy_url' || name === 'domains_enabled' || name === 'service_groups') {
        a.stray.push({ start: node.getStart(), text: node.getText(), reason: `${name} has moved: see the upgrade table (hct docs, upgrading.md)` })
      }
    }
    ts.forEachChild(node, renames)
  }
  renames(sf)

  for (const u of a.uses) {
    if ('text' in u.result) a.edits.add(u.start, u.end, u.result.text)
  }
  return a
}

/** Whether every use of a binding was rewritten, so its declaration can go. */
function fullyRewritten(a: FileAnalysis, b: Binding): boolean {
  return a.uses.filter((u) => u.binding === b).every((u) => 'text' in u.result || u.result.reason === '') &&
    a.bindings.filter((child) => child !== b && child.declaration.initializer && a.source.slice(child.declaration.initializer.getStart(), child.declaration.initializer.getEnd()).includes(b.name)).every((child) => fullyRewritten(a, child))
}

/**
 * A declaration statement with only the bindings that still have uses left
 * to convert, or null when none has. `const { data, store } = useHC()` with
 * only `data` left becomes `const { data } = useHC()`.
 */
function reducedStatement(ts: TypeScript, a: FileAnalysis, stmt: TS.VariableStatement): string | null {
  const bindings = a.bindings.filter((b) => b.statement === stmt)
  const kept = bindings.filter((b) => !fullyRewritten(a, b))
  if (kept.length === 0) return null
  if (kept.length === bindings.length) return stmt.getText()
  const decl = kept[0]!.declaration
  if (!ts.isObjectBindingPattern(decl.name) || stmt.declarationList.declarations.length !== 1) return stmt.getText()
  const elements = decl.name.elements.filter((el) => kept.some((b) => b.nameNode === el.name)).map((el) => el.getText())
  const keyword = stmt.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let'
  return `${keyword} { ${elements.join(', ')} } = ${decl.initializer!.getText()}`
}

// ─── Emitting ─────────────────────────────────────────────────────────────

function camel(id: string): string {
  return id.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('')
}

function fresh(base: string, taken: Set<string>): string {
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}${i}`
  taken.add(name)
  return name
}

interface Names {
  page: string
  store: string
  nav: string
  settings: Map<string, string>
}

function namesFor(taken: Set<string>, ids: string[]): Names {
  const t = new Set(taken)
  return {
    page: fresh('page', t),
    store: fresh('store', t),
    nav: fresh('nav', t),
    settings: new Map(ids.map((id) => [id, fresh(camel(id), t)])),
  }
}

/** Placeholders in a rendered text: which hooks it needs. */
function needs(text: string): { page: boolean; store: boolean; nav: boolean; settings: string[] } {
  const found = { page: false, store: false, nav: false, settings: new Set<string>() }
  for (const m of text.matchAll(PLACEHOLDER)) {
    const what = m[1]!
    if (what === 'page') found.page = true
    else if (what === 'store') found.store = true
    else if (what === 'nav') found.nav = true
    else found.settings.add(what.slice('setting:'.length))
  }
  return { page: found.page, store: found.store, nav: found.nav, settings: [...found.settings].sort() }
}

function hoists(text: string, names: Names, pageId: string | null): string[] {
  const n = needs(text)
  const lines: string[] = []
  if (n.page) lines.push(`const ${names.page} = usePage${pageId ? `<'${pageId}'>` : ''}()`)
  if (n.store) lines.push(`const ${names.store} = useStore()`)
  if (n.nav) lines.push(`const ${names.nav} = useNav()`)
  for (const id of n.settings) lines.push(`const ${names.settings.get(id)} = useSetting('${id}')`)
  return lines
}

function fill(text: string, names: Names): string {
  return text.replace(PLACEHOLDER, (_m, what: string) => {
    if (what === 'page') return names.page
    if (what === 'store') return names.store
    if (what === 'nav') return names.nav
    return names.settings.get(what.slice('setting:'.length))!
  })
}

/** Re-indents a block of code so its least indented line has `indent`. */
function reindent(code: string, indent: string): string {
  const lines = code.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n')
  const min = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)![0].length))
  return lines.map((l) => (l.trim() === '' ? '' : indent + l.slice(Number.isFinite(min) ? min : 0))).join('\n')
}

const NEW_HOOKS = ['usePage', 'useStore', 'useNav', 'useSetting']
const INTRINSIC_TAG = /^[a-z]/

/** The @hostcore/toolkit import a file needs, given its body. */
function toolkitImport(body: string, previous: Set<string>, extra: string[], typeNames: Set<string>): string | null {
  const used = (name: string) => new RegExp(`\\b${name}\\b`).test(body)
  const names = new Set<string>()
  for (const hook of NEW_HOOKS) if (used(`${hook}`)) names.add(hook)
  for (const name of previous) if (!NEW_HOOKS.includes(name) && used(name)) names.add(name)
  for (const name of extra) names.add(name)
  if (names.size === 0) return null
  const sorted = [...names].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
  return `import { ${sorted.map((n) => (typeNames.has(n) ? `type ${n}` : n)).join(', ')} } from '@hostcore/toolkit'`
}

function typeOnlyImports(ts: TypeScript, sf: TS.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
    const named = stmt.importClause.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const el of named.elements) if (stmt.importClause.isTypeOnly || el.isTypeOnly) out.add(el.name.text)
  }
  out.add('LayoutProps')
  out.add('PageProps')
  return out
}

/** The line of the `nth` whole-word occurrence of `needle` in `text`, or 0. */
function lineOf(text: string, needle: string, nth = 0): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...text.matchAll(new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`, 'g'))]
  const m = matches[Math.min(nth, matches.length - 1)]
  return m?.index === undefined ? 0 : text.slice(0, m.index).split('\n').length
}

/** Numbers repeated texts within one file, so each is located at its own occurrence. */
function occurrences(): (file: string, text: string) => number {
  const seen = new Map<string, number>()
  return (file, text) => {
    const key = `${file}\u0000${text}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n
  }
}

// ─── Converting one file ──────────────────────────────────────────────────

/**
 * Rewrites a component file in place: each function that read data through
 * a format-1 hook declares the format-2 hooks it needs where the first
 * declaration was. A declaration whose bindings are not all rewritten stays,
 * and its remaining uses are listed.
 */
function convertModule(ts: TypeScript, a: FileAnalysis, leftovers: Leftover[], outFile: string): string | null {
  const touched = a.uses.length > 0 || a.edits.render() !== a.source
  if (!touched && a.stray.length === 0) return null
  const names = namesFor(new Set([...a.identifiers].filter((n) => !a.bindings.some((b) => b.name === n))), [...STANDARD_IDS])

  // Group root statements by the function they are in.
  const byFunction = new Map<TS.Node, TS.VariableStatement[]>()
  for (const b of a.bindings) {
    let fn: TS.Node | undefined = b.statement.parent
    while (fn && !ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent
    if (!fn) continue
    const list = byFunction.get(fn) ?? []
    if (!list.includes(b.statement)) list.push(b.statement)
    byFunction.set(fn, list)
  }
  for (const [fn, statements] of byFunction) {
    statements.sort((x, y) => x.getStart() - y.getStart())
    const first = statements[0]!
    const bodyText = a.edits.render(fn.getStart(), fn.getEnd())
    const indent = (a.source.slice(a.source.lastIndexOf('\n', first.getStart()) + 1, first.getStart()).match(/^\s*/) ?? [''])[0]
    const decls = hoists(bodyText, names, null)
    for (const s of statements) {
      const reduced = reducedStatement(ts, a, s)
      if (reduced === null) a.edits.add(s.getFullStart(), s.getEnd(), '')
      else if (reduced !== s.getText()) a.edits.add(s.getStart(), s.getEnd(), reduced)
    }
    if (decls.length > 0) {
      a.edits.add(first.getFullStart(), first.getFullStart(), `\n${decls.map((d) => indent + d).join('\n')}`)
    }
  }
  // The toolkit import, rebuilt from what the rewritten file uses.
  const imports = a.sf.statements.filter((s): s is TS.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === '@hostcore/toolkit')
  for (const imp of imports) a.edits.add(imp.getStart(), imp.getEnd(), '')
  const withoutImports = fill(a.edits.render(), names)
  const line = toolkitImport(withoutImports, a.toolkitImports, [], typeOnlyImports(ts, a.sf))
  let text = withoutImports
  if (line) {
    const at = imports[0] ? a.edits.render(0, imports[0].getStart()).length : 0
    text = imports[0] ? `${withoutImports.slice(0, at)}${line}${withoutImports.slice(at)}` : `${line}\n${withoutImports}`
  }
  const nth = occurrences()
  for (const u of a.uses) {
    if ('reason' in u.result && u.result.reason !== '') {
      leftovers.push({ kind: 'data', file: outFile, line: lineOf(text, u.original, nth(outFile, u.original)), text: `${u.original}: ${u.result.reason}` })
    }
  }
  for (const s of a.stray) leftovers.push({ kind: 'data', file: outFile, line: lineOf(text, s.text, nth(outFile, s.text)), text: `${s.text}: ${s.reason}` })
  return text
}

// ─── App ──────────────────────────────────────────────────────────────────

interface AppShape {
  app: TS.FunctionLikeDeclaration
  body: TS.Block
  /** Page id → the statements (as source ranges) that render it, or the expression it returns. */
  pages: Map<string, { kind: 'statements'; ranges: Array<[number, number]>; returns: [number, number] | null } | { kind: 'component'; name: string } | { kind: 'expression'; range: [number, number] }>
  /** The layout's JSX, the source range of the page inside it, and the range of the whole return. */
  layout: { jsx: [number, number]; outlet: [number, number] } | null
  /** Statements of App that are not part of the page selection, by range. */
  others: TS.Statement[]
  /** The module-level page map, which is not carried over. */
  mapStatement: TS.Statement | null
  /** Where App reads page_type to pick the page: consumed by the conversion. */
  selectors: Array<[number, number]>
}

function findApp(ts: TypeScript, sf: TS.SourceFile): { fn: TS.FunctionLikeDeclaration; body: TS.Block } | null {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'App' && stmt.body) return { fn: stmt, body: stmt.body }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'App' && d.initializer) {
          const init = unwrap(ts, d.initializer)
          if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) return { fn: init, body: init.body }
        }
      }
    }
  }
  return null
}

function isPageTypeAccess(ts: TypeScript, e: TS.Expression): boolean {
  const u = unwrap(ts, e)
  return ts.isPropertyAccessExpression(u) && u.name.text === 'page_type'
}

function caseLabels(ts: TypeScript, clause: TS.CaseOrDefaultClause): string[] | 'default' {
  if (ts.isDefaultClause(clause)) return 'default'
  const e = unwrap(ts, clause.expression)
  if (ts.isStringLiteralLike(e) && LEGACY_PAGE_IDS[e.text]) return [LEGACY_PAGE_IDS[e.text]!]
  return []
}

function analyseApp(ts: TypeScript, sf: TS.SourceFile, a: FileAnalysis): AppShape {
  const found = findApp(ts, sf)
  if (!found) throw new UpgradeError('src/App has no App component (export function App or export const App)')
  const { fn, body } = found
  const pages: AppShape['pages'] = new Map()
  let layout: AppShape['layout'] = null
  const used = new Set<TS.Statement>()
  let mapStatement: TS.Statement | null = null
  const selectors: Array<[number, number]> = []

  // A page switch.
  const sw = body.statements.find((s): s is TS.SwitchStatement => ts.isSwitchStatement(s) && isPageTypeAccess(ts, s.expression))
  if (sw) {
    used.add(sw)
    selectors.push([sw.expression.getStart(), sw.expression.getEnd()])
    let pending: string[] = []
    let assigned: string | null = null
    const defaultIds = new Set(PAGE_ORDER)
    let defaultEntry: AppShape['pages'] extends Map<string, infer V> ? V : never = null as never
    for (const clause of sw.caseBlock.clauses) {
      const labels = caseLabels(ts, clause)
      if (labels !== 'default' && labels.length === 0) {
        const text = ts.isCaseClause(clause) ? clause.expression.getText() : ''
        throw new UpgradeError(`App's page switch has a case hct upgrade does not know: ${text}`)
      }
      let statements: TS.Statement[] = [...clause.statements]
      if (statements.length === 1 && ts.isBlock(statements[0]!)) statements = [...(statements[0] as TS.Block).statements]
      if (statements.length === 0) {
        if (labels !== 'default') pending.push(...labels)
        continue
      }
      statements = statements.filter((s) => !ts.isBreakStatement(s))
      const last = statements[statements.length - 1]
      let entry: { kind: 'statements'; ranges: Array<[number, number]>; returns: [number, number] | null }
      if (last && ts.isReturnStatement(last)) {
        entry = { kind: 'statements', ranges: statements.map((s) => [s.getStart(), s.getEnd()]), returns: null }
      } else if (last && ts.isExpressionStatement(last) && ts.isBinaryExpression(last.expression) && last.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(last.expression.left)) {
        const target = last.expression.left.text
        if (assigned && assigned !== target) throw new UpgradeError(`App's page switch assigns both ${assigned} and ${target}`)
        assigned = target
        entry = {
          kind: 'statements',
          ranges: statements.slice(0, -1).map((s) => [s.getStart(), s.getEnd()]),
          returns: [last.expression.right.getStart(), last.expression.right.getEnd()],
        }
      } else {
        throw new UpgradeError("each case of App's page switch must end with a return or with an assignment of the page to one variable")
      }
      const ids = labels === 'default' ? [] : [...pending, ...labels]
      pending = []
      for (const id of ids) {
        pages.set(id, entry)
        defaultIds.delete(id)
      }
      if (labels === 'default') defaultEntry = entry
    }
    if (defaultEntry) for (const id of defaultIds) if (!pages.has(id)) pages.set(id, defaultEntry)
    if (assigned) {
      const ret = body.statements.find((s): s is TS.ReturnStatement => ts.isReturnStatement(s) && s.getStart() > sw.getEnd())
      if (!ret?.expression) throw new UpgradeError(`App assigns the page to ${assigned} but does not return it`)
      const outlet = findExpressionContainer(ts, ret.expression, (e) => ts.isIdentifier(e) && e.text === assigned)
      if (!outlet) throw new UpgradeError(`App's return does not render {${assigned}}`)
      layout = { jsx: [ret.expression.getStart(), ret.expression.getEnd()], outlet }
      used.add(ret)
      for (const s of body.statements) {
        if (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === assigned)) used.add(s)
      }
    }
  } else {
    // A page map: const Page = pages[data.page_type] ?? NotFound, rendered as <Page/>.
    let mapName: string | null = null
    let pageVar: string | null = null
    let fallback: string | null = null
    for (const s of body.statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const d of s.declarationList.declarations) {
        if (!d.initializer || !ts.isIdentifier(d.name)) continue
        let init = unwrap(ts, d.initializer)
        let fb: string | null = null
        if (ts.isBinaryExpression(init) && (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || init.operatorToken.kind === ts.SyntaxKind.BarBarToken) && ts.isIdentifier(unwrap(ts, init.right))) {
          fb = (unwrap(ts, init.right) as TS.Identifier).text
          init = unwrap(ts, init.left)
        }
        if (ts.isElementAccessExpression(init) && ts.isIdentifier(unwrap(ts, init.expression)) && isPageTypeAccess(ts, init.argumentExpression)) {
          mapName = (unwrap(ts, init.expression) as TS.Identifier).text
          selectors.push([init.argumentExpression.getStart(), init.argumentExpression.getEnd()])
          pageVar = d.name.text
          fallback = fb
          used.add(s)
        }
      }
    }
    if (!mapName || !pageVar) {
      throw new UpgradeError(
        "App has neither a page switch (switch (data.page_type) { … }) nor a page map (pages[data.page_type]); hct upgrade cannot tell which code renders which page. Move each page to src/pages/<page-id>.tsx by hand.",
      )
    }
    const mapDecl = [...sf.statements, ...body.statements].flatMap((s) => (ts.isVariableStatement(s) ? [...s.declarationList.declarations].map((d) => ({ s, d })) : [])).find(({ d }) => ts.isIdentifier(d.name) && d.name.text === mapName)
    const literal = mapDecl?.d.initializer ? unwrap(ts, mapDecl.d.initializer) : null
    if (!mapDecl || !literal || !ts.isObjectLiteralExpression(literal)) throw new UpgradeError(`the page map ${mapName} is not an object literal hct upgrade can read`)
    used.add(mapDecl.s)
    mapStatement = mapDecl.s
    for (const prop of literal.properties) {
      const key = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) ? prop.name.text : null
      const id = key ? LEGACY_PAGE_IDS[key] : undefined
      if (!id) throw new UpgradeError(`the page map ${mapName} has a key hct upgrade does not know: ${prop.name?.getText() ?? prop.getText()}`)
      if (ts.isShorthandPropertyAssignment(prop)) pages.set(id, { kind: 'component', name: prop.name.text })
      else if (ts.isPropertyAssignment(prop)) {
        const value = unwrap(ts, prop.initializer)
        if (ts.isIdentifier(value)) pages.set(id, { kind: 'component', name: value.text })
        else if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && value.parameters.length === 0) {
          if (ts.isBlock(value.body)) {
            pages.set(id, { kind: 'statements', ranges: value.body.statements.map((s) => [s.getStart(), s.getEnd()]), returns: null })
          } else {
            pages.set(id, { kind: 'expression', range: [value.body.getStart(), value.body.getEnd()] })
          }
        } else {
          throw new UpgradeError(`the page map ${mapName} maps ${key} to something that is not a component`)
        }
      }
    }
    if (fallback) for (const id of PAGE_ORDER) if (!pages.has(id)) pages.set(id, { kind: 'component', name: fallback })
    const ret = [...body.statements].reverse().find((s): s is TS.ReturnStatement => ts.isReturnStatement(s))
    if (!ret?.expression) throw new UpgradeError('App does not return anything')
    used.add(ret)
    const element = findJsxElement(ts, ret.expression, pageVar)
    if (!element) throw new UpgradeError(`App's return does not render <${pageVar} />`)
    const whole = unwrap(ts, ret.expression)
    if (element[0] === whole.getStart() && element[1] === whole.getEnd()) {
      layout = null
    } else {
      layout = { jsx: [ret.expression.getStart(), ret.expression.getEnd()], outlet: element }
    }
  }
  const others = body.statements.filter((s) => !used.has(s) && !(ts.isVariableStatement(s) && s.declarationList.declarations.every((d) => a.bindings.some((b) => b.declaration === d))))
  return { app: fn, body, pages, layout, others, mapStatement, selectors }
}

/** The range of the JSX expression container `{x}` whose expression matches. */
function findExpressionContainer(ts: TypeScript, root: TS.Node, match: (e: TS.Expression) => boolean): [number, number] | null {
  let found: [number, number] | null = null
  const visit = (n: TS.Node): void => {
    if (found) return
    if (ts.isJsxExpression(n) && n.expression && match(unwrap(ts, n.expression))) {
      found = [n.getStart(), n.getEnd()]
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return found
}

/** The range of `<Name />` (without attributes) inside `root`. */
function findJsxElement(ts: TypeScript, root: TS.Node, name: string): [number, number] | null {
  let found: [number, number] | null = null
  const visit = (n: TS.Node): void => {
    if (found) return
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === name) {
      if (n.attributes.properties.length > 0) throw new UpgradeError(`App renders <${name}> with props; a format-2 page gets its data from the page props and hooks instead`)
      found = [n.getStart(), n.getEnd()]
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return found
}

function declaredNames(ts: TypeScript, s: TS.Statement): string[] {
  if (ts.isVariableStatement(s)) {
    const out: string[] = []
    const visit = (n: TS.BindingName) => {
      if (ts.isIdentifier(n)) out.push(n.text)
      else for (const el of n.elements) if (!ts.isOmittedExpression(el)) visit(el.name)
    }
    for (const d of s.declarationList.declarations) visit(d.name)
    return out
  }
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) return [s.name.text]
  return []
}

function references(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text)
}

/** A relative import specifier as seen from one directory deeper. */
function deeper(spec: string): string {
  if (spec.startsWith('./')) return `../${spec.slice(2)}`
  if (spec.startsWith('../')) return `../${spec}`
  return spec
}

interface GeneratedFile {
  path: string
  text: string
}

function convertApp(ts: TypeScript, a: FileAnalysis, appFile: string, leftovers: Leftover[], done: string[]): GeneratedFile[] {
  const sf = a.sf
  const shape = analyseApp(ts, sf, a)
  // Reading page_type to pick the page is what the conversion replaces.
  for (const u of a.uses) {
    if (shape.selectors.some(([s, e]) => s <= u.start && u.end <= e)) u.result = { reason: '' }
  }
  const files: GeneratedFile[] = []
  const types = typeOnlyImports(ts, sf)
  /** The leading whitespace of the line `pos` is on, so a block keeps its shape when re-indented. */
  const indentAt = (pos: number) => (a.source.slice(a.source.lastIndexOf('\n', pos - 1) + 1, pos).match(/^[ \t]*/) ?? [''])[0]
  const block = (start: number, end: number, lead = '') => reindent(`${indentAt(start)}${lead}${a.edits.render(start, end)}`, '')

  // Module-level declarations other than App and the page map move to src/shared.tsx.
  const appStatement = sf.statements.find((s) => s.getStart() <= shape.app.getStart() && shape.app.getEnd() <= s.getEnd())
  const imports = sf.statements.filter((s): s is TS.ImportDeclaration => ts.isImportDeclaration(s))
  const moduleDecls = sf.statements.filter((s) => s !== appStatement && !ts.isImportDeclaration(s) && !(ts.isExportDeclaration(s) || ts.isExportAssignment(s)))
  const shared = moduleDecls.filter((s) => s !== shape.mapStatement)
  const sharedNames = new Set(shared.flatMap((s) => declaredNames(ts, s)))

  const importLines = (body: string, depth: 0 | 1, extraToolkit: string[], sideEffects: boolean): string[] => {
    const lines: string[] = []
    const tk = toolkitImport(body, a.toolkitImports, extraToolkit, types)
    if (tk) lines.push(tk)
    for (const imp of imports) {
      const spec = (imp.moduleSpecifier as TS.StringLiteral).text
      if (spec === '@hostcore/toolkit') continue
      const target = depth === 1 ? deeper(spec) : spec
      const clause = imp.importClause
      if (!clause) {
        if (sideEffects) lines.push(`import '${target}'`)
        continue
      }
      const parts: string[] = []
      if (clause.name && references(body, clause.name.text)) parts.push(clause.name.text)
      const nb = clause.namedBindings
      if (nb && ts.isNamespaceImport(nb) && references(body, nb.name.text)) parts.push(`* as ${nb.name.text}`)
      if (nb && ts.isNamedImports(nb)) {
        const named = nb.elements.filter((el) => references(body, el.name.text)).map((el) => el.getText())
        if (named.length > 0) parts.push(`{ ${named.join(', ')} }`)
      }
      if (parts.length > 0) lines.push(`import ${clause.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from '${target}'`)
    }
    const fromShared = [...sharedNames].filter((n) => references(body, n)).sort()
    if (fromShared.length > 0) lines.push(`import { ${fromShared.join(', ')} } from '${depth === 1 ? '../shared' : './shared'}'`)
    return lines
  }

  const otherStatements = (body: string, forLayout: boolean): string[] => {
    const out: string[] = []
    for (const s of shape.others) {
      const names = declaredNames(ts, s)
      if ((names.length > 0 && names.some((n) => references(body, n))) || (names.length === 0 && forLayout)) {
        out.push(block(s.getStart(), s.getEnd()))
      }
    }
    return out
  }

  /** Bindings App declares whose uses inside `ranges` are not all rewritten. */
  const keptDeclarations = (ranges: Array<[number, number]>): string[] => {
    const statements = new Set<TS.VariableStatement>()
    for (const u of a.uses) {
      if ('text' in u.result || u.result.reason === '') continue
      if (!ranges.some(([s, e]) => s <= u.start && u.end <= e)) continue
      if (u.binding.statement.getStart() >= shape.body.getStart() && u.binding.statement.getEnd() <= shape.body.getEnd() && !ranges.some(([s, e]) => s <= u.binding.statement.getStart() && u.binding.statement.getEnd() <= e)) {
        statements.add(u.binding.statement)
      }
    }
    return [...statements].sort((x, y) => x.getStart() - y.getStart()).flatMap((s) => reducedStatement(ts, a, s) ?? [])
  }

  // Statements inside the ranges that declare bindings are removed when every use was rewritten.
  for (const b of a.bindings) {
    if (fullyRewritten(a, b) && a.bindings.filter((x) => x.statement === b.statement).every((x) => fullyRewritten(a, x))) {
      a.edits.add(b.statement.getStart(), b.statement.getEnd(), '')
    }
  }

  const componentFile = (path: string, name: string, pageId: string | null, depth: 0 | 1, kept: string[], bodyLines: string[], extraToolkit: string[], sideEffects: boolean) => {
    const rawBody = bodyLines.join('\n')
    const others = otherStatements(rawBody, pageId === null)
    const inner = [...others, ...bodyLines].join('\n')
    const names = namesFor(new Set([...a.identifiers].filter((n) => !a.bindings.some((b) => b.name === n))), [...STANDARD_IDS])
    const hoisted = hoists(inner, names, pageId)
    const body = fill([...hoisted, ...kept, ...others, ...bodyLines].join('\n'), names)
    const head = importLines(body, depth, extraToolkit, sideEffects)
    const signature = `export default function ${name}()`
    const text = `${head.join('\n')}${head.length ? '\n\n' : ''}${signature} {\n${reindent(body, '  ')}\n}\n`
    files.push({ path, text })
  }

  const hasLayout = shape.layout !== null
  const pageIds = PAGE_ORDER.filter((id) => shape.pages.has(id))
  for (const id of pageIds) {
    const entry = shape.pages.get(id)!
    const path = `src/pages/${id}.tsx`
    if (entry.kind === 'component') {
      const body = `export { ${entry.name} as default }`
      const fromApp = imports.find((imp) => {
        const nb = imp.importClause?.namedBindings
        return (imp.importClause?.name?.text === entry.name) || (nb && ts.isNamedImports(nb) && nb.elements.some((el) => el.name.text === entry.name))
      })
      let text: string
      if (fromApp) {
        const spec = deeper((fromApp.moduleSpecifier as TS.StringLiteral).text)
        const isDefault = fromApp.importClause?.name?.text === entry.name
        text = isDefault ? `export { default } from '${spec}'\n` : `export { ${entry.name} as default } from '${spec}'\n`
      } else if (sharedNames.has(entry.name)) {
        text = `${body} from '../shared'\n`
      } else {
        throw new UpgradeError(`the page map maps a page to ${entry.name}, which App neither declares nor imports`)
      }
      if (!hasLayout) {
        const css = imports.filter((imp) => !imp.importClause).map((imp) => `import '${deeper((imp.moduleSpecifier as TS.StringLiteral).text)}'`)
        text = `${css.join('\n')}${css.length ? '\n' : ''}${text}`
      }
      files.push({ path, text })
    } else if (entry.kind === 'expression') {
      componentFile(path, COMPONENT_NAMES[id]!, id, 1, keptDeclarations([entry.range]), [reindent(`${indentAt(entry.range[0])}return ${a.edits.render(entry.range[0], entry.range[1])}`, '')], [], !hasLayout)
    } else {
      const lines = entry.ranges.map(([s, e]) => block(s, e))
      if (entry.returns) lines.push(reindent(`${indentAt(entry.returns[0])}return ${a.edits.render(entry.returns[0], entry.returns[1])}`, ''))
      const kept = keptDeclarations(entry.ranges.concat(entry.returns ? [entry.returns] : []))
      componentFile(path, COMPONENT_NAMES[id]!, id, 1, kept, lines.filter((l) => l.trim() !== ''), [], !hasLayout)
    }
    done.push(`${path}: the ${id} page from App`)
  }

  if (shape.layout) {
    const [js, je] = shape.layout.jsx
    const [os, oe] = shape.layout.outlet
    const jsx = `${a.edits.render(js, os)}<Outlet />${a.edits.render(oe, je)}`
    const kept = keptDeclarations([shape.layout.jsx, ...shape.others.map((o): [number, number] => [o.getStart(), o.getEnd()])])
    componentFile('src/layout.tsx', 'Layout', null, 0, kept, [reindent(`${indentAt(js)}return ${jsx}`, '')], ['Outlet'], true)
    done.push('src/layout.tsx: the markup App renders around the page, with <Outlet /> where the page goes')
    leftovers.push({ kind: 'other', file: 'src/layout.tsx', line: 0, text: `the layout also wraps the platform's guarded pages (${MINIMAL_LAYOUT_PAGE_IDS.join(', ')}); take the variant prop ({ variant }: LayoutProps) and render less for "minimal"` })
  }

  if (shared.length > 0) {
    const declarations = shared.map((s) => {
      const text = s.getText()
      return /^export\s/.test(text) ? text : `export ${text}`
    })
    const body = declarations.join('\n\n')
    const used = imports.filter((imp) => {
      const clause = imp.importClause
      if (!clause) return false
      const nb = clause.namedBindings
      const names = [clause.name?.text, ...(nb && ts.isNamedImports(nb) ? nb.elements.map((el) => el.name.text) : []), nb && ts.isNamespaceImport(nb) ? nb.name.text : undefined]
      return names.some((n) => n !== undefined && references(body, n))
    })
    const sharedAnalysis = analyse(ts, 'src/shared.tsx', `${used.map((i) => i.getText()).join('\n')}\n\n${body}\n`)
    const converted = convertModule(ts, sharedAnalysis, leftovers, 'src/shared.tsx') ?? sharedAnalysis.source
    files.push({ path: 'src/shared.tsx', text: `${converted.trim()}\n` })
    done.push(`src/shared.tsx: ${[...sharedNames].join(', ')}, moved out of App so pages and the layout can import them`)
  }

  // Leftovers in what App's pages and layout now contain.
  // (What moved to src/shared.tsx was reported when it was converted.)
  const selecting = (start: number) => shape.selectors.some(([s, e]) => s <= start && start < e)
  const inApp = (start: number) => shape.body.getStart() <= start && start < shape.body.getEnd()
  const nth = occurrences()
  const locate = (text: string) => {
    const file = files.find((f) => lineOf(f.text, text) > 0)
    return { file: file?.path ?? appFile, line: file ? lineOf(file.text, text, nth(file.path, text)) : 0 }
  }
  for (const u of a.uses) {
    if ('reason' in u.result && u.result.reason !== '' && !selecting(u.start) && inApp(u.start)) {
      leftovers.push({ kind: 'data', ...locate(u.original), text: `${u.original}: ${u.result.reason}` })
    }
  }
  for (const s of a.stray.filter((x) => !selecting(x.start) && inApp(x.start))) {
    leftovers.push({ kind: 'data', ...locate(s.text), text: `${s.text}: ${s.reason}` })
  }
  const leftOver = shape.others.filter((s) => declaredNames(ts, s).length > 0 && !files.some((f) => declaredNames(ts, s).some((n) => references(f.text, n))))
  for (const s of leftOver) leftovers.push({ kind: 'other', file: appFile, line: 0, text: `App declared ${declaredNames(ts, s).join(', ')}, which no page or layout uses; it was dropped` })
  if (!hasLayout) {
    for (const s of shape.others.filter((x) => declaredNames(ts, x).length === 0)) {
      leftovers.push({ kind: 'other', file: appFile, line: 0, text: `App ran ${s.getText().split('\n')[0]}…, which has no place without a layout; it was dropped` })
    }
  }
  return files
}

// ─── The template ─────────────────────────────────────────────────────────

function loadTypeScript(root: string): TypeScript {
  for (const from of [join(root, 'package.json'), import.meta.url]) {
    try {
      return createRequire(from)('typescript') as TypeScript
    } catch {
      continue
    }
  }
  throw new UpgradeError('hct upgrade reads your source with TypeScript; install it first (bun add -d typescript)')
}

async function listSource(root: string, dir = 'src'): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries.sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...(await listSource(root, rel)))
    else if (e.isFile() && SOURCE_EXTENSIONS.some((x) => e.name.endsWith(x)) && !/\.d\.ts$/.test(e.name)) out.push(rel)
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Specifiers in `text` that resolve into `fromDir` (a path relative to the root), rewritten to `toDir`. */
function moveSpecifiers(text: string, file: string, fromDir: string, toDir: string): string {
  return text.replace(/(from\s+|import\s+|import\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g, (m, lead: string, q: string, spec: string) => {
    const resolved = posix.normalize(posix.join(posix.dirname(file), spec))
    if (resolved !== fromDir && !resolved.startsWith(`${fromDir}/`)) return m
    const moved = toDir + resolved.slice(fromDir.length)
    let rel = posix.relative(posix.dirname(file), moved)
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `${lead}${q}${rel}${q}`
  })
}

/** Works out the whole upgrade without touching the template. */
export async function planUpgrade(root: string): Promise<UpgradePlan> {
  const template = await loadTemplate(root)
  if (isFormat2(template)) throw new UpgradeError('this template is already format 2')
  const ts = loadTypeScript(root)
  const plan: UpgradePlan = { writes: new Map(), deletes: new Set(), moves: [], leftovers: [], done: [] }

  const files = await listSource(root)
  const appFile = files.find((f) => /^src\/App\.(tsx|jsx|ts|js)$/.test(f))
  if (!appFile) throw new UpgradeError('a format-1 template has its App in src/App.tsx; there is none here')

  // Format-2 reads src/pages/, src/islands/ and src/layout.* by name. Format-1
  // files there are moved aside so they are not taken for pages, islands or a layout.
  const reserved: Array<[string, string]> = []
  for (const [dir, to] of [
    ['src/pages', 'src/views'],
    ['src/islands', 'src/widgets'],
  ] as const) {
    if (files.some((f) => f.startsWith(`${dir}/`))) {
      let target: string = to
      for (let i = 2; await exists(join(root, target)); i++) target = `${to}${i}`
      reserved.push([dir, target])
    }
  }
  for (const f of files) {
    if (/^src\/layout\.(tsx|jsx|ts|js)$/.test(f)) reserved.push([f, f.replace('src/layout.', 'src/frame.')])
  }
  plan.moves.push(...reserved)
  const movedPath = (f: string) => {
    for (const [from, to] of reserved) if (f === from || f.startsWith(`${from}/`)) return to + f.slice(from.length)
    return f
  }

  const settingIds = new Set<string>()
  for (const file of files) {
    let source = await readFile(join(root, file), 'utf8')
    const outFile = movedPath(file)
    for (const [from, to] of reserved) source = moveSpecifiers(source, file, from.replace(/\.(tsx|jsx|ts|js)$/, ''), to.replace(/\.(tsx|jsx|ts|js)$/, ''))
    const a = analyse(ts, file, source)
    for (const u of a.uses) {
      if ('text' in u.result) for (const m of u.result.text.matchAll(/\u0000setting:([^\u0000]+)\u0000/g)) settingIds.add(m[1]!)
    }
    if (file === appFile) {
      const generated = convertApp(ts, a, appFile, plan.leftovers, plan.done)
      for (const g of generated) plan.writes.set(g.path, g.text)
      plan.deletes.add(appFile)
      plan.done.push(`${appFile}: removed; its pages, layout and helpers are in the files above`)
      continue
    }
    const converted = convertModule(ts, a, plan.leftovers, outFile)
    const changed = converted ?? source
    if (converted !== null || outFile !== file || changed !== (await readFile(join(root, file), 'utf8'))) {
      plan.writes.set(outFile, changed)
      if (converted !== null) plan.done.push(`${outFile}: data access rewritten to the format-2 hooks`)
    }
  }
  for (const [from, to] of reserved) plan.done.push(`${from} → ${to}: format 2 reads ${from} by name, so the format-1 files there moved`)

  // template.json
  const manifestRaw = JSON.parse(await readFile(join(root, 'template.json'), 'utf8')) as Record<string, unknown>
  const declared = Array.isArray(manifestRaw.settings) ? (manifestRaw.settings as Array<{ id: string }>) : []
  const newSettings = [...settingIds].sort().filter((id) => !declared.some((s) => s.id === id))
  const settings = [...declared, ...STANDARD_SETTINGS.filter((s) => newSettings.includes(s.id))]
  const { format: _f, contract: _c, toolchain: _t, tokens, settings: _s, ...rest } = manifestRaw
  const manifest = { ...rest, format: 2, contract: '2026-11', toolchain: TOOLCHAIN.line, tokens: tokens ?? {}, settings }
  plan.writes.set('template.json', `${JSON.stringify(manifest, null, 2)}\n`)
  plan.done.push(`template.json: format 2, contract 2026-11, toolchain ${TOOLCHAIN.line}`)
  if (newSettings.length > 0) {
    plan.done.push(`template.json: declared the standard settings it reads: ${newSettings.join(', ')}`)
    plan.leftovers.push({
      kind: 'setting',
      file: 'template.json',
      line: 0,
      text: `${newSettings.join(', ')}: declared with the platform's standard label, limits and default; set your own default and label`,
    })
  }

  // package.json
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, any>
  const changes: string[] = []
  for (const group of ['dependencies', 'devDependencies'] as const) {
    const deps = (pkg[group] ??= {}) as Record<string, string>
    for (const name of FORMAT2_REQUIRED[group]) {
      const other = group === 'dependencies' ? pkg.devDependencies : pkg.dependencies
      if (!(name in deps) && !(other && name in other)) {
        deps[name] = FORMAT2_PACKAGE_RANGES[name]!
        changes.push(`${name} ${deps[name]} (added)`)
      }
    }
    for (const name of Object.keys(deps)) {
      const range = FORMAT2_PACKAGE_RANGES[name]
      if (range && deps[name] !== range) {
        changes.push(`${name} ${deps[name]} → ${range}`)
        deps[name] = range
      }
    }
  }
  if (changes.length > 0) {
    plan.writes.set('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
    plan.done.push(`package.json: ${changes.join(', ')}`)
  }
  plan.leftovers.push({ kind: 'other', file: 'package.json', line: 0, text: '@hostcore/toolkit must point at a toolkit version that builds format 2; then run bun install' })

  // Files format 2 does not read.
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'index.html', 'dev', 'mocks']) {
    if (await exists(join(root, name))) {
      plan.leftovers.push({ kind: 'other', file: name, line: 0, text: 'format 2 does not use it: hct dev previews the template and hct build builds it; delete it' })
    }
  }

  // Hand-built platform URLs in what the template will contain.
  const finalSources = new Map<string, string>()
  for (const f of files) {
    if (plan.deletes.has(f)) continue
    const out = movedPath(f)
    finalSources.set(out, plan.writes.get(out) ?? (await readFile(join(root, f), 'utf8')))
  }
  for (const [path, text] of plan.writes) if (/\.(tsx|jsx|ts|js)$/.test(path)) finalSources.set(path, text)
  for (const [file, text] of [...finalSources].sort(([x], [y]) => (x < y ? -1 : 1))) {
    text.split('\n').forEach((line, i) => {
      for (const u of HAND_BUILT_URLS) {
        const m = new RegExp(`(['"\`])/${u.segment}(?=[/?#'"\`$]|$)`).exec(line)
        if (m) plan.leftovers.push({ kind: 'url', file, line: i + 1, text: `"/${u.segment}…" is built by hand; use ${u.use}` })
      }
      const slug = /`\/\$\{[^}]*slug[^}]*\}(\/\$\{[^}]*slug[^}]*\})?/.exec(line)
      if (slug) plan.leftovers.push({ kind: 'url', file, line: i + 1, text: `${slug[0]}\` is built from slugs; use ${slug[1] ? 'service.url' : 'group.url'}` })
    })
  }
  return plan
}

/** Applies a plan to a copy of the template, checks the copy, and swaps it in. */
export async function applyUpgrade(root: string, plan: UpgradePlan): Promise<void> {
  const parent = dirname(root)
  const name = basename(root)
  const work = join(parent, `.${name}.hct-upgrade-${process.pid}`)
  const backup = join(parent, `.${name}.hct-backup-${process.pid}`)
  await rm(work, { recursive: true, force: true })
  try {
    await cp(root, work, { recursive: true, filter: (src) => relative(root, src).split(sep)[0] !== 'node_modules' })
    for (const [from, to] of plan.moves) {
      await mkdir(dirname(join(work, to)), { recursive: true })
      await rename(join(work, from), join(work, to))
    }
    for (const path of plan.deletes) await rm(join(work, path), { force: true })
    for (const [path, text] of plan.writes) {
      await mkdir(dirname(join(work, path)), { recursive: true })
      await writeFile(join(work, path), text)
    }
    const upgraded = await loadTemplate(work)
    if (!isFormat2(upgraded)) throw new UpgradeError('the upgraded template.json is not format 2')
    const { problems } = await discoverSources(work)
    if (problems.length > 0) {
      throw new UpgradeError(`the upgrade would leave a template format 2 cannot read; nothing was changed:\n${problems.map((p) => `  ${p.file}: ${p.message}`).join('\n')}`)
    }
  } catch (e) {
    await rm(work, { recursive: true, force: true })
    throw e
  }

  // Swap: the original becomes the backup, the copy takes its place, and the
  // installed packages move across. Any failure puts the original back.
  await rename(root, backup)
  try {
    await rename(work, root)
  } catch (e) {
    await rename(backup, root)
    await rm(work, { recursive: true, force: true })
    throw e
  }
  if (await exists(join(backup, 'node_modules'))) await rename(join(backup, 'node_modules'), join(root, 'node_modules'))
  await rm(backup, { recursive: true, force: true })
}

export function formatPlan(plan: UpgradePlan, dryRun: boolean): string {
  const out: string[] = [dryRun ? 'hct upgrade would make these changes (nothing was changed):' : 'hct upgrade made these changes:']
  for (const d of plan.done) out.push(`  ${d}`)
  const groups: Array<[Leftover['kind'], string]> = [
    ['url', 'Hand-built platform URLs: take them from the payload instead'],
    ['data', 'Data access with no one-to-one mapping'],
    ['setting', 'Settings to review'],
    ['other', 'Also'],
  ]
  const left = plan.leftovers
  out.push('', left.length === 0 ? 'Nothing is left for you to convert.' : 'Left for you:')
  for (const [kind, title] of groups) {
    const items = left.filter((l) => l.kind === kind)
    if (items.length === 0) continue
    out.push(`  ${title}`)
    for (const l of items) out.push(`    ${l.file}${l.line > 0 ? `:${l.line}` : ''}  ${l.text}`)
  }
  out.push('', 'Then: bun install, hct validate, hct dev and hct check.', '')
  return out.join('\n')
}

/** hct upgrade [dir] [--dry-run] */
export async function upgradeCommand(root: string, flags: Flags): Promise<number> {
  const dryRun = flags['dry-run'] === true
  const plan = await planUpgrade(root)
  if (!dryRun) await applyUpgrade(root, plan)
  process.stdout.write(formatPlan(plan, dryRun))
  return 0
}
