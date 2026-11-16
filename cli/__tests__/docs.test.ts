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
