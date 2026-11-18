import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../../cli/manifest'
import { downgrade, DowngradeError } from '../src/downgrade'
import { STANDARD_SETTINGS } from '../src/settings'
import { validate, validateType } from '../src/validate'
import type * as V1 from '../dist/ts/contract-1'
import type * as V202611 from '../dist/ts/contract-2026-11'

const fixturesDir = join(import.meta.dir, '..', 'fixtures')
const schemaDir = join(import.meta.dir, '..', 'dist', 'json-schema')

function fixtureNames(contract: string): string[] {
  return readdirSync(join(fixturesDir, contract)).filter((f) => f.endsWith('.json')).sort()
}

function load<T = unknown>(contract: string, name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, contract, `${name}.json`), 'utf8')) as T
}

type JsonSchema = Record<string, any>

/**
 * Checks a value against the subset of JSON Schema the generator emits:
 * type, const, enum, properties, required, additionalProperties, items,
 * anyOf, oneOf, allOf, if/then and local $ref.
 */
function schemaErrors(root: JsonSchema, schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = []
  if (schema.$ref) {
    const name = String(schema.$ref).replace('#/$defs/', '')
    errors.push(...schemaErrors(root, root.$defs[name], value, path))
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${schema.const}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`)
  if (schema.type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const ok =
      schema.type === actual ||
      (schema.type === 'integer' && Number.isInteger(value)) ||
      (schema.type === 'number' && actual === 'number')
    if (!ok) return [...errors, `${path}: expected ${schema.type}, got ${actual}`]
  }
  if (schema.anyOf && !schema.anyOf.some((s: JsonSchema) => schemaErrors(root, s, value, path).length === 0)) {
    errors.push(`${path}: matches no anyOf branch`)
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s: JsonSchema) => schemaErrors(root, s, value, path).length === 0).length
    if (matches !== 1) errors.push(`${path}: matches ${matches} oneOf branches`)
  }
  for (const sub of schema.allOf ?? []) {
    if (sub.if && schemaErrors(root, sub.if, value, path).length === 0) {
      errors.push(...schemaErrors(root, sub.then, value, path))
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${path}.${key}: required`)
    for (const [key, item] of Object.entries(record)) {
      const prop = schema.properties?.[key]
      if (prop) errors.push(...schemaErrors(root, prop, item, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`)
      else if (typeof schema.additionalProperties === 'object') {
        errors.push(...schemaErrors(root, schema.additionalProperties, item, `${path}.${key}`))
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...schemaErrors(root, schema.items, item, `${path}[${i}]`)))
  }
  return errors
}

describe('fixtures', () => {
  const names2026 = fixtureNames('2026-11')

  it('cover every case the platform must handle', () => {
    for (const name of [
      'home',
      'catalog.group',
      'catalog.service',
      'catalog.service.single-plan',
      'domains',
      'not-found',
      'home.empty-catalogue',
      'catalog.group.long-names',
      'home.no-domains',
      'catalog.service.unknown-type',
      'catalog.service.trial-and-free',
      'catalog.group.missing-optional',
      'home.unset-settings',
      'catalog.service.empty-type',
      'checkout.plan',
      'checkout.plan.free',
      'checkout.plan.free-trial',
      'checkout.plan.single-cycle',
      'checkout.plan.bank-transfer',
      'checkout.plan.only-plan',
      'checkout.plan.no-exchange-rates',
      'checkout.domains',
      'checkout.domains.no-offers',
      'checkout.success',
      'checkout.cancel',
    ]) {
      expect(names2026).toContain(`${name}.json`)
    }
    // The checkout pages are served only to 2026-11 templates, so contract "1" has no fixtures for them.
    expect(fixtureNames('1')).toEqual(names2026.filter((n) => !n.startsWith('checkout.')))
  })

  for (const contract of ['2026-11', '1']) {
    const schema = JSON.parse(readFileSync(join(schemaDir, `${contract}.json`), 'utf8')) as JsonSchema
    for (const name of fixtureNames(contract)) {
      const value = load(contract, name.replace(/\.json$/, ''))
      const pageId = load<V202611.AnyPageEnvelope>('2026-11', name.replace(/\.json$/, '')).page.id

      it(`${contract}/${name} passes the runtime validator`, () => {
        expect(validate(contract, pageId, value)).toEqual([])
      })

      it(`${contract}/${name} passes the JSON Schema`, () => {
        expect(schemaErrors(schema, schema, value)).toEqual([])
      })
    }
  }

  /**
   * Every link in a fixture is the one the platform would build for that
   * object: a group at /<group>, a service at /<group>/<service> (or at
   * checkout when it has a single plan), a plan at /checkout/<service>/<plan>.
   */
  for (const name of fixtureNames('2026-11')) {
    it(`2026-11/${name} links agree with the slugs they point at`, () => {
      const e = load<Record<string, any>>('2026-11', name.replace(/\.json$/, ''))
      const problems: string[] = []
      const groups: Record<string, any>[] = [...e.nav.groups, ...(e.data?.groups ?? []), ...(e.data?.group ? [e.data.group] : [])]
      for (const g of groups) if (g.url !== `/${g.slug}`) problems.push(`group ${g.id}: url ${g.url}`)
      const groupOf = (s: Record<string, any>) => groups.find((g) => g.id === s.group_id)
      const checkService = (s: Record<string, any>) => {
        const group = groupOf(s)
        if (!group) return problems.push(`service ${s.id}: no group ${s.group_id} in the fixture`)
        const expected = s.single_plan ? `/checkout/${s.slug}` : `/${group.slug}/${s.slug}`
        if (s.url !== expected) problems.push(`service ${s.id}: url ${s.url}, expected ${expected}`)
      }
      const checkPlan = (s: Record<string, any>, p: Record<string, any>) => {
        if (p.service_id !== s.id) problems.push(`plan ${p.id}: service_id ${p.service_id}, expected ${s.id}`)
        const expected = `/checkout/${s.slug}/${p.slug}`
        if (p.checkout_url !== expected) problems.push(`plan ${p.id}: checkout_url ${p.checkout_url}, expected ${expected}`)
      }
      for (const card of e.data?.services ?? []) {
        checkService(card.service)
        checkPlan(card.service, card.from)
      }
      if (e.data?.service) {
        checkService(e.data.service)
        for (const p of e.data.plans ?? []) checkPlan(e.data.service, p)
        if (e.redirect && e.redirect.location !== e.data.service.url) problems.push(`redirect ${e.redirect.location}, expected ${e.data.service.url}`)
      }
      expect(problems).toEqual([])
    })
  }

  it('JSON Schema catches a payload for the wrong page', () => {
    const schema = JSON.parse(readFileSync(join(schemaDir, '2026-11.json'), 'utf8')) as JsonSchema
    const envelope = load<Record<string, any>>('2026-11', 'home')
    envelope.page.id = 'domains'
    expect(schemaErrors(schema, schema, envelope).length).toBeGreaterThan(0)
  })
})

describe('downgrade', () => {
  for (const name of fixtureNames('2026-11').filter((n) => n.startsWith('checkout.'))) {
    it(`has no contract "1" payload for ${name}, a page served only to 2026-11 templates`, () => {
      const envelope = load<V202611.AnyPageEnvelope>('2026-11', name.replace(/\.json$/, ''))
      expect(() => downgrade(envelope)).toThrow('has no contract "1" payload')
    })
  }

  for (const name of fixtureNames('1')) {
    it(`reproduces fixtures/1/${name}`, () => {
      const envelope = load<V202611.AnyPageEnvelope>('2026-11', name.replace(/\.json$/, ''))
      const expected = load('1', name.replace(/\.json$/, ''))
      expect(canonicalJson(downgrade(envelope))).toBe(canonicalJson(expected))
    })
  }

  it('maps an unknown service type to the open enum fallback', () => {
    const v1 = load<V1.ServicePageData>('1', 'catalog.service.unknown-type')
    expect(v1.service.type).toBe('other')
  })

  it('passes an empty service type through unchanged', () => {
    expect(load<V202611.PageEnvelope<'catalog.service'>>('2026-11', 'catalog.service.empty-type').data!.service.type).toBe('')
    expect(load<V1.ServicePageData>('1', 'catalog.service.empty-type').service.type).toBe('')
    expect(validateType('1', 'ServiceType', '')).toEqual([])
  })

  it('accepts a region whose children are null, and always sends an order form array', () => {
    const envelope = load<Record<string, any>>('2026-11', 'catalog.service')
    const plan = envelope.data.plans[0]
    plan.order_form = [
      {
        order: 0,
        type: 'location-multi-dropdown',
        label: 'Location',
        description: '',
        key: 'location',
        required: true,
        dropdown: [{ order: 0, label: 'Europe', default: true, default_value: '', children: null }],
      },
    ]
    envelope.data.plans[1].order_form = null
    const v1 = downgrade(envelope as unknown as V202611.AnyPageEnvelope) as V1.ServicePageData
    expect(v1.plans[0]!.order_form![0]!.dropdown![0]!.children).toEqual([])
    expect(v1.plans[1]!.order_form).toEqual([])
    expect(validate('1', 'catalog.service', v1)).toEqual([])
  })

  it('omits og_image and no_index when they are empty or false', () => {
    expect(load<V1.HomePageData>('1', 'home').meta).toEqual({
      title: 'Acme Hosting',
      description: 'Acme Hosting — hosting, domains and more.',
      og_image: 'https://cdn.example.com/acme/og.png',
    })
    expect(load<V1.GroupPageData>('1', 'catalog.group').meta.og_image).toBeUndefined()
    expect(load<V1.NotFoundPageData>('1', 'not-found').meta.no_index).toBe(true)
  })

  it('leaves original_price out when it is null', () => {
    const v1 = load<V1.ServicePageData>('1', 'catalog.service')
    expect(v1.plans[0]!.pricing.original_price).toEqual({ amount: 15.99, currency: 'USD', interval: 'month' })
    expect('original_price' in v1.plans[1]!.pricing).toBe(false)
  })

  it('keeps the service page of a single-plan redirect', () => {
    const v1 = load<V1.ServicePageData>('1', 'catalog.service.single-plan')
    expect(v1.service.single_plan).toBe(true)
    expect(v1.plans).toHaveLength(1)
  })

  it('derives domains_enabled from the domains link', () => {
    expect(load<V1.HomePageData>('1', 'home').domains_enabled).toBe(true)
    expect(load<V1.HomePageData>('1', 'home.no-domains').domains_enabled).toBe(false)
  })

  it('fills unset and ill-typed settings from the standard defaults', () => {
    const content = load<V1.HomePageData>('1', 'home.unset-settings').content
    const def = (id: string): unknown => STANDARD_SETTINGS.find((s) => s.id === id)!.default
    expect(content.hero.title).toBe('Only the headline is set')
    expect(content.hero.highlights).toEqual(def('hero.highlights') as string[])
    expect(content.hero.primary_cta).toEqual(def('hero.primary_cta') as V1.Cta)
    expect(content.features.cards).toEqual(def('features.cards') as V1.FeatureCard[])
    expect(content.faq.items).toEqual([])
    expect(content.faq.subtitle).toBe('')
  })

  it('refuses an envelope without the data it needs', () => {
    const envelope = load<Record<string, unknown>>('2026-11', 'catalog.group')
    delete envelope.data
    expect(() => downgrade(envelope as unknown as V202611.AnyPageEnvelope)).toThrow(DowngradeError)
  })
})

describe('validate', () => {
  const home = () => load<Record<string, any>>('2026-11', 'home')

  it('reports a wrong type with its path', () => {
    const envelope = home()
    envelope.data.groups[0].marketing.features = 'none'
    expect(validate('2026-11', 'home', envelope)).toEqual([
      { path: '$.data.groups[0].marketing.features', message: 'expected an array, got string "none"' },
    ])
  })

  it('reports missing and unknown keys, unless unknown keys are allowed', () => {
    const envelope = home()
    delete envelope.meta.title
    envelope.store.extra = true
    expect(validate('2026-11', 'home', envelope).map((e) => e.path)).toEqual(['$.meta.title', '$.store.extra'])
    expect(validate('2026-11', 'home', envelope, { allowUnknownKeys: true }).map((e) => e.path)).toEqual([
      '$.meta.title',
    ])
  })

  it('checks the page id and the data shape it selects', () => {
    expect(validate('2026-11', 'domains', home()).map((e) => e.path)).toContain('$.page.id')
    expect(validate('2026-11', 'checkout', home())[0]!.message).toBe('contract 2026-11 has no page checkout')
  })

  it('accepts any string in an open enum and rejects one outside a closed enum', () => {
    expect(validateType('2026-11', 'ServiceType', 'object-storage')).toEqual([])
    expect(validateType('1', 'ServiceType', 'object-storage')).toHaveLength(1)
    expect(validateType('2026-11', 'PriceInterval', 'week')).toHaveLength(1)
  })

  it('accepts null where contract 1 allows it', () => {
    const v1 = load<Record<string, any>>('1', 'catalog.service')
    v1.plans[0].order_form = null
    expect(validate('1', 'catalog.service', v1)).toEqual([])
    v1.plans[0].pricing.original_price = null
    expect(validate('1', 'catalog.service', v1)[0]!.path).toBe('$.plans[0].pricing.original_price')
  })

  it('rejects integers that are not whole and unknown contracts', () => {
    expect(validateType('2026-11', 'Redirect', { location: '/x', status: 301.5 })).toHaveLength(1)
    expect(() => validate('2099-01', 'home', {})).toThrow()
  })
})
