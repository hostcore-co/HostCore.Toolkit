import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLOTS } from '../../contract/dist/ts/registry'
import { readRegistry, validateRegistry } from '../../contract/src/registry'
import type { CheckReport } from '../check'
import type { ManifestV2 } from '../manifest'
import { loadTemplate } from '../template'
import { validateTemplate } from '../validate'
import { hct, loadBundle, type LoadedBundle } from './host'

const REPO = join(import.meta.dir, '..', '..')
const TMP = join(REPO, '.test-tmp', `slots-${process.pid}`)
const RUNTIME = join(TMP, 'runtime')
const FIXTURES = join(REPO, 'contract', 'fixtures', '2026-11')
const ENV = { build_id: '', asset_base: '/_hc/b/test/client/', locale: 'en', currency: 'USD', mode: 'composed' }

async function template(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(TMP, name)
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), text)
  }
  await writeFile(join(dir, 'template.json'), JSON.stringify({ id: name, version: '1.0.0', name, format: 2, contract: '2026-11', toolchain: 2 }))
  return dir
}

async function build(dir: string, ...extra: string[]): Promise<{ manifest: ManifestV2; bundle: LoadedBundle }> {
  const out = join(dir, 'dist')
  const result = await hct(['build', dir, '--local-paths', '--out', out, '--runtime', RUNTIME, ...extra])
  if (result.code !== 0) throw new Error(result.stderr)
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as ManifestV2
  return { manifest, bundle: loadBundle(RUNTIME, join(out, manifest.entry.server)) }
}

const slotInput = (slot: string, payload: unknown) => JSON.stringify({ kind: 'slot', slot, payload, env: ENV })

let home: Record<string, any>

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
  const runtime = await hct(['runtime', 'build', '--out', RUNTIME])
  if (runtime.code !== 0) throw new Error(runtime.stderr)
  home = JSON.parse(await readFile(join(FIXTURES, 'home.json'), 'utf8'))
}, 60_000)

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('the registry', () => {
  it('declares checkout.summary, under the order summary at checkout', () => {
    expect(SLOTS).toEqual([{ id: 'checkout.summary', page: 'checkout', description: 'Under the order summary on the checkout pages.' }])
  })

  it('refuses a slot that is not on a platform page, or is not named after its page', () => {
    const registry = readRegistry(join(REPO, 'contract'))
    expect(validateRegistry(registry)).toEqual([])
    registry.slots = [
      { id: 'home.hero', page: 'home', description: 'On the home page.' },
      { id: 'login.below', page: 'checkout', description: 'Below.' },
      { id: 'checkout.x', page: 'nowhere', description: '' },
    ]
    expect(validateRegistry(registry)).toEqual([
      'slot home.hero: a slot is on a page the platform renders itself, not on an engine page',
      'slot login.below: id must start with its page id and a dot',
      'slot checkout.x: page must be the id of a page in the registry',
      'slot checkout.x: description must be one line',
    ])
  })
})

describe('hct validate on slots', () => {
  it('refuses an unknown slot id, and anything in a slot that needs script or reads the page', async () => {
    const dir = await template('validate', {
      'src/slots/checkout.total.tsx': 'export default function X() { return <p>x</p> }\n',
      'src/islands/faq.tsx': 'export default function Faq() { return <p>faq</p> }\n',
      'src/slots/checkout.summary.tsx': [
        "import { useState } from 'react'",
        "import { island, usePage } from '@hostcore/toolkit'",
        "import Faq from '../islands/faq'",
        'const FaqIsland = island(Faq)',
        'export default function Summary() {',
        '  const [n] = useState(0)',
        '  const page = usePage()',
        '  return <button onClick={() => {}}>{n}{page.page.id}<FaqIsland /></button>',
        '}',
        '',
      ].join('\n'),
    })
    const { findings } = await validateTemplate(await loadTemplate(dir))
    expect(findings.map((f) => [f.file, f.line, f.rule])).toEqual([
      ['src/slots/checkout.total.tsx', 0, 'unknown-slot'],
      ['src/slots/checkout.summary.tsx', 1, 'slot-needs-script'],
      ['src/slots/checkout.summary.tsx', 3, 'slot-needs-script'],
      ['src/slots/checkout.summary.tsx', 4, 'slot-needs-script'],
      ['src/slots/checkout.summary.tsx', 6, 'slot-needs-script'],
      ['src/slots/checkout.summary.tsx', 7, 'slot-reads-page'],
      ['src/slots/checkout.summary.tsx', 8, 'slot-needs-script'],
    ])
    expect(findings[0]!.message).toContain('Slot files are named after the slot id: checkout.summary.tsx')
  })
})

describe('a slot in a build', () => {
  it('is listed in the manifest and the bundle, and renders through render() with kind "slot"', async () => {
    const dir = await template('slotted', {
      'src/slots/checkout.summary.tsx': [
        "import { useSetting, useStore, usePage } from '@hostcore/toolkit'",
        'export default function Summary() {',
        "  return <p>{`${useStore().name} ${String(useSetting('hero.title'))} ${usePage().page.id} ${usePage().data === undefined}`}</p>",
        '}',
        '',
      ].join('\n'),
    })
    const { manifest, bundle } = await build(dir, '--skip-validation')
    expect(manifest.slots).toEqual(['checkout.summary'])
    expect(bundle.slots).toEqual(['checkout.summary'])
    const output = JSON.parse(bundle.render(slotInput('checkout.summary', home)))
    expect(Object.keys(output)).toEqual(['html'])
    expect(output.html).toBe(`<p>${home.store.name} ${home.settings['hero.title']} checkout true</p>`)
    expect(() => bundle.render(slotInput('checkout.total', home))).toThrow('HC_SLOT_NOT_IMPLEMENTED: "checkout.total" is not a slot')
    expect(() => bundle.render(JSON.stringify({ kind: 'slot', payload: home, env: ENV }))).toThrow('HC_BAD_INPUT: slot must be a slot id')
  }, 60_000)

  it('is not listed for a template without one, which cannot render it', async () => {
    const { manifest, bundle } = await build(join(REPO, 'examples', 'minimal'))
    expect(manifest.slots).toEqual([])
    expect(bundle.slots).toEqual([])
    expect(() => bundle.render(slotInput('checkout.summary', home))).toThrow('HC_SLOT_NOT_IMPLEMENTED: this template does not fill slot "checkout.summary"')
  }, 60_000)

  it('fails to render an island or a script', async () => {
    const island = await template('slot-island', {
      'src/islands/faq.tsx': 'export default function Faq() { return <p>faq</p> }\n',
      'src/slots/checkout.summary.tsx':
        "import { island } from '@hostcore/toolkit'\nimport Faq from '../islands/faq'\nconst F = island(Faq)\nexport default function S() { return <F /> }\n",
    })
    const script = await template('slot-script', {
      'src/slots/checkout.summary.tsx': "export default function S() { return <script dangerouslySetInnerHTML={{ __html: 'x' }} /> }\n",
    })
    const islands = await build(island, '--skip-validation')
    expect(() => islands.bundle.render(slotInput('checkout.summary', home))).toThrow('HC_SLOT_SCRIPT: slot "checkout.summary" renders an island')
    const { bundle } = await build(script, '--skip-validation')
    expect(() => bundle.render(slotInput('checkout.summary', home))).toThrow('HC_SLOT_SCRIPT: slot "checkout.summary" renders a script')
  }, 60_000)
})

describe('hct check on slots', () => {
  it('fails a slot that throws, and passes one that renders nothing', async () => {
    const dir = await template('slot-check', {
      'src/slots/checkout.summary.tsx': [
        "import { useNav, useStore } from '@hostcore/toolkit'",
        'export default function S() {',
        "  if (useNav().links.domains === '') return null",
        "  if (useStore().logo_url === '') throw new Error('no logo')",
        '  return <p>ok</p>',
        '}',
        '',
      ].join('\n'),
    })
    const result = await hct(['check', dir, '--runtime', RUNTIME, '--json'])
    const report = JSON.parse(result.stdout) as CheckReport
    const slots = report.results.filter((r) => r.kind === 'slot')
    expect(slots.length).toBeGreaterThan(1)
    expect(slots.every((r) => r.page === 'checkout.summary' && r.variant === '')).toBe(true)
    const failed = slots.filter((r) => !r.ok)
    expect(failed.length).toBeGreaterThan(0)
    for (const r of failed) expect(r.error).toBe('HC_RENDER_FAILED: slot "checkout.summary": no logo')
    expect(slots.some((r) => r.ok && r.bytes === 0)).toBe(true)
    expect(result.code).toBe(1)
  }, 60_000)
})
