import { describe, expect, it } from 'bun:test'
import { buildId, canonicalJson, type ManifestV2 } from '../manifest'

/** A small manifest whose canonical form is written out by hand below. */
const MANIFEST: ManifestV2 = {
  manifest_version: 2,
  build_id: 'ignored',
  template_id: 'acme',
  version: '2.1.0',
  built_at: '2026-11-16T10:00:00.000Z',
  protocol: 2,
  contract: '2026-11',
  toolchain: { line: 2, revision: 0 },
  runtime: { id: 'r'.repeat(64) },
  entry: { server: 'server/entry.server.cjs', client_js: 'client/entry.client.ab12.js', css: '' },
  files: { 'server/entry.server.cjs': { integrity: 'sha256-AAAA', bytes: 10 } },
  pages: ['home'],
  layouts: [],
  islands: [],
  tokens: { 'color.accent': '#5b8cff' },
  settings: [],
  inventory: [{ name: 'gsap', version: '3.15.1', in: ['client'] }],
  media_base: 'https://cdn.example.com/builds/x/client',
  signature: 'ignored',
}

/**
 * The canonical JSON the id is the sha256 of: keys sorted, no whitespace,
 * build_id, built_at and signature removed, media_base empty.
 */
const CANONICAL =
  '{"contract":"2026-11","entry":{"client_js":"client/entry.client.ab12.js","css":"","server":"server/entry.server.cjs"},' +
  '"files":{"server/entry.server.cjs":{"bytes":10,"integrity":"sha256-AAAA"}},' +
  '"inventory":[{"in":["client"],"name":"gsap","version":"3.15.1"}],"islands":[],"layouts":[],' +
  '"manifest_version":2,"media_base":"","pages":["home"],"protocol":2,' +
  `"runtime":{"id":"${'r'.repeat(64)}"},"settings":[],"template_id":"acme",` +
  '"tokens":{"color.accent":"#5b8cff"},"toolchain":{"line":2,"revision":0},"version":"2.1.0"}'

describe('buildId', () => {
  it('is the sha256 of the canonical manifest without the id, the time, the signature and the media base', () => {
    expect(canonicalJson({ ...MANIFEST, build_id: undefined, built_at: undefined, signature: undefined, media_base: '' })).toBe(CANONICAL)
    expect(buildId(MANIFEST)).toBe('66dd8021b875ac25ddea1c6dea8eb6ec0777bc8530055a081a6a2e6e3eb9ea05')
    expect(buildId(MANIFEST)).toBe(new Bun.CryptoHasher('sha256').update(CANONICAL).digest('hex'))
  })

  it('does not change with the media base, the build time or the signature', () => {
    const moved = { ...MANIFEST, media_base: '', built_at: '2027-01-01T00:00:00.000Z', signature: undefined }
    expect(buildId(moved)).toBe(buildId(MANIFEST))
  })

  it('changes with anything else', () => {
    expect(buildId({ ...MANIFEST, version: '2.1.1' })).not.toBe(buildId(MANIFEST))
    expect(buildId({ ...MANIFEST, files: {} })).not.toBe(buildId(MANIFEST))
  })
})
