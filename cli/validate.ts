import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Glob } from 'bun'
import {
  BANNED_IMPORT_PREFIXES,
  BANNED_PATTERNS,
  PLATFORM_ALLOWED_DEV_PACKAGES,
  PLATFORM_ALLOWED_PACKAGES,
  platformUrlAdvice,
  platformUrlsIn,
  SOURCE_GLOB,
  STYLESHEET_GLOB,
} from './policy'
import { discoverSources } from './sources'
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
  if (format2) {
    const { problems } = await discoverSources(template.root)
    findings.push(...problems.map((p) => ({ ...p, line: 0 })))
  }
  const declaredSettings = new Set((template.manifest.settings ?? []).map((s) => s.id))

  const transpiler = new Bun.Transpiler({ loader: 'tsx' })
  const glob = new Glob(SOURCE_GLOB)
  let filesScanned = 0

  for await (const relPath of glob.scan({ cwd: template.root, dot: false })) {
    if (!ships(relPath)) continue
    if (relPath === 'vite.config.ts') continue

    filesScanned++
    const source = await readFile(`${template.root}/${relPath}`, 'utf8')
    findings.push(...scanImports(transpiler, source, relPath))
    findings.push(...scanSource(source, relPath))
    if (format2) {
      findings.push(...scanPlatformUrls(source, relPath))
      findings.push(...scanSettingIds(source, relPath, declaredSettings))
    }
  }

  for await (const relPath of new Glob(STYLESHEET_GLOB).scan({ cwd: template.root, dot: false })) {
    if (!ships(relPath)) continue
    filesScanned++
    findings.push(...scanStylesheet(await readFile(`${template.root}/${relPath}`, 'utf8'), relPath))
  }

  return { findings, filesScanned }
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

function scanImports(
  transpiler: Bun.Transpiler,
  source: string,
  file: string,
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
