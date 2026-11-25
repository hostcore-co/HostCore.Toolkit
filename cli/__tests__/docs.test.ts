import { afterAll, describe, expect, it } from 'bun:test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { contract202611 } from '../../contract/src/contract-2026-11'
import { Definitions, t } from '../../contract/src/dsl'
import { SETTING_TYPES } from '../../contract/src/settings'
import { TOKENS } from '../../contract/src/tokens'
import * as sdk from '../../src/index'
import { COMMANDS } from '../commands'
import { generateDocs, missingDescriptions, SDK, SDK_FORMAT1 } from '../docs'
import { FIELD_MOVES } from '../legacy-map'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
const OUT = join(REPO, '.test-tmp', `docs-${process.pid}`)

const FILES = ['cli.md', 'contract-2026-11.md', 'index.md', 'pages.md', 'sdk.md', 'settings.md', 'tokens.md', 'upgrading.md']

afterAll(async () => {
  await rm(OUT, { recursive: true, force: true })
})

describe('the contract descriptions', () => {
  it('describe every type and every field of contract 2026-11', () => {
    expect(missingDescriptions(contract202611)).toEqual([])
  })

  it('are checked: a type or field without one is named', () => {
    const d = new Definitions()
    d.define('Thing', 'is a thing.', t.object({ described: t.doc('Has one.', t.string()), bare: t.string() }))
    d.define('Other', '', t.string())
    expect(missingDescriptions({ version: 'x', goPrefix: 'X', definitions: d.list, pages: {} })).toEqual(['Thing.bare', 'Other'])
  })
})

describe('hct docs', () => {
  it('writes the reference pages', async () => {
    const result = await hct(['docs', '--out', OUT])
    expect(result.code).toBe(0)
    expect((await readdir(OUT)).sort()).toEqual(FILES)
    const files = generateDocs()
    for (const name of FILES) expect(await readFile(join(OUT, name), 'utf8')).toBe(files[name]!)
  })

  it('writes the same bytes every time', () => {
    expect(generateDocs()).toEqual(generateDocs())
  })

  it('needs --out', async () => {
    const result = await hct(['docs'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('docs needs --out <dir>')
  })

  it('covers every page, type, field, setting type, token, command and mapping', () => {
    const docs = generateDocs()
    for (const page of ['home', 'domains', 'catalog.group', 'catalog.service', 'not-found', 'checkout', 'login', 'dashboard']) {
      expect(docs['pages.md']).toContain(`| \`${page}\` |`)
    }
    for (const def of contract202611.definitions) {
      expect(docs['contract-2026-11.md']).toContain(`## ${def.name}\n`)
      if (def.schema.kind === 'object') for (const key of Object.keys(def.schema.fields)) expect(docs['contract-2026-11.md']).toContain(`| \`${key}\` |`)
    }
    for (const type of SETTING_TYPES) expect(docs['settings.md']).toContain(`| \`${type}\` |`)
    for (const token of TOKENS) expect(docs['tokens.md']).toContain(`| \`${token.name}\` | \`${token.property}\` |`)
    for (const c of COMMANDS) expect(docs['cli.md']).toContain(`## hct ${c.name}\n`)
    for (const m of FIELD_MOVES) expect(docs['upgrading.md']).toContain(`\`${m.v1}\``)
  })

  it('lists every value the SDK exports for format 2', () => {
    const documented = new Set([...SDK.map((e) => e.name), ...SDK_FORMAT1])
    expect(Object.keys(sdk).filter((name) => !documented.has(name)).sort()).toEqual([])
    for (const name of SDK_FORMAT1) expect(Object.keys(sdk)).toContain(name)
  })
})

describe('where the layout appears', () => {
  it('is only on the pages a template implements, as the README and the reference say', async () => {
    const readme = (await readFile(join(REPO, 'README.md'), 'utf8')).replace(/\s+/g, ' ')
    expect(readme).toContain("A page you leave out is rendered entirely by the platform's built-in default template")
    expect(readme).toContain("The platform's own pages")
    expect(readme).not.toMatch(/slot/i)
    const pages = generateDocs()['pages.md']!
    expect(pages).toContain("a page it leaves out is rendered entirely by the platform's default template, with its own header and footer")
    expect(pages).toContain('| `dashboard` | `/dashboard` and below | private |')
    expect(pages).toContain('| `checkout` | `/checkout` and below | guarded |')
    for (const name of ['pages.md', 'sdk.md', 'index.md']) expect(generateDocs()[name]).not.toMatch(/\bslots?\b|composed/i)
  })
})

describe('the generated reference', () => {
  it('gives every table column a heading', () => {
    for (const [name, text] of Object.entries(generateDocs())) {
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (!lines[i + 1]?.startsWith('| ---')) return
        const cells = line.slice(1, -1).split(' | ').map((c) => c.trim())
        expect([name, line, cells.every((c) => c !== '')]).toEqual([name, line, true])
      })
    }
    expect(generateDocs()['sdk.md']).toContain('| name | signature | what it does |')
  })

  it('divides the tokens page into sections', () => {
    const headings = generateDocs()['tokens.md']!.split('\n').filter((l) => l.startsWith('#'))
    expect(headings).toEqual(['# Design tokens', '## Tokens', '## How a value is chosen', '## Value patterns'])
  })
})

describe("the README's command list", () => {
  it('names every command and every option --help lists', async () => {
    const readme = await readFile(join(REPO, 'README.md'), 'utf8')
    const list = readme.slice(readme.indexOf('## The commands'), readme.indexOf('## Developing the toolkit'))
    for (const c of COMMANDS) {
      expect([c.name, list.includes(`hct ${c.name}`)]).toEqual([c.name, true])
      for (const f of c.flags) {
        const flag = f.flag.split(' ')[0]!
        expect([c.name, flag, list.includes(flag)]).toEqual([c.name, flag, true])
      }
    }
  })
})

describe("the README's checkout example", () => {
  it('uses only what the SDK exports', async () => {
    const readme = await readFile(join(REPO, 'README.md'), 'utf8')
    const block = readme.slice(readme.indexOf('// src/islands/checkout-plan.tsx'), readme.indexOf('```', readme.indexOf('// src/islands/checkout-plan.tsx')))
    const imported = /import \{([^}]*)\} from '@hostcore\/toolkit'/.exec(block)![1]!.split(',').map((n) => n.trim().replace(/^type /, ''))
    for (const name of imported) expect([name, name in sdk || ['Money'].includes(name)]).toEqual([name, true])
    expect(block).toContain('useCheckoutPlan()')
  })
})
