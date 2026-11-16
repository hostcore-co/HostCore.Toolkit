import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FORMAT2_PACKAGE_RANGES } from '../toolchain'
import { idFromName } from '../init'
import { hct } from './host'

const REPO = join(import.meta.dir, '..', '..')
// Inside examples/basic, so a new template resolves the packages basic has
// installed (Tailwind, gsap, embla) the way it would after bun install.
const TMP = join(REPO, 'examples', 'basic', '.test-tmp', `init-${process.pid}`)

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true })
  await mkdir(TMP, { recursive: true })
})

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('hct init', () => {
  it('writes a template that validates, checks and builds as written', async () => {
    const dir = join(TMP, 'Acme Hosting')
    const init = await hct(['init', dir])
    expect(init.code).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['.gitignore', 'package.json', 'public', 'src', 'template.json', 'tsconfig.json'])
    const manifest = JSON.parse(await readFile(join(dir, 'template.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'acme-hosting', name: 'Acme Hosting', version: '0.1.0', format: 2, contract: '2026-11', toolchain: 2 })
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('acme-hosting')
    expect(pkg.dependencies['@hostcore/toolkit']).toMatch(/^github:hostcore-co\/HostCore\.Toolkit#v\d+\.\d+\.\d+$/)

    expect((await hct(['validate', dir])).code).toBe(0)
    const check = await hct(['check', dir, '--json'])
    expect(check.code).toBe(0)
    expect(JSON.parse(check.stdout).ok).toBe(true)
    const build = await hct(['build', dir, '--local-paths', '--out', join(TMP, 'acme-dist')])
    expect(build.code).toBe(0)
    expect(build.stdout).toContain('built acme-hosting@0.1.0 (format 2)')
  }, 60_000)

  it('writes the tokens-only form with --minimal', async () => {
    const dir = join(TMP, 'tokens')
    expect((await hct(['init', dir, '--minimal', '--id', 'acme-tokens', '--name', 'Acme Tokens'])).code).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['.gitignore', 'package.json', 'template.json'])
    const manifest = JSON.parse(await readFile(join(dir, 'template.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'acme-tokens', name: 'Acme Tokens', format: 2 })
    expect(Object.keys(manifest.tokens).length).toBeGreaterThan(0)
    expect((await hct(['validate', dir])).code).toBe(0)
    const check = await hct(['check', dir, '--json'])
    expect(check.code).toBe(0)
    expect(JSON.parse(check.stdout)).toMatchObject({ ok: true, results: [] })
    expect((await hct(['build', dir, '--local-paths', '--out', join(TMP, 'tokens-dist')])).code).toBe(0)
  }, 60_000)

  it('refuses a directory that is not empty, and an id it cannot use', async () => {
    const dir = join(TMP, 'taken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.txt'), 'mine')
    const taken = await hct(['init', dir])
    expect(taken.code).toBe(1)
    expect(taken.stderr).toContain('is not empty')
    expect(await readdir(dir)).toEqual(['notes.txt'])
    const bad = await hct(['init', join(TMP, 'bad'), '--id', 'Not An Id'])
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('is not a template id')
  })

  it('makes ids from directory names', () => {
    expect(idFromName('My Shop_2')).toBe('my-shop-2')
    expect(idFromName('--x--')).toBe('x')
  })

  it('uses the format-2 ranges examples/basic is built with', async () => {
    const pkg = JSON.parse(await readFile(join(REPO, 'examples', 'basic', 'package.json'), 'utf8'))
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(pkg[group] as Record<string, string>)) {
        if (name === '@hostcore/toolkit') continue
        expect(`${name} ${FORMAT2_PACKAGE_RANGES[name]}`).toBe(`${name} ${range}`)
      }
    }
  })
})
