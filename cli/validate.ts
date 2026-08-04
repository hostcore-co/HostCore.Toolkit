import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { Glob } from 'bun'
import {
  BANNED_IMPORT_PREFIXES,
  BANNED_PATTERNS,
  PLATFORM_ALLOWED_DEV_PACKAGES,
  PLATFORM_ALLOWED_PACKAGES,
  SOURCE_GLOB,
} from './policy'
import type { LoadedTemplate } from './template'

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
 * forms. The remaining checks are textual and deliberately blunt.
 */
export async function validateTemplate(
  template: LoadedTemplate,
): Promise<ValidationResult> {
  const findings: Finding[] = [
    ...checkDependencies(template),
    ...checkAllowedPackages(template),
  ]

  const transpiler = new Bun.Transpiler({ loader: 'tsx' })
  const glob = new Glob(SOURCE_GLOB)
  let filesScanned = 0

  for await (const relPath of glob.scan({ cwd: template.root, dot: false })) {
    if (SKIP_DIRECTORIES.some((dir) => relPath.includes(dir))) continue
    // The dev harness never ships: it is the local mock engine, not
    // template code, and it legitimately does things the sandbox forbids.
    if (relPath.startsWith('dev/') || relPath.startsWith('mocks/')) continue
    if (relPath === 'vite.config.ts') continue

    filesScanned++
    const source = await readFile(`${template.root}/${relPath}`, 'utf8')
    findings.push(...scanImports(transpiler, source, relPath))
    findings.push(...scanSource(source, relPath))
  }

  return { findings, filesScanned }
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
