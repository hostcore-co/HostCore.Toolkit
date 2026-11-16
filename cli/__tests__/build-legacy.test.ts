import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
const OUT = join(REPO, '.test-tmp', `legacy-${process.pid}`)

let manifest: Record<string, any>

beforeAll(async () => {
  const result = await hct(['build', 'examples/legacy', '--local-paths', '--out', OUT])
  if (result.code !== 0) throw new Error(result.stderr)
  manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'))
}, 60_000)

afterAll(async () => {
  await rm(OUT, { recursive: true, force: true })
})

describe('format 1 (examples/legacy)', () => {
  it('builds with the Vite the template has installed', async () => {
    const vite = JSON.parse(await readFile(join(REPO, 'examples', 'legacy', 'node_modules', 'vite', 'package.json'), 'utf8'))
    expect(vite.version).toStartWith('5.')
  })

  it('emits the legacy manifest, unchanged', () => {
    expect(Object.keys(manifest).sort()).toEqual(['built_at', 'cdn_paths', 'integrity', 'template_id', 'version'])
    expect(Object.keys(manifest.integrity).sort()).toEqual(['client_bundle', 'css_bundle', 'server_bundle'])
    expect(manifest.cdn_paths.client_js).toMatch(/^\/_hc\/assets\/entry\.client\.[\w-]+\.js$/)
    expect(manifest.cdn_paths.css).toMatch(/^\/_hc\/assets\/assets\.[\w-]+\.css$/)
    expect(manifest.manifest_version).toBeUndefined()
  })

  it('emits a self-contained server bundle that renders contract "1" data in a bare context', async () => {
    const source = await readFile(join(OUT, 'server', 'entry.server.cjs'), 'utf8')
    expect(source).not.toMatch(/(^|[^.\w$])require\s*\(\s*['"]/)
    const files = await readdir(join(OUT, 'client'))
    expect(files.some((f) => f.startsWith('entry.client.'))).toBe(true)

    // A format-1 bundle carries the streaming renderer too, which needs these
    // two at load time; the host provides them, so the test does as well.
    const context = createContext(Object.create(null) as object)
    runInContext(
      `globalThis.MessageChannel = class { constructor() { const p = { postMessage() {}, close() {} }; this.port1 = p; this.port2 = p } }
       globalThis.TextEncoder = class { encode(s) { return Uint8Array.from(unescape(encodeURIComponent(String(s))), (c) => c.charCodeAt(0)) } }`,
      context,
    )
    const html = runInContext(
      `(function (source, json) {
        const module = { exports: {} }
        new Function('module', 'exports', 'require', source)(module, module.exports, () => { throw new Error('no require') })
        return module.exports.render(JSON.parse(json))
      })`,
      context,
    )(source, await readFile(join(REPO, 'contract', 'fixtures', '1', 'home.json'), 'utf8')) as string
    const fixture = JSON.parse(await readFile(join(REPO, 'contract', 'fixtures', '1', 'home.json'), 'utf8'))
    expect(html).toContain(`<h1>${fixture.content.hero.title}</h1>`)
  })
})
