import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoreTheme } from '../dist/ts/contract-2026-11'
import * as generated from '../dist/ts/registry'
import { TOKEN_CASES } from '../src/token-cases'
import { readRegistry } from '../src/registry'
import { settingValueError, STANDARD_SETTINGS, validateSettingSchema, type SettingSchemaEntry } from '../src/settings'
import { effectiveTokens, PLATFORM_THEME, THEME_KEYS, THEME_TOKENS, TOKENS, validateTokens } from '../src/tokens'

describe('settings', () => {
  it('declares the standard settings validly, with defaults that fit', () => {
    expect(validateSettingSchema(STANDARD_SETTINGS)).toEqual([])
    expect(STANDARD_SETTINGS.map((s) => s.id)).toEqual([
      'hero.title',
      'hero.subtitle',
      'hero.highlights',
      'hero.primary_cta',
      'hero.secondary_cta',
      'categories.title',
      'categories.subtitle',
      'features.title',
      'features.subtitle',
      'features.cards',
      'faq.title',
      'faq.subtitle',
      'faq.items',
    ])
  })

  it('lets a template change a standard setting\'s label, limits and default, but not its shape', () => {
    expect(
      validateSettingSchema([
        { id: 'hero.title', type: 'text', label: 'Banner headline', max: 80, default: 'Welcome' },
        { id: 'hero.highlights', type: 'list', max: 3 },
        {
          id: 'faq.items',
          type: 'object-list',
          max: 8,
          fields: [
            { id: 'answer', type: 'textarea', max: 500 },
            { id: 'question', type: 'text', max: 120 },
          ],
        },
      ]),
    ).toEqual([])

    expect(
      validateSettingSchema([
        { id: 'hero.title', type: 'textarea' },
        { id: 'hero.highlights', type: 'list', of: 'url' },
        { id: 'features.cards', type: 'object-list', fields: [{ id: 'title', type: 'text' }] },
        {
          id: 'faq.items',
          type: 'object-list',
          fields: [
            { id: 'question', type: 'text' },
            { id: 'answer', type: 'text' },
          ],
        },
      ]),
    ).toEqual([
      'settings[0].type must be text: hero.title is a standard setting and keeps its shape in every template',
      'settings[1].of must be text: hero.highlights is a standard setting and keeps its shape in every template',
      'settings[2].fields must be title (text), description (text): features.cards is a standard setting and keeps its shape in every template',
      'settings[3].fields must be question (text), answer (textarea): faq.items is a standard setting and keeps its shape in every template',
    ])
  })

  it('accepts a stored FAQ question as long as a store could always save one', () => {
    const faq = STANDARD_SETTINGS.find((s) => s.id === 'faq.items')!
    expect(settingValueError(faq, [{ question: 'q'.repeat(600), answer: '' }])).toBeNull()
    expect(settingValueError(faq, [{ question: 'q'.repeat(601), answer: '' }])).not.toBeNull()
  })

  it('rejects malformed declarations', () => {
    const errors = validateSettingSchema([
      { id: 'Hero Title', type: 'text' },
      { id: 'a', type: 'text' },
      { id: 'a', type: 'colour' },
      { id: 'b', type: 'select' },
      { id: 'c', type: 'object-list', fields: [{ id: 'x', type: 'list' }] },
      { id: 'd', type: 'text', max: 3, default: 'too long' },
      { id: 'e', type: 'text', options: [] },
    ])
    expect(errors).toEqual([
      'settings[0].id must match ^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)*$',
      'settings[2].id a is declared twice',
      'settings[2].type must be one of text, textarea, url, link, color, boolean, number, select, image, list, object-list',
      'settings[3].options must list at least one option',
      'settings[4].fields[0].type must be one of text, textarea, url, color, image, boolean, number',
      'settings[5].default must be at most 3 characters',
      'settings[6].options is only for select settings',
    ])
  })

  it('checks values against their setting', () => {
    const cards = STANDARD_SETTINGS.find((s) => s.id === 'features.cards')!
    expect(settingValueError(cards, [{ title: 'a', description: 'b' }])).toBeNull()
    expect(settingValueError(cards, [{ title: 'a' }])).toBe('entry 0 is missing description')
    expect(settingValueError(cards, new Array(13).fill({ title: 'a', description: 'b' }))).toBe('must have at most 12 entries')
    expect(settingValueError({ id: 'x', type: 'link' }, { label: 'a', href: '/' })).toBeNull()
    expect(settingValueError({ id: 'x', type: 'color' }, 'red')).toBe('must be a hex colour')
    expect(settingValueError({ id: 'x', type: 'number', min: 1, max: 5 }, 0)).toBe('must be at least 1')
    expect(settingValueError({ id: 'x', type: 'select', options: [{ value: 'a', label: 'A' }] }, 'b')).toBe(
      'must be one of the options',
    )
  })
})

describe('optional setting keys', () => {
  it('accepts description, number bounds, item_max and field keys', () => {
    expect(
      validateSettingSchema([
        { id: 'a', type: 'text', description: 'Shown under the hero', max: 80 },
        { id: 'b', type: 'number', min: 0, max: 10, step: 0.5, default: 2.5 },
        { id: 'c', type: 'link', max: 40, default: { label: 'Go', href: '/' } },
        { id: 'd', type: 'list', of: 'text', max: 3, item_max: 20, default: ['x'] },
        {
          id: 'e',
          type: 'object-list',
          fields: [
            { id: 'title', type: 'text', max: 10, description: 'Short' },
            { id: 'count', type: 'number', min: 1, max: 9, step: 2, description: 'Odd only' },
          ],
          default: [{ title: 'one', count: 3 }],
        },
      ]),
    ).toEqual([])
  })

  it('rejects the keys where they do not apply, and bad values for them', () => {
    expect(
      validateSettingSchema([
        { id: 'a', type: 'text', step: 1, min: 0 },
        { id: 'b', type: 'number', step: 0, min: 5, max: 1 },
        { id: 'c', type: 'text', item_max: 3 },
        { id: 'd', type: 'list', item_max: -1 },
        { id: 'e', type: 'text', description: 3 },
        { id: 'f', type: 'object-list', fields: [{ id: 'x', type: 'text', step: 1, description: false }] },
      ]),
    ).toEqual([
      'settings[0].min is only for number settings',
      'settings[0].step is only for number settings',
      'settings[1].step must be greater than zero',
      'settings[1].min must not be greater than max',
      'settings[2].item_max is only for list settings',
      'settings[3].item_max must be a whole number',
      'settings[4].description must be a string',
      'settings[5].fields[0].description must be a string',
      'settings[5].fields[0].step is only for number settings',
    ])
  })

  it('applies the keys to values', () => {
    const number = { id: 'n', type: 'number', min: 1, max: 9, step: 2 } as const
    expect(settingValueError(number, 5)).toBeNull()
    expect(settingValueError(number, 4)).toBe('must be a multiple of 2 from 1')
    expect(settingValueError({ id: 'n', type: 'number', step: 0.1 }, 0.3)).toBeNull()
    expect(settingValueError({ id: 'l', type: 'link', max: 4 }, { label: 'Home', href: '/x' })).toBeNull()
    expect(settingValueError({ id: 'l', type: 'link', max: 4 }, { label: 'Homes', href: '/' })).toBe(
      'label must be at most 4 characters',
    )
    expect(settingValueError({ id: 'l', type: 'link', max: 4 }, { label: 'a', href: '/abcd' })).toBe(
      'href must be at most 4 characters',
    )
    expect(settingValueError({ id: 'h', type: 'list', item_max: 3 }, ['abc', 'abcd'])).toBe(
      'entry 1 must be at most 3 characters',
    )
    const objects: SettingSchemaEntry = {
      id: 'o',
      type: 'object-list',
      fields: [{ id: 'count', type: 'number', min: 1, step: 2 }],
    }
    expect(settingValueError(objects, [{ count: 3 }])).toBeNull()
    expect(settingValueError(objects, [{ count: 0 }])).toBe('entry 0 field count must be at least 1')
  })
})

describe('design tokens', () => {
  it('maps every token to an --hc- property', () => {
    expect(TOKENS.map((t) => [t.name, t.property])).toContainEqual(['color.surface-raised', '--hc-surface-raised'])
    expect(TOKENS.map((t) => [t.name, t.property])).toContainEqual(['space.unit', '--hc-space-unit'])
    expect(TOKENS.filter((t) => t.theme_key)).toHaveLength(8)
  })

  it('validates values by kind', () => {
    expect(
      validateTokens({
        'color.accent': '#5b8cff',
        'radius.md': '0.5rem',
        'font.body': '"Inter", system-ui, sans-serif',
        'space.unit': '4px',
      }),
    ).toEqual([])
    expect(
      validateTokens({ 'color.accent': 'blue', 'radius.md': '4em', 'font.body': 'x;}', 'shadow.lg': '1px' }),
    ).toHaveLength(4)
  })

  it('accepts only #rgb and #rrggbb colours', () => {
    expect(validateTokens({ 'color.accent': '#abc', 'color.text': '#AABBCC' })).toEqual([])
    expect(validateTokens({ 'color.accent': '#abcd', 'color.text': '#aabbccdd' })).toHaveLength(2)
    const color: SettingSchemaEntry = { id: 'brand', type: 'color' }
    expect(settingValueError(color, '#5b8cff')).toBeNull()
    expect(settingValueError(color, '#5b8')).toBeNull()
    expect(settingValueError(color, '#5b8c')).toBe('must be a hex colour')
    expect(settingValueError(color, '#5b8cff80')).toBe('must be a hex colour')
  })
})

describe('link limits', () => {
  const link: SettingSchemaEntry = { id: 'cta', type: 'link', max: 5, href_max: 10 }

  it('limit the label with max and the href with href_max', () => {
    expect(settingValueError(link, { label: 'Go', href: '/0123456789' })).toBe('href must be at most 10 characters')
    expect(settingValueError(link, { label: 'Go now', href: '/x' })).toBe('label must be at most 5 characters')
    expect(settingValueError(link, { label: 'Go', href: '/012345678' })).toBeNull()
  })

  it('limit both with max when href_max is absent', () => {
    expect(settingValueError({ id: 'cta', type: 'link', max: 5 }, { label: 'Go', href: '/01234' })).toBe(
      'href must be at most 5 characters',
    )
  })

  it('declare href_max only on links, as a whole number', () => {
    expect(validateSettingSchema([link])).toEqual([])
    expect(
      validateSettingSchema([
        { id: 'a', type: 'text', href_max: 3 },
        { id: 'b', type: 'link', href_max: 1.5 },
      ]),
    ).toEqual(['settings[0].href_max is only for link settings', 'settings[1].href_max must be a whole number'])
  })
})

describe('standard setting limits', () => {
  const byId = (id: string) => STANDARD_SETTINGS.find((s) => s.id === id)!
  const field = (id: string, f: string) => byId(id).fields!.find((x) => x.id === f)!

  it('limit short text to 160 characters and long text, including an FAQ question, to 600', () => {
    for (const id of ['hero.title', 'categories.title', 'features.title', 'faq.title']) expect(byId(id).max).toBe(160)
    for (const id of ['hero.subtitle', 'categories.subtitle', 'features.subtitle', 'faq.subtitle']) expect(byId(id).max).toBe(600)
    expect(field('features.cards', 'title').max).toBe(160)
    expect(field('features.cards', 'description').max).toBe(600)
    expect(field('faq.items', 'question').max).toBe(600)
    expect(field('faq.items', 'answer').max).toBe(2000)
    expect(byId('hero.highlights').item_max).toBe(160)
    for (const id of ['hero.primary_cta', 'hero.secondary_cta']) {
      expect(byId(id).max).toBe(160)
      expect(byId(id).href_max).toBe(600)
    }
  })

  it('limit how many entries a list holds', () => {
    expect(byId('hero.highlights').max).toBe(6)
    expect(byId('features.cards').max).toBe(12)
    expect(byId('faq.items').max).toBe(24)
  })
})

describe('standard link defaults', () => {
  const registry = readRegistry(join(import.meta.dir, '..'))
  const pagePaths = registry.pages.flatMap((p) => p.paths ?? (p.path ? [p.path] : [])).filter((p) => !p.includes('{'))

  /** Every href and url among the standard settings' defaults, by where it is. */
  const links = STANDARD_SETTINGS.flatMap((s): [string, string][] => {
    if (s.type === 'link') return [[s.id, (s.default as { href: string }).href]]
    if (s.type === 'url') return [[s.id, s.default as string]]
    if (s.type === 'list' && s.of === 'url') return (s.default as string[]).map((v, i): [string, string] => [`${s.id}[${i}]`, v])
    if (s.type === 'object-list') {
      return (s.fields ?? [])
        .filter((f) => f.type === 'url')
        .flatMap((f) => (s.default as Record<string, string>[]).map((row, i): [string, string] => [`${s.id}[${i}].${f.id}`, row[f.id]!]))
    }
    return []
  })

  it('exist', () => {
    expect(links.map(([at]) => at)).toEqual(['hero.primary_cta', 'hero.secondary_cta'])
  })

  it('point at the home page or at the path of a page in the registry', () => {
    expect(pagePaths).toContain('/')
    for (const [at, href] of links) expect([at, pagePaths.includes(href)]).toEqual([at, true])
  })
})

describe('effective design tokens', () => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'tokens.json'), 'utf8')) as {
    name: string
    template: Record<string, string>
    theme: Record<string, string>
    tokens: Record<string, string>
  }[]

  it('agree with fixtures/tokens.json, in the contract and in the generated registry module', () => {
    expect(fixture.map((c) => c.name)).toEqual(TOKEN_CASES.map((c) => c.name))
    for (const c of fixture) {
      expect([c.name, effectiveTokens(c.template, c.theme)]).toEqual([c.name, c.tokens])
      expect([c.name, generated.effectiveTokens(c.template, c.theme)]).toEqual([c.name, c.tokens])
    }
  })

  it('pin the three cases: a changed store colour, an unchanged one, and no template value', () => {
    const template = { 'color.accent': '#5b8cff' }
    expect(effectiveTokens(template, { ...PLATFORM_THEME, accent: '#ff5500' })['color.accent']).toBe('#ff5500')
    expect(effectiveTokens(template, PLATFORM_THEME)['color.accent']).toBe('#5b8cff')
    expect(effectiveTokens({}, PLATFORM_THEME)['color.accent']).toBe('#34D0FF')
    expect(effectiveTokens({}, null)['color.accent']).toBe('#34D0FF')
  })

  it('map every theme key to its colour token, with the platform palette', () => {
    expect(THEME_KEYS.map((k) => THEME_TOKENS[k])).toEqual(TOKENS.filter((t) => t.theme_key).map((t) => t.name))
    expect(TOKENS.filter((t) => t.theme_key).map((t) => t.theme_key)).toEqual([...THEME_KEYS])
    expect(PLATFORM_THEME).toEqual({
      background: '#141517',
      surface: '#111214',
      surface_raised: '#191A1C',
      border: '#27282A',
      text: '#FFFFFF',
      text_muted: '#A2A3A7',
      accent: '#34D0FF',
      accent_strong: '#1F9DFF',
    })
    for (const key of THEME_KEYS) expect(validateTokens({ [THEME_TOKENS[key]]: PLATFORM_THEME[key] })).toEqual([])
  })

  it('accept a store theme as the contract types it', () => {
    const theme: StoreTheme = { ...PLATFORM_THEME, text: '#000000' }
    expect(effectiveTokens({}, theme)['color.text']).toBe('#000000')
  })

  it('leave out the tokens the template does not set, other than colours', () => {
    expect(Object.keys(effectiveTokens({ 'space.unit': '4px', 'not.a-token': '1px' }, PLATFORM_THEME))).toEqual([
      ...TOKENS.filter((t) => t.theme_key).map((t) => t.name),
      'space.unit',
    ])
  })
})
