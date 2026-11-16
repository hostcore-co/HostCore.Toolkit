import { describe, expect, it } from 'bun:test'
import { settingValueError, STANDARD_SETTINGS, validateSettingSchema } from '../src/settings'
import { TOKENS, validateTokens } from '../src/tokens'

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
})
