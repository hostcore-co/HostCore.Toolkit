import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'

/**
 * Loads bundles the way a host does: in a bare vm context with no globals
 * of the host's, where `require` answers only from the runtime's module
 * table. Only strings cross in and out.
 */

const LOADER = `(function (source, filename, modules) {
  const module = { exports: {} }
  const has = Object.prototype.hasOwnProperty
  const require = (specifier) => {
    if (modules !== null && has.call(modules, specifier)) return modules[specifier]
    throw new Error('no module "' + specifier + '" for ' + filename)
  }
  new Function('module', 'exports', 'require', source)(module, module.exports, require)
  return module.exports
})`

const CALL = `(function (bundle, input) {
  try {
    return { ok: true, value: bundle.render(input) }
  } catch (e) {
    return { ok: false, value: String(e && e.message) }
  }
})`

export interface LoadedBundle {
  protocol: number
  pages: string[]
  layouts: string[]
  /** Calls render(); throws an Error with the bundle's message when it fails. */
  render(input: string): string
}

export function loadBundle(runtimeDir: string, bundlePath: string): LoadedBundle {
  const context = createContext(Object.create(null) as object)
  const load = runInContext(LOADER, context) as (s: string, f: string, m: unknown) => Record<string, unknown>
  const call = runInContext(CALL, context) as (b: unknown, i: string) => { ok: boolean; value: string }
  const table = load(readFileSync(join(runtimeDir, 'server.cjs'), 'utf8'), 'server.cjs', null)
  const bundle = load(readFileSync(bundlePath, 'utf8'), bundlePath, table)
  return {
    // Copied out as JSON so nothing of the realm's is kept on this side.
    protocol: JSON.parse(JSON.stringify(bundle.protocol)) as number,
    pages: JSON.parse(JSON.stringify(bundle.pages)) as string[],
    layouts: JSON.parse(JSON.stringify(bundle.layouts)) as string[],
    render(input) {
      const result = call(bundle, input)
      if (!result.ok) throw new Error(result.value)
      return result.value
    },
  }
}

/** The runtime's module table as module → its export names, read in a bare context. */
export function runtimeModules(runtimeDir: string): Record<string, string[]> {
  const context = createContext(Object.create(null) as object)
  const load = runInContext(LOADER, context) as (s: string, f: string, m: unknown) => Record<string, unknown>
  const table = load(readFileSync(join(runtimeDir, 'server.cjs'), 'utf8'), 'server.cjs', null)
  const describe = runInContext(
    '(function (t) { const o = {}; for (const k of Object.keys(t)) o[k] = Object.keys(t[k]).sort(); return JSON.stringify(o) })',
    context,
  ) as (t: unknown) => string
  return JSON.parse(describe(table)) as Record<string, string[]>
}

/**
 * Runs the hct CLI with the Bun running the tests, in the environment an
 * author runs it in: bun test's NODE_ENV=test is not passed on.
 */
export async function hct(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const { NODE_ENV: _test, ...env } = process.env
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'index.ts'), ...args], {
    cwd: cwd ?? join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...env, TEMPLATE_SIGNING_PRIVATE_KEY: '' },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}
