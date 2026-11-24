import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentSurfaces } from '../src/generate'
import { diffSurface, type ContractSurface } from '../src/surface'

const contractDir = join(import.meta.dir, '..')
const toolkitDir = join(contractDir, '..')
const scratch = mkdtempSync(join(tmpdir(), 'hct-surface-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** The 2026-11 surface, a fresh copy each time. */
function base(): ContractSurface {
  return structuredClone(currentSurfaces(contractDir)['2026-11']!)
}

/** The one classified change from editing a copy of the surface. */
function change(edit: (s: ContractSurface) => void) {
  const before = base()
  const after = base()
  edit(after)
  return diffSurface(before, after).map((c) => [c.kind, c.at, c.what])
}

describe('the contract surface', () => {
  it('matches the committed baselines', () => {
    for (const [version, surface] of Object.entries(currentSurfaces(contractDir))) {
      const baseline = JSON.parse(readFileSync(join(contractDir, 'baselines', `${version}.json`), 'utf8'))
      expect(diffSurface(baseline, surface)).toEqual([])
    }
  })
})

describe('diffSurface classifies', () => {
  it('a new optional field as additive', () => {
    expect(change((s) => (s.types.Plan!.fields!.badge = { type: 'string', optional: true }))).toEqual([
      ['additive', 'type Plan field badge', 'an optional field was added'],
    ])
  })

  it('a new type, page, token, action and standard setting as additive', () => {
    expect(change((s) => (s.types.Coupon = { kind: 'object', fields: {} }))).toEqual([['additive', 'type Coupon', 'a type was added']])
    expect(
      change((s) => (s.registry!.blog = { path: '/blog', prefix: false, tier: 'open', upstream: 'engine', requires: null })),
    ).toEqual([['additive', 'page blog', 'a page was added to the registry']])
    expect(change((s) => (s.page_data.blog = 'BlogData'))).toEqual([['additive', 'page data blog', 'a page was added']])
    expect(change((s) => (s.tokens!['radius.xl'] = { property: '--hc-radius-xl', kind: 'radius', pattern: 'x' }))).toEqual([
      ['additive', 'token radius.xl', 'a token was added'],
    ])
    expect(change((s) => (s.types.Actions!.fields!.cart_add = { type: 'Action', optional: true }))).toEqual([
      ['additive', 'type Actions field cart_add', 'an optional field was added'],
    ])
    expect(change((s) => (s.standard_settings!['footer.note'] = { type: 'text', max: 300 }))).toEqual([
      ['additive', 'standard setting footer.note', 'a standard setting was added'],
    ])
  })

  it('a removed or renamed field as breaking', () => {
    expect(
      change((s) => {
        s.types.Plan!.fields!.price_now = s.types.Plan!.fields!.price!
        delete s.types.Plan!.fields!.price
      }),
    ).toEqual([
      ['breaking', 'type Plan field price', 'the field was removed or renamed'],
      ['additive', 'type Plan field price_now', 'a field was added'],
    ])
  })

  it('a type change as breaking', () => {
    expect(change((s) => (s.types.Plan!.fields!.trial_days!.type = 'string'))).toEqual([
      ['breaking', 'type Plan field trial_days', 'the type changed from integer to string'],
    ])
  })

  it('a field that may now be absent as breaking, and one now always there as additive', () => {
    expect(change((s) => (s.types.Plan!.fields!.name!.optional = true))).toEqual([
      ['breaking', 'type Plan field name', 'a required field may now be absent'],
    ])
    expect(change((s) => (s.types.Actions!.fields!.domain_search!.optional = false))).toEqual([
      ['additive', 'type Actions field domain_search', 'an optional field is now required'],
    ])
  })

  it('a field of data a template sends becoming required as breaking', () => {
    const before = base()
    before.types.Req = { kind: 'object', input: true, fields: { q: { type: 'string', optional: true } } }
    const after = structuredClone(before)
    after.types.Req!.fields!.q!.optional = false
    after.types.Req!.fields!.page = { type: 'integer', optional: false }
    expect(diffSurface(before, after).map((c) => [c.kind, c.at, c.what])).toEqual([
      ['breaking', 'type Req field page', 'a required field was added to data a template sends'],
      ['breaking', 'type Req field q', 'an optional field is now required'],
    ])
  })

  it('removed pages, tokens, actions and settings as breaking', () => {
    expect(change((s) => delete s.registry!.signup)).toEqual([['breaking', 'page signup', 'the page was removed from the registry']])
    expect(change((s) => delete s.page_data.domains)).toEqual([['breaking', 'page data domains', 'the page was removed']])
    expect(change((s) => delete s.tokens!['space.unit'])).toEqual([['breaking', 'token space.unit', 'the token was removed']])
    expect(change((s) => delete s.types.Actions!.fields!.domain_search)).toEqual([
      ['breaking', 'type Actions field domain_search', 'the field was removed or renamed'],
    ])
    expect(change((s) => delete s.standard_settings!['faq.items'])).toEqual([
      ['breaking', 'standard setting faq.items', 'the standard setting was removed'],
    ])
  })

  it('a changed path or tier as breaking', () => {
    expect(change((s) => (s.registry!.domains!.path = '/domain-names'))).toEqual([
      ['breaking', 'page domains', 'its path changed from "/domains" to "/domain-names"'],
    ])
    expect(change((s) => (s.registry!.dashboard!.tier = 'guarded'))).toEqual([
      ['breaking', 'page dashboard', 'its tier changed from "private" to "guarded"'],
    ])
  })

  it('a path added to a page as additive, and one taken away as breaking', () => {
    expect(change((s) => s.registry!['checkout.plan']!.paths!.push('/buy/{service}'))).toEqual([
      ['additive', 'page checkout.plan', 'it is also reached by /buy/{service}'],
    ])
    expect(change((s) => (s.registry!['checkout.plan']!.paths = ['/checkout/{service}/{plan}']))).toEqual([
      ['breaking', 'page checkout.plan', 'it is no longer reached by /checkout/{service}'],
    ])
    expect(change((s) => (s.registry!['checkout.plan']!.fallback = null))).toEqual([
      ['breaking', 'page checkout.plan', 'its fallback changed from "frontend" to null'],
    ])
  })

  it('a narrowed limit as breaking and a widened one as additive', () => {
    expect(change((s) => (s.standard_settings!['hero.title']!.max = 80))).toEqual([
      ['breaking', 'standard setting hero.title', 'max narrowed from 160 to 80'],
    ])
    expect(change((s) => (s.standard_settings!['hero.title']!.max = 200))).toEqual([
      ['additive', 'standard setting hero.title', 'max widened from 160 to 200'],
    ])
    expect(change((s) => (s.standard_settings!['hero.title']!.type = 'textarea'))).toEqual([
      ['breaking', 'standard setting hero.title', 'its shape (type, list item type or fields) changed'],
    ])
  })

  it('enum changes as breaking, except a value added to an open enum', () => {
    expect(change((s) => s.types.PriceInterval!.values!.push('week'))).toEqual([
      ['breaking', 'type PriceInterval', 'values added to a closed enum, which a template may not handle: week'],
    ])
    expect(change((s) => s.types.ServiceType!.values!.push('storage'))).toEqual([
      ['additive', 'type ServiceType', 'values added to an open enum: storage'],
    ])
    expect(change((s) => (s.types.ServiceType!.values = s.types.ServiceType!.values!.filter((v) => v !== 'vps')))).toEqual([
      ['breaking', 'type ServiceType', 'enum values removed: vps'],
    ])
  })

  it('a link the rule accepted being refused as breaking', () => {
    expect(change((s) => (s.link_rule!['link "#top"'] = false))).toEqual([
      ['breaking', 'link rule link "#top"', 'a value the rule accepted is now refused'],
    ])
  })
})

describe('hct contract check and accept', () => {
  const hct = (dir: string, ...args: string[]) => Bun.spawnSync(['bun', join(toolkitDir, 'cli', 'index.ts'), 'contract', ...args, '--contract-dir', dir])

  it('fail on an additive change until it is accepted into the baseline', () => {
    const copy = join(scratch, 'additive')
    cpSync(contractDir, copy, { recursive: true, filter: (src) => !src.includes('__tests__') })
    const path = join(copy, 'baselines', '2026-11.json')
    const baseline = JSON.parse(readFileSync(path, 'utf8'))
    delete baseline.tokens['space.unit']
    writeFileSync(path, JSON.stringify(baseline))

    const check = hct(copy, 'check')
    expect(check.exitCode).toBe(1)
    expect(check.stderr.toString()).toContain('contract 2026-11: token space.unit: a token was added')
    expect(check.stderr.toString()).toContain('hct contract accept')
    expect(hct(copy, 'accept').exitCode).toBe(0)
    expect(hct(copy, 'check').exitCode).toBe(0)
  })

  it('fail on a breaking change, which accept refuses', () => {
    const copy = join(scratch, 'breaking')
    cpSync(contractDir, copy, { recursive: true, filter: (src) => !src.includes('__tests__') })
    const path = join(copy, 'registry.json')
    writeFileSync(path, readFileSync(path, 'utf8').replace('"tier": "private"', '"tier": "guarded"'))
    expect(hct(copy, 'generate').exitCode).toBe(0)

    const check = hct(copy, 'check')
    expect(check.exitCode).toBe(1)
    expect(check.stderr.toString()).toContain('contract 2026-11: page dashboard: its tier changed from "private" to "guarded"')
    expect(check.stderr.toString()).toContain('needs a new contract version, with a downgrade')
    const accept = hct(copy, 'accept')
    expect(accept.exitCode).toBe(1)
    expect(accept.stderr.toString()).toContain('cannot be accepted')
  })
})
