import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PAGES, SLOTS } from '../contract/dist/ts/registry'

/**
 * What a format-2 template is made of, found by file name:
 *
 *   src/layout.tsx            the layout (optional)
 *   src/pages/<page-id>.tsx   one file per page it implements (optional)
 *   src/islands/<name>.tsx    components hydrated on their own (optional)
 *   src/slots/<slot-id>.tsx   static content for a slot on a platform page,
 *                             named after the slot id with its dots
 *                             (src/slots/checkout.summary.tsx) (optional)
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
  /** Absolute path of each slot, by slot id, in registry order. */
  slots: Record<string, string>
}

export interface SourceProblem {
  file: string
  rule: string
  message: string
}

export const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'] as const

/** The slots a template can fill, in registry order. */
export const SLOT_IDS: readonly string[] = SLOTS.map((s) => s.id)

/** The pages a template can implement, in registry order. */
export const TEMPLATE_PAGE_IDS: readonly string[] = PAGES.filter((p) => p.upstream === 'engine').map((p) => p.id)

/**
 * What of a template the platform's own pages (the pages it does not render
 * from a template) show, by their tier in the page registry: a `guarded`
 * page (checkout, sign-in, sign-up and the like) is drawn inside the
 * template's layout in its `minimal` variant; a `private` page (the account
 * area) gets the template's design tokens and no layout; a `staff` page
 * shows nothing of the template.
 */
export type PlatformPageChrome = 'minimal-layout' | 'tokens' | 'none'

export function platformPageChrome(tier: string): PlatformPageChrome {
  return tier === 'guarded' ? 'minimal-layout' : tier === 'private' ? 'tokens' : 'none'
}

/** The platform pages drawn inside the template's minimal layout, in registry order. */
export const MINIMAL_LAYOUT_PAGE_IDS: readonly string[] = PAGES.filter(
  (p) => p.upstream !== 'engine' && platformPageChrome(p.tier) === 'minimal-layout',
).map((p) => p.id)

/** The platform pages that take the template's design tokens and no layout, in registry order. */
export const TOKENS_ONLY_PAGE_IDS: readonly string[] = PAGES.filter(
  (p) => p.upstream !== 'engine' && platformPageChrome(p.tier) === 'tokens',
).map((p) => p.id)

/** One sentence saying which platform pages show the layout and which only the tokens, with their ids marked up by `code`. */
export function platformPagesSentence(code: (id: string) => string = (id) => id): string {
  return `The platform's guarded pages, checkout and sign-in among them (${MINIMAL_LAYOUT_PAGE_IDS.map(code).join(', ')}), are drawn inside your layout in its \`minimal\` variant; its private pages, the account area (${TOKENS_ONLY_PAGE_IDS.map(code).join(', ')}), use your design tokens but not your layout.`
}

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
  const sources: TemplateSources = { layout: null, pages: {}, islands: {}, hydrate: {}, slots: {} }

  const needsDefault = async (path: string, file: string, what: string) => {
    const source = await readFile(path, 'utf8')
    if (!hasDefaultExport(source)) {
      problems.push({ file, rule: 'missing-default-export', message: `${what} must default-export a component` })
    }
    return source
  }

  for (const name of await filesIn(src)) {
    const split = splitExtension(name)
    if (!split || split[0] !== 'layout') continue
    if (sources.layout) {
      problems.push({ file: `src/${name}`, rule: 'duplicate-source', message: 'there is more than one layout file' })
      continue
    }
    sources.layout = join(src, name)
    await needsDefault(sources.layout, `src/${name}`, 'the layout')
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

  const slots: Record<string, string> = {}
  for (const name of await filesIn(join(src, 'slots'))) {
    const split = splitExtension(name)
    if (!split) continue
    const [id] = split
    const file = `src/slots/${name}`
    if (!SLOT_IDS.includes(id)) {
      problems.push({
        file,
        rule: 'unknown-slot',
        message: `"${id}" is not a slot. Slot files are named after the slot id: ${SLOT_IDS.map((x) => `${x}.tsx`).join(', ')}`,
      })
      continue
    }
    if (slots[id]) {
      problems.push({ file, rule: 'duplicate-source', message: `slot "${id}" has more than one file` })
      continue
    }
    slots[id] = join(src, 'slots', name)
    await needsDefault(slots[id], file, `slot "${id}"`)
  }
  for (const id of SLOT_IDS) {
    if (slots[id]) sources.slots[id] = slots[id]
  }

  return { sources, problems }
}
