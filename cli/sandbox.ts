import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'

/**
 * Loads server bundles the way the rendering engine does: in a bare `vm`
 * context with none of this process's globals, where `require` answers only
 * from the runtime's module table. Only strings cross in and out, so nothing
 * a bundle returns keeps a reference into its context.
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

/**
 * A format-1 bundle carries React's streaming renderer, which needs these two
 * when it loads. The rendering engine provides them to format-1 bundles, so
 * this context does as well.
 */
const LEGACY_GLOBALS = `globalThis.MessageChannel = class { constructor() { const p = { postMessage() {}, close() {} }; this.port1 = p; this.port2 = p } }
globalThis.TextEncoder = class { encode(s) { return Uint8Array.from(unescape(encodeURIComponent(String(s))), (c) => c.charCodeAt(0)) } }`

const LEGACY_CALL = `(function (bundle, json) {
  try {
    const html = bundle.render(JSON.parse(json))
    if (typeof html !== 'string') return { ok: false, value: 'render() did not return a string' }
    return { ok: true, value: html }
  } catch (e) {
    return { ok: false, value: String(e && e.message) }
  }
})`

export interface LoadedBundle {
  protocol: number
  pages: string[]
  layouts: string[]
  /** The slots the bundle fills; [] for a bundle built before slots existed. */
  slots: string[]
  /** Calls render(); throws an Error with the bundle's message when it fails. */
  render(input: string): string
}

export interface LoadedLegacyBundle {
  /** Renders a contract "1" payload (as JSON) to HTML; throws with the bundle's message when it fails. */
  render(dataJson: string): string
}

type Loader = (source: string, filename: string, modules: unknown) => Record<string, unknown>

function bareContext(): { context: object; load: Loader } {
  const context = createContext(Object.create(null) as object)
  return { context, load: runInContext(LOADER, context) as Loader }
}

/** Copies a value out of a context as JSON, so nothing of the context's is kept here. */
function copyOut<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Loads a format-2 server bundle against the runtime in `runtimeDir`. */
export function loadBundle(runtimeDir: string, bundlePath: string): LoadedBundle {
  return loadBundleSource(
    readFileSync(join(runtimeDir, 'server.cjs'), 'utf8'),
    readFileSync(bundlePath, 'utf8'),
    bundlePath,
  )
}

/** Loads a format-2 server bundle from source, given the runtime's server.cjs source. */
export function loadBundleSource(runtimeSource: string, bundleSource: string, filename: string): LoadedBundle {
  const { context, load } = bareContext()
  const call = runInContext(CALL, context) as (b: unknown, i: string) => { ok: boolean; value: string }
  const table = load(runtimeSource, 'server.cjs', null)
  const bundle = load(bundleSource, filename, table)
  return {
    protocol: copyOut<number>(bundle.protocol ?? null),
    pages: copyOut<string[]>(bundle.pages ?? []),
    layouts: copyOut<string[]>(bundle.layouts ?? []),
    slots: copyOut<string[]>(bundle.slots ?? []),
    render(input) {
      const result = call(bundle, input)
      if (!result.ok) throw new Error(result.value)
      return result.value
    },
  }
}

/** Loads a format-1 server bundle, which requires nothing. */
export function loadLegacyBundle(bundlePath: string): LoadedLegacyBundle {
  const { context, load } = bareContext()
  runInContext(LEGACY_GLOBALS, context)
  const call = runInContext(LEGACY_CALL, context) as (b: unknown, json: string) => { ok: boolean; value: string }
  const bundle = load(readFileSync(bundlePath, 'utf8'), bundlePath, null)
  return {
    render(dataJson) {
      const result = call(bundle, dataJson)
      if (!result.ok) throw new Error(result.value)
      return result.value
    },
  }
}

/** The runtime's module table as module → its export names, read in a bare context. */
export function runtimeModules(runtimeDir: string): Record<string, string[]> {
  const { context, load } = bareContext()
  const table = load(readFileSync(join(runtimeDir, 'server.cjs'), 'utf8'), 'server.cjs', null)
  const describe = runInContext(
    '(function (t) { const o = {}; for (const k of Object.keys(t)) o[k] = Object.keys(t[k]).sort(); return JSON.stringify(o) })',
    context,
  ) as (t: unknown) => string
  return JSON.parse(describe(table)) as Record<string, string[]>
}
