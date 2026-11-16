import type { LinkKind } from './settings'

/**
 * The cases of the link rule, published as `fixtures/links.json` so every
 * implementation of the rule can be tested against the same table.
 * `hct contract generate` writes the file and checks each case against
 * linkValueError; `ok` is whether the value is accepted as that kind.
 */

export interface LinkCase {
  kind: LinkKind
  value: string
  ok: boolean
}

const KINDS: readonly LinkKind[] = ['link', 'url', 'image']

/** Refused as every kind. */
const HOSTILE: readonly string[] = [
  '//evil.example.com',
  '//evil.example.com/path',
  '/\\evil.example.com',
  '/\\/evil.example.com',
  '\\\\evil.example.com',
  '\\/evil.example.com',
  '/\t/evil.example.com',
  '/\n/evil.example.com',
  '/\r/evil.example.com',
  '\t//evil.example.com',
  ' //evil.example.com',
  ' /games',
  '/\u0000/evil.example.com',
  '/\u0001',
  '/\u001f',
  '/\u007f',
  'https://acme.test/\ttab',
  'https://acme.test/\nline',
  '#top\n',
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<p>hi</p>',
  'vbscript:msgbox(1)',
  'http://acme.test',
  'HTTPS://acme.test',
  'https:acme.test',
  'https:/acme.test',
  'https:\\\\acme.test',
  'ftp://acme.test',
  'mailto:help@acme.test',
  'tel:+15550100',
  'acme.test',
  'games',
  './games',
  '../games',
  '?plan=pro',
]

/** Accepted as every kind. */
const SAFE: readonly string[] = [
  '',
  '/',
  '/games',
  '/games/rust?plan=pro#top',
  '/a//b',
  '/a\\b',
  '/games ',
  '/images/hero.png#frame',
  'https://',
  'https://docs.acme.test/guide',
  'https://acme.test/a b',
]

/** Accepted as a link's href, refused as a url or image. */
const FRAGMENTS: readonly string[] = ['#', '#top', '#faq-1', '#/route']

export const LINK_CASES: readonly LinkCase[] = [
  ...SAFE.flatMap((value) => KINDS.map((kind) => ({ kind, value, ok: true }))),
  ...FRAGMENTS.flatMap((value) => KINDS.map((kind) => ({ kind, value, ok: kind === 'link' }))),
  ...HOSTILE.flatMap((value) => KINDS.map((kind) => ({ kind, value, ok: false }))),
]
