import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LINK_CASES } from '../src/link-cases'
import {
  LINK_HREF_RULE,
  LINK_URL_RULE,
  linkValueError,
  settingValueError,
  STANDARD_SETTINGS,
  validateSettingSchema,
  type LinkKind,
  type SettingSchemaEntry,
} from '../src/settings'
import { linkValueError as generatedLinkValueError } from '../dist/ts/registry'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'links.json')
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { kind: LinkKind; value: string; ok: boolean }[]

describe('fixtures/links.json', () => {
  it('is the table of link cases, as { kind, value, ok }', () => {
    expect(fixture).toEqual(LINK_CASES.map((c) => ({ kind: c.kind, value: c.value, ok: c.ok })))
    for (const row of fixture) expect(Object.keys(row)).toEqual(['kind', 'value', 'ok'])
  })

  it('covers every kind with accepted and refused values', () => {
    for (const kind of ['link', 'url', 'image'] as const) {
      expect(fixture.some((c) => c.kind === kind && c.ok)).toBe(true)
      expect(fixture.some((c) => c.kind === kind && !c.ok)).toBe(true)
    }
  })

  it('agrees with the rule, in the contract and in the generated registry module', () => {
    for (const c of fixture) {
      const expected = c.ok ? null : c.kind === 'link' ? LINK_HREF_RULE : LINK_URL_RULE
      expect([c.kind, c.value, linkValueError(c.kind, c.value)]).toEqual([c.kind, c.value, expected])
      expect([c.kind, c.value, generatedLinkValueError(c.kind, c.value)]).toEqual([c.kind, c.value, expected])
    }
  })
})

describe('the link rule in settings', () => {
  const entries: Record<string, SettingSchemaEntry> = {
    link: { id: 'l.link', type: 'link' },
    url: { id: 'l.url', type: 'url' },
    image: { id: 'l.image', type: 'image' },
    urls: { id: 'l.urls', type: 'list', of: 'url' },
    images: { id: 'l.images', type: 'list', of: 'image' },
    rows: {
      id: 'l.rows',
      type: 'object-list',
      fields: [
        { id: 'href', type: 'url' },
        { id: 'src', type: 'image' },
      ],
    },
  }

  /** Each place a value of `kind` can sit, with the message a refusal of it gives. */
  const places = (kind: LinkKind, value: string): [SettingSchemaEntry, unknown, string][] => {
    if (kind === 'link') return [[entries.link!, { label: 'Go', href: value }, `href ${LINK_HREF_RULE}`]]
    const key = kind === 'url' ? 'href' : 'src'
    const row = kind === 'url' ? { href: value, src: '/ok.png' } : { href: '/ok', src: value }
    return [
      [entries[kind]!, value, LINK_URL_RULE],
      [entries[`${kind}s`]!, ['/ok', value], `entry 1 ${LINK_URL_RULE}`],
      [entries.rows!, [row], `entry 0 field ${key} ${LINK_URL_RULE}`],
    ]
  }

  it('applies to a link href and to url and image values, list items and object-list fields', () => {
    for (const c of LINK_CASES) {
      for (const [entry, value, refusal] of places(c.kind, c.value)) {
        expect([entry.id, c.value, settingValueError(entry, value)]).toEqual([entry.id, c.value, c.ok ? null : refusal])
      }
    }
  })

  it('refuses a declared default a store could not save', () => {
    expect(
      validateSettingSchema([
        { id: 'a', type: 'link', default: { label: 'Docs', href: 'http://docs.acme.test' } },
        { id: 'b', type: 'url', default: '//cdn.acme.test/x' },
        { id: 'c', type: 'image', default: '#hero' },
        { id: 'd', type: 'list', of: 'image', default: ['/a.png', 'b.png'] },
        { id: 'e', type: 'object-list', fields: [{ id: 'href', type: 'url' }], default: [{ href: 'javascript:void(0)' }] },
        { id: 'f', type: 'link', default: { label: 'Top', href: '#top' } },
      ]),
    ).toEqual([
      `settings[0].default href ${LINK_HREF_RULE}`,
      `settings[1].default ${LINK_URL_RULE}`,
      `settings[2].default ${LINK_URL_RULE}`,
      `settings[3].default entry 1 ${LINK_URL_RULE}`,
      `settings[4].default entry 0 field href ${LINK_URL_RULE}`,
    ])
  })

  it('accepts every standard default', () => {
    for (const s of STANDARD_SETTINGS) expect([s.id, settingValueError(s, s.default)]).toEqual([s.id, null])
  })

  it('checks length first, then the form', () => {
    expect(settingValueError({ id: 'u', type: 'url', max: 3 }, 'http://x')).toBe('must be at most 3 characters')
    expect(settingValueError({ id: 'u', type: 'url', max: 30 }, 'http://x')).toBe(LINK_URL_RULE)
  })
})
