import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PAGES } from '../contract/dist/ts/registry'

/**
 * What a format-2 template is made of, found by file name:
 *
 *   src/layout.tsx            the layout, around every page it implements
 *   src/pages/<page-id>.tsx   one file per page it implements
 *   src/islands/<name>.tsx    components hydrated on their own (optional)
 *
 * The layout and the pages come together: a template has both, or neither
 * (a template that is only template.json).
 *
 * `.jsx`, `.ts` and `.js` work in place of `.tsx`. Files in subdirectories
 * of pages/ and islands/ are ordinary modules, free for helpers.
 */

export type Hydrate = 'full' | 'islands'

export interface TemplateSources {
  /** Absolute path of the layout, or null. */
  layout: string | null
  /** Absolute path of each implemented page, by page id, in registry order. */
  pages: Record<string, string>
  /** Absolute path of each island, by name, sorted. */
  islands: Record<string, string>
  /** How each implemented page is hydrated. */
  hydrate: Record<string, Hydrate>
}

export interface SourceProblem {
  file: string
  rule: string
  message: string
}

export const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'] as const

/** The pages a template can implement, in registry order. */
export const TEMPLATE_PAGE_IDS: readonly string[] = PAGES.filter((p) => p.upstream === 'engine').map((p) => p.id)

export const ISLAND_NAME = /^[a-z][a-z0-9-]*$/

const HYDRATE_DECLARED = /\bexport\s+(?:const|let|var)\s+hydrate\b/
const HYDRATE_LITERAL = /\bexport\s+const\s+hydrate\s*(?::\s*[^=]+?)?=\s*(['"])(full|islands)\1/

function splitExtension(file: string): [string, string] | null {
  const ext = SOURCE_EXTENSIONS.find((e) => file.endsWith(e) && !file.endsWith(`.d${e}`))
  return ext ? [file.slice(0, -ext.length), ext] : null
}

async function filesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

function hasDefaultExport(source: string): boolean {
  try {
    return new Bun.Transpiler({ loader: 'tsx' }).scan(source).exports.includes('default')
  } catch {
    // A file that does not parse is reported by the source scan.
    return true
  }
}

export async function discoverSources(root: string): Promise<{
  sources: TemplateSources
  problems: SourceProblem[]
}> {
  const problems: SourceProblem[] = []
  const src = join(root, 'src')
  const sources: TemplateSources = { layout: null, pages: {}, islands: {}, hydrate: {} }

  const needsDefault = async (path: string, file: string, what: string) => {
    const source = await readFile(path, 'utf8')
    if (!hasDefaultExport(source)) {
      problems.push({ file, rule: 'missing-default-export', message: `${what} must default-export a component` })
    }
    return source
  }

  let layoutFile = ''
  for (const name of await filesIn(src)) {
    const split = splitExtension(name)
    if (!split || split[0] !== 'layout') continue
    if (sources.layout) {
      problems.push({ file: `src/${name}`, rule: 'duplicate-source', message: 'there is more than one layout file' })
      continue
    }
    sources.layout = join(src, name)
    layoutFile = `src/${name}`
    await needsDefault(sources.layout, layoutFile, 'the layout')
  }

  const found: Record<string, string> = {}
  for (const name of await filesIn(join(src, 'pages'))) {
    const split = splitExtension(name)
    if (!split) continue
    const [id] = split
    const file = `src/pages/${name}`
    if (!TEMPLATE_PAGE_IDS.includes(id)) {
      problems.push({
        file,
        rule: 'unknown-page',
        message: `"${id}" is not a page a template can implement. Page files are named after the page id: ${TEMPLATE_PAGE_IDS.map((p) => `${p}.tsx`).join(', ')}`,
      })
      continue
    }
    if (found[id]) {
      problems.push({ file, rule: 'duplicate-source', message: `page "${id}" has more than one file` })
      continue
    }
    found[id] = join(src, 'pages', name)
    const source = await needsDefault(found[id], file, `page "${id}"`)
    if (HYDRATE_DECLARED.test(source)) {
      const literal = HYDRATE_LITERAL.exec(source)
      if (!literal) {
        problems.push({
          file,
          rule: 'invalid-hydrate',
          message: 'hydrate must be declared as export const hydrate = "islands" (or "full")',
        })
      }
      sources.hydrate[id] = (literal?.[2] as Hydrate | undefined) ?? 'full'
    } else {
      sources.hydrate[id] = 'full'
    }
  }
  for (const id of TEMPLATE_PAGE_IDS) {
    if (found[id]) sources.pages[id] = found[id]
  }

  for (const name of await filesIn(join(src, 'islands'))) {
    const split = splitExtension(name)
    if (!split) continue
    const [island] = split
    const file = `src/islands/${name}`
    if (!ISLAND_NAME.test(island)) {
      problems.push({
        file,
        rule: 'invalid-island-name',
        message: `island file names must match ${ISLAND_NAME.source} (lowercase words joined by dashes)`,
      })
      continue
    }
    if (sources.islands[island]) {
      problems.push({ file, rule: 'duplicate-source', message: `island "${island}" has more than one file` })
      continue
    }
    sources.islands[island] = join(src, 'islands', name)
    await needsDefault(sources.islands[island], file, `island "${island}"`)
  }

  const pageFiles = Object.keys(sources.pages).length
  if (pageFiles > 0 && !sources.layout) {
    problems.push({
      file: 'src/layout.tsx',
      rule: 'page-needs-layout',
      message: 'a page is shown inside your layout: add src/layout.tsx',
    })
  }
  if (sources.layout && pageFiles === 0) {
    problems.push({
      file: layoutFile,
      rule: 'layout-needs-page',
      message: 'the layout is shown only around the pages this template implements, and it implements none: add a page in src/pages/ or remove the layout',
    })
  }

  if (existsSync(join(src, 'slots'))) {
    problems.push({
      file: 'src/slots/',
      rule: 'slots-removed',
      message: 'slots are no longer supported; remove the src/slots/ directory',
    })
  }

  return { sources, problems }
}
