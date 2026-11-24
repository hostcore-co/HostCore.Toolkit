import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { Glob } from 'bun'
import {
  BANNED_IMPORT_PREFIXES,
  BANNED_PATTERNS,
  PLATFORM_ALLOWED_DEV_PACKAGES,
  PLATFORM_ALLOWED_PACKAGES,
  SDK_PACKAGES,
  platformUrlAdvice,
  platformUrlsIn,
  SOURCE_GLOB,
  STYLESHEET_GLOB,
} from './policy'
import { discoverSources, SOURCE_EXTENSIONS } from './sources'
import { PAGES } from '../contract/dist/ts/registry'
import { externalStylesheetUrls } from './stylesheet'
import { isFormat2, type LoadedTemplate } from './template'

export interface Finding {
  file: string
  line: number
  rule: string
  message: string
}

export interface ValidationResult {
  findings: Finding[]
  filesScanned: number
}

/** Directories that are outputs or tooling, not template source. */
const SKIP_DIRECTORIES = ['node_modules/', 'dist/', '.vite/', 'build/']

/**
 * Checks a template against the platform build policy.
 *
 * Two independent passes, because they catch different mistakes:
 *
 *   - the dependency check answers "what code will end up in the
 *     bundle", which is where an unvetted package would enter;
 *   - the source scan answers "what does this code try to reach for",
 *     which is where an otherwise-allowed dependency gets used to open
 *     a door the sandbox closes.
 *
 * Import specifiers come from Bun's transpiler rather than a regex, so
 * they are the real resolved imports including type-only and re-export
 * forms. Stylesheets are tokenized as CSS (see stylesheet.ts). The
 * remaining checks are textual and deliberately blunt.
 */
export async function validateTemplate(
  template: LoadedTemplate,
): Promise<ValidationResult> {
  const findings: Finding[] = [
    ...checkDependencies(template),
    ...checkAllowedPackages(template),
  ]
  const format2 = isFormat2(template)
  let checkoutFiles = new Set<string>()
  if (format2) {
    const { sources, problems } = await discoverSources(template.root)
    findings.push(...problems.map((p) => ({ ...p, line: 0 })))
    checkoutFiles = await checkoutClosure(template.root, sources.pages)
  }
  const declaredSettings = new Set((template.manifest.settings ?? []).map((s) => s.id))

  const narrowed = template.declaresAllowedPackages ? template.manifest.allowedPackages : null
  const transpiler = new Bun.Transpiler({ loader: 'tsx' })
  const glob = new Glob(SOURCE_GLOB)
  let filesScanned = 0

  for await (const scanned of glob.scan({ cwd: template.root, dot: false })) {
    const relPath = portable(scanned)
    if (!ships(relPath)) continue
    if (relPath === 'vite.config.ts') continue

    filesScanned++
    const source = await readFile(`${template.root}/${relPath}`, 'utf8')
    findings.push(...scanImports(transpiler, source, relPath, narrowed))
    findings.push(...scanSource(source, relPath))
    if (format2 && /^src\/slots\/[^/]+$/.test(relPath)) findings.push(...scanSlot(source, relPath))
    if (format2 && !checkoutFiles.has(relPath)) findings.push(...scanCheckoutUse(source, relPath))
    if (format2) {
      findings.push(...scanPlatformUrls(source, relPath))
      findings.push(...scanSettingIds(source, relPath, declaredSettings))
    }
  }

  for await (const scanned of new Glob(STYLESHEET_GLOB).scan({ cwd: template.root, dot: false })) {
    const relPath = portable(scanned)
    if (!ships(relPath)) continue
    filesScanned++
    findings.push(...scanStylesheet(await readFile(`${template.root}/${relPath}`, 'utf8'), relPath))
  }

  return { findings, filesScanned }
}

/** A scanned path with "/" between its parts, whatever the platform's separator. */
function portable(relPath: string): string {
  return relPath.split(sep).join('/')
}

/**
 * Whether a file is part of what a template ships. The dev harness stands
 * in for the platform locally, so it legitimately does things a template
 * may not.
 */
function ships(relPath: string): boolean {
  if (SKIP_DIRECTORIES.some((dir) => relPath.includes(dir))) return false
  return !(relPath.startsWith('dev/') || relPath.startsWith('mocks/'))
}

/**
 * A stylesheet may only load files from the store's own origin; see
 * stylesheet.ts. The same rule is applied to the built stylesheet, which
 * catches a URL a preprocessor or a package brings in.
 */
export function scanStylesheet(css: string, file: string): Finding[] {
  return externalStylesheetUrls(css).map((f) => ({
    file,
    line: f.line,
    rule: STYLESHEET_RULE,
    message: f.message,
  }))
}

/** The rule id of a stylesheet URL that loads from another site. */
export const STYLESHEET_RULE = 'stylesheet-external-url'

/**
 * Applies the stylesheet rule to every .css file of a build, by path
 * relative to the build directory.
 */
export async function scanBuiltStylesheets(buildDir: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const entries = await readdir(buildDir, { withFileTypes: true, recursive: true })
  const paths = entries
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => relative(buildDir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()
  for (const path of paths) findings.push(...scanStylesheet(await readFile(join(buildDir, path), 'utf8'), path))
  return findings
}

/** Why a build whose stylesheet loads from another site fails. */
export function formatBuiltStylesheetFindings(findings: Finding[]): string {
  return [
    'the built stylesheet loads from another site, which the platform does not accept. When your own CSS has no such URL, a package or a preprocessor added it:',
    ...findings.map((f) => `  ${f.file}${f.line > 0 ? `:${f.line}` : ''}  [${f.rule}] ${f.message}`),
  ].join('\n')
}

/**
 * Every runtime dependency must be on the platform allowlist, and every
 * devDependency on the toolchain allowlist.
 */
function checkDependencies(template: LoadedTemplate): Finding[] {
  const findings: Finding[] = []
  const file = relative(template.root, `${template.root}/package.json`) || 'package.json'

  for (const name of Object.keys(template.pkg.dependencies ?? {})) {
    if (!PLATFORM_ALLOWED_PACKAGES.includes(name)) {
      findings.push({
        file,
        line: 0,
        rule: 'dependency-not-allowed',
        message: `"${name}" is not on the platform allowlist. Allowed: ${PLATFORM_ALLOWED_PACKAGES.join(', ')}`,
      })
    }
  }

  for (const name of Object.keys(template.pkg.devDependencies ?? {})) {
    if (!PLATFORM_ALLOWED_DEV_PACKAGES.includes(name)) {
      findings.push({
        file,
        line: 0,
        rule: 'dev-dependency-not-allowed',
        message: `"${name}" is not an allowed build dependency`,
      })
    }
  }

  return findings
}

/**
 * template.json may narrow the platform allowlist but never widen it.
 * A template that lists something the platform does not allow is either
 * a mistake or an attempt to self-grant, and both are build failures.
 */
function checkAllowedPackages(template: LoadedTemplate): Finding[] {
  return template.manifest.allowedPackages
    .filter((name) => !PLATFORM_ALLOWED_PACKAGES.includes(name))
    .map((name) => ({
      file: 'template.json',
      line: 0,
      rule: 'allowlist-widened',
      message: `allowedPackages lists "${name}", which the platform does not allow. template.json can only narrow the platform allowlist.`,
    }))
}

/**
 * Every import must be of a package on the platform allowlist and, when the
 * template declares allowedPackages (`narrowed`), of one it lists there or
 * of the SDK and React.
 */
function scanImports(
  transpiler: Bun.Transpiler,
  source: string,
  file: string,
  narrowed: readonly string[] | null,
): Finding[] {
  let imports: Array<{ path: string }>
  try {
    imports = transpiler.scanImports(source)
  } catch (e) {
    return [
      {
        file,
        line: 0,
        rule: 'parse-error',
        message: `could not parse: ${(e as Error).message}`,
      },
    ]
  }

  const findings: Finding[] = []
  for (const imp of imports) {
    const specifier = imp.path
    if (isRelative(specifier) || isAliased(specifier)) continue

    const bare = bareName(specifier)

    if (isBannedImport(specifier, bare)) {
      findings.push({
        file,
        line: lineOf(source, specifier),
        rule: 'banned-import',
        message: `"${specifier}" is a host capability the render sandbox does not provide`,
      })
      continue
    }

    if (!PLATFORM_ALLOWED_PACKAGES.includes(bare)) {
      findings.push({
        file,
        line: lineOf(source, specifier),
        rule: 'import-not-allowed',
        message: `"${specifier}" resolves to "${bare}", which is not on the platform allowlist`,
      })
    } else if (narrowed !== null && !SDK_PACKAGES.includes(bare) && !narrowed.includes(bare)) {
      findings.push({
        file,
        line: lineOf(source, specifier),
        rule: 'import-not-in-allowed-packages',
        message: `"${specifier}" resolves to "${bare}", which template.json's allowedPackages does not list; add it there to use it`,
      })
    }
  }
  return findings
}

function scanSource(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  const lines = source.split('\n')

  lines.forEach((text, index) => {
    if (isCommentOnly(text)) return
    for (const rule of BANNED_PATTERNS) {
      if (rule.pattern.test(text)) {
        findings.push({
          file,
          line: index + 1,
          rule: rule.id,
          message: rule.reason,
        })
      }
    }
  })

  return findings
}

/**
 * A format-2 template never writes a platform URL: every one is in the page
 * payload. A string that starts with one is almost always a hand-built link
 * that breaks the day the platform moves it.
 */
function scanPlatformUrls(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  source.split('\n').forEach((text, index) => {
    if (isCommentOnly(text)) return
    for (const rule of platformUrlsIn(text)) {
      findings.push({
        file,
        line: index + 1,
        rule: 'hand-built-platform-url',
        message: `"${rule.path}…" is a platform URL; ${platformUrlAdvice(rule)}`,
      })
    }
  })
  return findings
}

/** The SDK's checkout hooks and calls, which act for the signed-in customer. */
const CHECKOUT_NAMES =
  /\b(useCheckoutPlan|useCheckoutDomains|useCheckoutSuccess|useCheckoutCancel|checkoutCustomer|saveBillingAddress|quoteCheckout|startCheckout|confirmCheckout|cancelCheckout|readDomainDraft|saveDomainDraft|clearDomainDraft)\b/g

/**
 * The checkout pages' files and every file of the template they import,
 * directly or not, by path relative to the template.
 */
async function checkoutClosure(root: string, pages: Record<string, string>): Promise<Set<string>> {
  const transpiler = new Bun.Transpiler({ loader: 'tsx' })
  const checkoutPages = PAGES.filter((p) => p.tier === 'checkout').map((p) => p.id)
  const queue = checkoutPages.flatMap((id) => (pages[id] ? [pages[id]!] : []))
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    let imports: Array<{ path: string }> = []
    try {
      imports = transpiler.scanImports(await readFile(file, 'utf8'))
    } catch {
      continue
    }
    for (const { path } of imports) {
      const base = path.startsWith('.') ? join(dirname(file), path) : path === '@template' || path.startsWith('@template/') || path === '@' || path.startsWith('@/') ? join(root, 'src', path.replace(/^@template\/?|^@\/?/, '')) : null
      if (base === null) continue
      for (const candidate of [base, ...SOURCE_EXTENSIONS.map((e) => `${base}${e}`), ...SOURCE_EXTENSIONS.map((e) => join(base, `index${e}`))]) {
        if (existsSync(candidate) && !candidate.endsWith('.css')) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  return new Set([...seen].map((f) => relative(root, f).split(sep).join('/')))
}

/** A checkout hook or call outside the checkout pages and what they import. */
function scanCheckoutUse(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  source.split('\n').forEach((text, index) => {
    if (isCommentOnly(text)) return
    for (const match of text.matchAll(CHECKOUT_NAMES)) {
      findings.push({
        file,
        line: index + 1,
        rule: 'checkout-outside-checkout',
        message: `${match[1]} is for the checkout pages: use it in src/pages/checkout.*.tsx or in a file they import`,
      })
    }
  })
  return findings
}

/**
 * What a slot may not contain. A slot is rendered on the server only and
 * shown with no script, so anything that needs script in the browser does
 * nothing there; and it is given the store, the settings and the design
 * tokens, never the page's data or its actions.
 */
const SLOT_RULES: readonly { pattern: RegExp; rule: string; message: string }[] = [
  { pattern: /\bisland\s*\(|['"`][^'"`]*\/islands\/[^'"`]*['"`]|['"`]@template\/islands\b/, rule: 'slot-needs-script', message: 'a slot cannot contain islands: it is shown with no script' },
  {
    pattern: /\buse(State|Effect|LayoutEffect|InsertionEffect|Reducer|Ref|SyncExternalStore|Transition|DeferredValue|Optimistic|ActionState)\b/,
    rule: 'slot-needs-script',
    message: 'a slot is rendered once on the server and never runs in the browser, so state and effects do nothing there',
  },
  { pattern: /\son[A-Z][A-Za-z]*\s*=\s*\{/, rule: 'slot-needs-script', message: 'a slot is shown with no script, so an event handler does nothing there' },
  { pattern: /<script\b|\bexport\s+(const|let|var)\s+hydrate\b/, rule: 'slot-needs-script', message: 'a slot is shown with no script' },
  {
    pattern: /\buse(Page|Action)\s*[<(]/,
    rule: 'slot-reads-page',
    message: "a slot gets the store, the settings and the design tokens, not the page's data or its actions",
  },
]

/** The slot rules, line by line. */
function scanSlot(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  source.split('\n').forEach((text, index) => {
    if (isCommentOnly(text)) return
    for (const r of SLOT_RULES) {
      if (r.pattern.test(text)) findings.push({ file, line: index + 1, rule: r.rule, message: r.message })
    }
  })
  return findings
}

const USE_SETTING = /\buseSetting\s*(?:<[^>()]*>)?\s*\(\s*(['"`])([^'"`]+)\1/g

/** useSetting() with an id template.json does not declare would only ever return undefined. */
function scanSettingIds(source: string, file: string, declared: Set<string>): Finding[] {
  const findings: Finding[] = []
  source.split('\n').forEach((text, index) => {
    if (isCommentOnly(text)) return
    for (const match of text.matchAll(USE_SETTING)) {
      const id = match[2]!
      if (declared.has(id)) continue
      findings.push({
        file,
        line: index + 1,
        rule: 'undeclared-setting',
        message: `useSetting("${id}"): "${id}" is not declared in template.json settings, so no store can set it`,
      })
    }
  })
  return findings
}

/**
 * Matches both spellings of a builtin: the `node:`/`bun:` scheme
 * (`node:fs`) and the bare name (`fs`, `fs/promises`).
 */
function isBannedImport(specifier: string, bare: string): boolean {
  return BANNED_IMPORT_PREFIXES.some((prefix) => {
    if (prefix.endsWith(':')) return specifier.startsWith(prefix)
    return bare === prefix
  })
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

/** Vite aliases the template's own source as `@` and `@template`. */
function isAliased(specifier: string): boolean {
  return (
    specifier === '@' ||
    specifier.startsWith('@/') ||
    specifier === '@template' ||
    specifier.startsWith('@template/')
  )
}

/** "react-dom/server" → "react-dom"; "@scope/pkg/deep" → "@scope/pkg". */
function bareName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

function lineOf(source: string, needle: string): number {
  const index = source.indexOf(needle)
  if (index === -1) return 0
  return source.slice(0, index).split('\n').length
}

function isCommentOnly(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

export function formatFindings(result: ValidationResult): string {
  if (result.findings.length === 0) {
    return `✓ ${result.filesScanned} files scanned, no policy violations`
  }

  const byFile = new Map<string, Finding[]>()
  for (const finding of result.findings) {
    const list = byFile.get(finding.file) ?? []
    list.push(finding)
    byFile.set(finding.file, list)
  }

  const out: string[] = []
  for (const [file, findings] of byFile) {
    out.push(file)
    for (const f of findings) {
      const at = f.line > 0 ? `:${f.line}` : ''
      out.push(`  ${file}${at}  [${f.rule}] ${f.message}`)
    }
  }
  out.push('')
  out.push(`✗ ${result.findings.length} policy violation(s) across ${byFile.size} file(s)`)
  return out.join('\n')
}
