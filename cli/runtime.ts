import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { InlineConfig, Plugin } from 'vite'
import { loadVite } from './build'
import { Inventory, renderedModules } from './inventory'
import { canonicalJson, fileEntry, signManifest, type FileEntry, type InventoryEntry } from './manifest'
import { RUNTIME_CLIENT_MODULES } from './policy'
import { REACT_MAJOR, TOOLCHAIN, type Toolchain, MIN_VITE_MAJOR } from './toolchain'

/**
 * The runtime: one shared copy of React for every format-2 build.
 *
 *   server.cjs                CommonJS; module.exports maps "react",
 *                             "react/jsx-runtime" and "react-dom/server" to
 *                             their exports. The server renderer is the one
 *                             renderToString needs and nothing else.
 *   client/react.js           ES modules the browser imports through an
 *   client/react-jsx-runtime.js   import map, one per bare specifier a
 *   client/react-dom.js           template's client bundle uses
 *   client/react-dom-client.js
 *   client/chunk.<hash>.js    code the four share
 *   runtime.json              runtime_id, toolchain, files, inventory
 *
 * Built from the React installed where it is built, with the Vite installed
 * there, so the same lockfile always gives the same bytes and the same id.
 */

export interface RuntimeJson {
  runtime_id: string
  toolchain: Toolchain
  files: Record<string, FileEntry>
  inventory: InventoryEntry[]
  signature?: string
}

export interface BuiltRuntime {
  json: RuntimeJson
  /** File contents by path relative to the runtime directory, runtime.json excluded. */
  files: Record<string, Uint8Array>
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeError'
  }
}

/** Client file name of each bare specifier. */
export const RUNTIME_CLIENT_FILES: Record<string, string> = {
  react: 'client/react.js',
  'react/jsx-runtime': 'client/react-jsx-runtime.js',
  'react-dom': 'client/react-dom.js',
  'react-dom/client': 'client/react-dom-client.js',
}

/**
 * The runtime's id: the sha256 of the canonical JSON of its `files` map
 * (path → { integrity, bytes }), so it changes exactly when a file does.
 */
export function runtimeId(files: Record<string, FileEntry>): string {
  return new Bun.CryptoHasher('sha256').update(canonicalJson(files)).digest('hex')
}

/** The React version installed for `root`, which a runtime built there contains. */
export function reactVersion(root: string): string {
  const require = createRequire(join(root, 'package.json'))
  let version: string
  try {
    version = (require('react/package.json') as { version: string }).version
  } catch {
    throw new RuntimeError(`react is not installed for ${root}. Install react@${REACT_MAJOR} first.`)
  }
  if (Number.parseInt(version, 10) !== REACT_MAJOR) {
    throw new RuntimeError(`toolchain ${TOOLCHAIN.line} needs react ${REACT_MAJOR}.x, found ${version}`)
  }
  return version
}

export async function loadViteForFormat2(root: string): Promise<typeof import('vite')> {
  const vite = await loadVite(root)
  const major = Number.parseInt(vite.version, 10)
  if (!(major >= MIN_VITE_MAJOR)) {
    throw new RuntimeError(
      `format-2 templates build with vite ${MIN_VITE_MAJOR} or newer; ${root} has vite ${vite.version}`,
    )
  }
  return vite
}

const VIRTUAL = '\0hc-runtime:'

/** Export names of a CommonJS module, read by loading its production build. */
function exportNames(require: NodeJS.Require, file: string): string[] {
  const mod = require(file) as Record<string, unknown>
  return Object.keys(mod)
    .filter((k) => k !== 'default' && k !== '__esModule' && /^[A-Za-z_$][\w$]*$/.test(k))
    .sort()
}

function virtualEntries(sources: Record<string, string>): Plugin {
  return {
    name: 'hostcore:runtime-entries',
    resolveId(id) {
      return id.startsWith(VIRTUAL) ? id : null
    },
    load(id) {
      return id.startsWith(VIRTUAL) ? sources[id.slice(VIRTUAL.length)] ?? null : null
    },
  }
}

function collect(inventory: Inventory): Plugin {
  return {
    name: 'hostcore:runtime-inventory',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of renderedModules(output)) inventory.add(id, 'runtime')
      }
    },
  }
}

type OutputChunkLike = { type: 'chunk'; fileName: string; code: string } | { type: 'asset'; fileName: string; source: string | Uint8Array }

function outputsOf(result: unknown): OutputChunkLike[] {
  const list = Array.isArray(result) ? result : [result]
  return list.flatMap((r) => (r as { output: OutputChunkLike[] }).output)
}

/** Builds the runtime in memory. */
export async function buildRuntime(rootDir: string, signingKey?: string): Promise<BuiltRuntime> {
  const root = resolve(rootDir)
  reactVersion(root)
  // Vite chooses production builds from NODE_ENV, and only sets it when unset.
  process.env.NODE_ENV = 'production'
  const vite = await loadViteForFormat2(root)
  const require = createRequire(join(root, 'package.json'))
  const reactDir = dirname(require.resolve('react/package.json'))
  const reactDomDir = dirname(require.resolve('react-dom/package.json'))
  const legacyServer = join(reactDomDir, 'cjs/react-dom-server-legacy.browser.production.js')
  const inventory = new Inventory(null)

  const base = (plugins: Plugin[]): InlineConfig => ({
    root,
    configFile: false,
    envDir: false,
    logLevel: 'warn',
    mode: 'production',
    publicDir: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [...plugins, collect(inventory)],
  })

  // The server table. The renderer is react-dom's legacy browser build: the
  // renderToString one, with no streams and no Node built-ins.
  const serverSource = [
    'module.exports = {',
    `  "react": require("react"),`,
    `  "react/jsx-runtime": require("react/jsx-runtime"),`,
    `  "react-dom/server": require(${JSON.stringify(legacyServer)}),`,
    '}',
  ].join('\n')
  const server = outputsOf(
    await vite.build({
      ...base([virtualEntries({ server: serverSource })]),
      build: {
        write: false,
        minify: true,
        emptyOutDir: false,
        modulePreload: false,
        rolldownOptions: {
          input: { server: `${VIRTUAL}server` },
          output: { format: 'cjs', entryFileNames: 'server.cjs' },
        },
      },
    }),
  )

  const clientSources: Record<string, string> = {}
  const productionFile: Record<string, string> = {
    react: join(reactDir, 'cjs/react.production.js'),
    'react/jsx-runtime': join(reactDir, 'cjs/react-jsx-runtime.production.js'),
    'react-dom': join(reactDomDir, 'cjs/react-dom.production.js'),
    'react-dom/client': join(reactDomDir, 'cjs/react-dom-client.production.js'),
  }
  for (const specifier of RUNTIME_CLIENT_MODULES) {
    const names = exportNames(require, productionFile[specifier]!)
    clientSources[specifier] = [
      `import m from ${JSON.stringify(specifier)}`,
      'export default m',
      ...(names.length > 0 ? [`export const { ${names.join(', ')} } = m`] : []),
    ].join('\n')
  }
  const input = Object.fromEntries(
    RUNTIME_CLIENT_MODULES.map((s) => [RUNTIME_CLIENT_FILES[s]!.replace(/^client\//, '').replace(/\.js$/, ''), `${VIRTUAL}${s}`]),
  )
  const client = outputsOf(
    await vite.build({
      ...base([virtualEntries(clientSources)]),
      build: {
        write: false,
        minify: true,
        emptyOutDir: false,
        modulePreload: false,
        rolldownOptions: {
          input,
          preserveEntrySignatures: 'strict',
          output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunk.[hash].js' },
        },
      },
    }),
  )

  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  for (const out of server) {
    if (out.type === 'chunk') files[out.fileName] = encoder.encode(out.code)
  }
  for (const out of client) {
    if (out.type === 'chunk') files[`client/${out.fileName}`] = encoder.encode(out.code)
  }
  checkRuntime(files)

  const entries: Record<string, FileEntry> = {}
  for (const path of Object.keys(files).sort()) entries[path] = fileEntry(files[path]!)
  let json: RuntimeJson = {
    runtime_id: runtimeId(entries),
    toolchain: { ...TOOLCHAIN },
    files: entries,
    inventory: inventory.entries(),
  }
  if (signingKey) json = signManifest(json, signingKey)
  return { json, files }
}

/** A runtime that is not exactly the documented files would leave a page without React. */
function checkRuntime(files: Record<string, Uint8Array>): void {
  const expected = new Set(['server.cjs', ...Object.values(RUNTIME_CLIENT_FILES)])
  const unexpected = Object.keys(files).filter((n) => !expected.has(n) && !/^client\/chunk\.[\w-]+\.js$/.test(n))
  if (unexpected.length > 0) {
    throw new RuntimeError(`the runtime build produced unexpected files: ${unexpected.sort().join(', ')}`)
  }
  for (const path of ['server.cjs', ...Object.values(RUNTIME_CLIENT_FILES)]) {
    if (!files[path]) throw new RuntimeError(`the runtime build produced no ${path}`)
  }
  const server = new TextDecoder().decode(files['server.cjs'])
  const required = [...server.matchAll(/(?:^|[^.\w$])require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1])
  if (required.length > 0) {
    throw new RuntimeError(`the runtime's server.cjs still requires ${required.join(', ')}`)
  }
}

/** Writes a built runtime to `outDir`, replacing what was there. */
export async function writeRuntime(runtime: BuiltRuntime, outDir: string): Promise<void> {
  await rm(outDir, { recursive: true, force: true })
  for (const [path, bytes] of Object.entries(runtime.files)) {
    const target = join(outDir, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await writeFile(join(outDir, 'runtime.json'), `${JSON.stringify(runtime.json, null, 2)}\n`)
}

/** Reads a runtime written by `hct runtime build`. */
export async function readRuntime(dir: string): Promise<RuntimeJson> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'runtime.json'), 'utf8')
  } catch {
    throw new RuntimeError(`no runtime.json in ${dir}; run hct runtime build --out ${dir}`)
  }
  const json = JSON.parse(raw) as RuntimeJson
  if (typeof json.runtime_id !== 'string' || typeof json.files !== 'object' || !Array.isArray(json.inventory)) {
    throw new RuntimeError(`${join(dir, 'runtime.json')} is not a runtime description`)
  }
  return json
}
