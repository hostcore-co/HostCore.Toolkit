import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InlineConfig, Plugin, PluginOption } from 'vite'
import { BuildError, loadPlugin } from './build'
import { Inventory, renderedModules } from './inventory'
import { buildId, fileEntry, signManifest, type FileEntry, type ManifestV2 } from './manifest'
import { CLIENT_ONLY_PACKAGES, RUNTIME_CLIENT_MODULES, RUNTIME_SERVER_MODULES } from './policy'
import { buildRuntime, loadViteForFormat2, reactVersion, readRuntime, type RuntimeJson } from './runtime'
import { discoverSources, type TemplateSources } from './sources'
import { isClientOnly, serverStub } from './stubs'
import type { LoadedTemplate, TemplateManifestV2 } from './template'
import { TOOLCHAIN } from './toolchain'
import { formatBuiltStylesheetFindings, formatFindings, scanBuiltStylesheets, validateTemplate } from './validate'

/**
 * Builds a format-2 template (bundle protocol 2):
 *
 *   dist/manifest.json
 *   dist/server/entry.server.cjs        minified CommonJS; requires only the
 *                                       runtime's react, react/jsx-runtime
 *                                       and react-dom/server
 *   dist/client/entry.client.<hash>.js  ES module; loads the current page's
 *   dist/client/chunk.<hash>.js         chunk (one per page, layout and island)
 *   dist/client/assets.<hash>.css       every stylesheet, with relative URLs
 *   dist/client/**                      the files in public/
 *
 * The entries are generated from the files the template has (see
 * sources.ts) and wrap them in the toolkit's own server and client code, so
 * every template renders and hydrates the same way.
 *
 * A build whose stylesheet loads anything from another site fails (see
 * stylesheet.ts), so the stylesheet of every build that has a manifest
 * stays on the store's own origin.
 */

export interface BuildV2Options {
  outDir?: string
  /** Where the client files will be served from; recorded as media_base. */
  mediaBase?: string
  /** A local build: media_base is left empty. */
  localPaths?: boolean
  signingKey?: string
  skipValidation?: boolean
  /** A directory written by `hct runtime build` to build against, instead of building the runtime here. */
  runtimeDir?: string
  /**
   * The revision of the toolchain line the build environment provides,
   * recorded in the manifest's toolchain (default: TOOLCHAIN.revision).
   */
  toolchainRevision?: number
}

export interface BuildV2Result {
  manifest: ManifestV2
  outDir: string
}

type Format2Template = LoadedTemplate & { manifest: TemplateManifestV2 }

const TOOLKIT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SDK_INDEX = join(TOOLKIT_ROOT, 'src', 'index.ts')
const SDK_SERVER = join(TOOLKIT_ROOT, 'src', 'v2', 'server.ts')
const SDK_CLIENT = join(TOOLKIT_ROOT, 'src', 'v2', 'client.ts')
const SDK_ISLAND = join(TOOLKIT_ROOT, 'src', 'v2', 'island.ts')

/** A file path as the bundler writes module ids and specifiers: "/" between its parts on every platform. */
const slashed = (path: string) => path.split(sep).join('/')

const SERVER_ENTRY = '\0hc:entry.server'
const CLIENT_ENTRY = '\0hc:entry.client'
const ISLAND_PREFIX = '\0hc:island:'
const STUB_PREFIX = '\0hc:server-stub:'

export async function buildFormat2(template: Format2Template, options: BuildV2Options): Promise<BuildV2Result> {
  if (!options.localPaths && !options.mediaBase) {
    throw new BuildError('a format-2 build needs --media-base <url>, or --local-paths for a local build')
  }
  if (!options.skipValidation) {
    const result = await validateTemplate(template)
    if (result.findings.length > 0) {
      throw new BuildError(`template failed policy validation\n\n${formatFindings(result)}`)
    }
  }
  const { sources } = await discoverSources(template.root)
  // Vite and its plugins choose production React (the jsx-runtime rather
  // than jsx-dev-runtime) from NODE_ENV, and only set it when it is unset.
  process.env.NODE_ENV = 'production'

  const outDir = resolve(options.outDir ?? join(template.root, 'dist'))
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const runtime = await runtimeFor(template.root, options.runtimeDir)
  const vite = await loadViteForFormat2(template.root)
  const collected: Collected = { inventory: new Inventory(template.root), externals: new Map() }
  collected.inventory.merge(runtime.inventory)

  const defaults = Object.fromEntries(
    template.manifest.settings.filter((s) => s.default !== undefined).map((s) => [s.id, s.default]),
  )

  await vite.build(await serverConfig(template, sources, defaults, outDir, collected))
  await vite.build(await clientConfig(template, sources, defaults, outDir, collected))

  const manifest = await writeManifest(template, sources, outDir, runtime, collected, options)
  return { manifest, outDir }
}

async function runtimeFor(root: string, runtimeDir: string | undefined): Promise<RuntimeJson> {
  const installed = reactVersion(root)
  const runtime = runtimeDir ? await readRuntime(resolve(runtimeDir)) : (await buildRuntime(root)).json
  const react = runtime.inventory.find((p) => p.name === 'react')
  if (react?.version !== installed) {
    throw new BuildError(
      `the runtime contains react ${react?.version ?? '(none)'} but the template has react ${installed} installed; build them with the same toolchain`,
    )
  }
  if (runtime.toolchain.line !== TOOLCHAIN.line) {
    throw new BuildError(`the runtime is for toolchain ${runtime.toolchain.line}, not ${TOOLCHAIN.line}`)
  }
  return runtime
}

function sharedConfig(template: Format2Template): InlineConfig {
  const src = slashed(join(template.root, 'src'))
  return {
    root: template.root,
    configFile: false,
    envDir: false,
    logLevel: 'warn',
    mode: 'production',
    resolve: {
      alias: [
        // The SDK a template imports is the one this build wraps it with, so
        // the page context the entries provide is the one the hooks read.
        { find: /^@hostcore\/toolkit$/, replacement: slashed(SDK_INDEX) },
        { find: /^@template(?=\/|$)/, replacement: src },
        { find: /^@(?=\/)/, replacement: src },
      ],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    oxc: { jsx: { runtime: 'automatic', importSource: 'react', development: false } },
  }
}

/** The template's own build plugins: React and, when it uses it, Tailwind. */
async function templatePlugins(root: string): Promise<PluginOption[]> {
  return [await loadPlugin(root, '@vitejs/plugin-react', true), await loadPlugin(root, '@tailwindcss/vite', true)]
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

/** A file path as a module specifier in generated code. */
function specifier(path: string): string {
  return json(slashed(path))
}

function serverEntry(sources: TemplateSources, defaults: Record<string, unknown>): string {
  const lines = [`import { createServer } from ${specifier(SDK_SERVER)}`]
  if (sources.layout) lines.push(`import * as layout from ${specifier(sources.layout)}`)
  const pages = Object.entries(sources.pages)
  pages.forEach(([, path], i) => lines.push(`import * as page${i} from ${specifier(path)}`))
  lines.push(
    'const server = createServer({',
    `  layout: ${sources.layout ? 'layout' : 'null'},`,
    `  pages: { ${pages.map(([id], i) => `${json(id)}: page${i}`).join(', ')} },`,
    `  defaults: ${json(defaults)},`,
    '})',
    'export const protocol = 2',
    'export const pages = server.pages',
    'export const layouts = server.layouts',
    'export const render = server.render',
  )
  return lines.join('\n')
}

function clientEntry(sources: TemplateSources, defaults: Record<string, unknown>): string {
  const loaders = (map: Record<string, string>) =>
    `{ ${Object.entries(map).map(([id, path]) => `${json(id)}: () => import(${specifier(path)})`).join(', ')} }`
  const islandPages = Object.entries(sources.hydrate)
    .filter(([, mode]) => mode === 'islands')
    .map(([id]) => id)
  return [
    `import { createClient } from ${specifier(SDK_CLIENT)}`,
    'const client = createClient({',
    `  layout: ${sources.layout ? `() => import(${specifier(sources.layout)})` : 'null'},`,
    `  pages: ${loaders(sources.pages)},`,
    `  islands: ${loaders(sources.islands)},`,
    `  islandPages: ${json(islandPages)},`,
    `  defaults: ${json(defaults)},`,
    '})',
    'export const mount = client.mount',
    'const g = globalThis.__HC__',
    'if (!(g && g.defer === true)) client.mount()',
  ].join('\n')
}

/**
 * Generates the entries, names islands, and — in the server build — swaps
 * client-only packages for their inert stand-ins.
 */
function format2Plugin(
  side: 'server' | 'client',
  sources: TemplateSources,
  defaults: Record<string, unknown>,
): Plugin {
  const islandByPath = new Map(Object.entries(sources.islands).map(([name, path]) => [slashed(path), name]))
  return {
    name: `hostcore:format2-${side}`,
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === SERVER_ENTRY || source === CLIENT_ENTRY) return source
      if (side === 'server' && isClientOnly(source)) return `${STUB_PREFIX}${source}`
      if (importer?.startsWith(ISLAND_PREFIX)) return null
      if (islandByPath.size === 0) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      const name = resolved ? islandByPath.get(slashed(resolved.id.split('?')[0]!)) : undefined
      return name ? `${ISLAND_PREFIX}${name}` : resolved
    },
    load(id) {
      if (id === SERVER_ENTRY) return serverEntry(sources, defaults)
      if (id === CLIENT_ENTRY) return clientEntry(sources, defaults)
      if (id.startsWith(STUB_PREFIX)) return serverStub(id.slice(STUB_PREFIX.length))
      if (id.startsWith(ISLAND_PREFIX)) {
        const name = id.slice(ISLAND_PREFIX.length)
        const path = sources.islands[name]!
        return [
          `import Component from ${specifier(path)}`,
          `import { nameIsland } from ${specifier(SDK_ISLAND)}`,
          `export * from ${specifier(path)}`,
          `export default nameIsland(Component, ${json(name)})`,
        ].join('\n')
      }
      return null
    },
  }
}

/** What the bundler put in a build, and what it left for the page to provide. */
interface Collected {
  inventory: Inventory
  /** Modules each output file imports from outside the build, by file name. */
  externals: Map<string, string[]>
}

function collect(collected: Collected, where: 'server' | 'client'): Plugin {
  return {
    name: `hostcore:inventory-${where}`,
    generateBundle(_options, bundle) {
      const own = new Set(Object.keys(bundle))
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of renderedModules(output)) collected.inventory.add(id, where)
        const imports = [...output.imports, ...output.dynamicImports].filter((i) => !own.has(i))
        collected.externals.set(`${where}/${output.fileName}`, [...new Set(imports)].sort())
      }
    },
  }
}

const isServerRuntime = (id: string) => RUNTIME_SERVER_MODULES.includes(id)
const isClientRuntime = (id: string) => RUNTIME_CLIENT_MODULES.includes(id)

async function serverConfig(
  template: Format2Template,
  sources: TemplateSources,
  defaults: Record<string, unknown>,
  outDir: string,
  collected: Collected,
): Promise<InlineConfig> {
  return {
    ...sharedConfig(template),
    // Read so that url()s to public files resolve, never copied: the
    // client build ships them.
    publicDir: join(template.root, 'public'),
    plugins: [format2Plugin('server', sources, defaults), ...(await templatePlugins(template.root)), collect(collected, 'server')],
    // 'webworker' resolves packages to their builds that use no Node
    // built-ins: the render sandbox has none.
    ssr: { noExternal: true, external: [...RUNTIME_SERVER_MODULES], target: 'webworker' },
    build: {
      outDir: join(outDir, 'server'),
      emptyOutDir: false,
      ssr: true,
      minify: true,
      copyPublicDir: false,
      rolldownOptions: {
        input: { 'entry.server': SERVER_ENTRY },
        external: isServerRuntime,
        output: { format: 'cjs', entryFileNames: 'entry.server.cjs', codeSplitting: false },
      },
    },
  }
}

async function clientConfig(
  template: Format2Template,
  sources: TemplateSources,
  defaults: Record<string, unknown>,
  outDir: string,
  collected: Collected,
): Promise<InlineConfig> {
  return {
    ...sharedConfig(template),
    // Every URL the client build writes is relative to the file it is in,
    // so the build works from whatever base it is served under.
    base: './',
    publicDir: join(template.root, 'public'),
    plugins: [format2Plugin('client', sources, defaults), ...(await templatePlugins(template.root)), collect(collected, 'client')],
    build: {
      outDir: join(outDir, 'client'),
      emptyOutDir: false,
      manifest: false,
      minify: true,
      cssCodeSplit: false,
      copyPublicDir: true,
      rolldownOptions: {
        input: { 'entry.client': CLIENT_ENTRY },
        external: isClientRuntime,
        preserveEntrySignatures: 'strict',
        output: {
          format: 'es',
          entryFileNames: 'entry.client.[hash].js',
          chunkFileNames: 'chunk.[hash].js',
          assetFileNames: 'assets.[hash][extname]',
        },
      },
    },
  }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)))
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join('/'))
  }
  return out.sort()
}

/**
 * A build may only leave the runtime modules for the page to provide: an
 * import of anything else would fail where the bundle runs, so it fails the
 * build here instead.
 */
function checkOutputs(files: string[], collected: Collected): void {
  if (!files.includes('server/entry.server.cjs')) throw new BuildError('the server build produced no entry.server.cjs')
  for (const [file, externals] of collected.externals) {
    const server = file.startsWith('server/')
    const bad = externals.filter((m) => !(server ? isServerRuntime(m) : isClientRuntime(m)))
    if (bad.length === 0) continue
    throw new BuildError(
      server
        ? `the server bundle still requires ${bad.map((s) => `"${s}"`).join(', ')}. ` +
            `A server bundle may only require ${RUNTIME_SERVER_MODULES.join(', ')}; everything else must be bundled.`
        : `${file} imports ${bad.map((s) => `"${s}"`).join(', ')}, which nothing provides in the browser. ` +
            `A client bundle may only import its own chunks and ${RUNTIME_CLIENT_MODULES.join(', ')}.`,
    )
  }
  const leaked = collected.inventory.entries().filter((p) => p.in.includes('server') && CLIENT_ONLY_PACKAGES.includes(p.name))
  if (leaked.length > 0) {
    throw new BuildError(`client-only packages reached the server bundle: ${leaked.map((p) => p.name).join(', ')}`)
  }
}

async function writeManifest(
  template: Format2Template,
  sources: TemplateSources,
  outDir: string,
  runtime: RuntimeJson,
  collected: Collected,
  options: BuildV2Options,
): Promise<ManifestV2> {
  const paths = await listFiles(outDir)
  checkOutputs(paths, collected)
  const stylesheet = await scanBuiltStylesheets(outDir)
  if (stylesheet.length > 0) throw new BuildError(formatBuiltStylesheetFindings(stylesheet))

  const files: Record<string, FileEntry> = {}
  for (const path of paths) files[path] = fileEntry(await readFile(join(outDir, path)))

  const clientJs = paths.filter((p) => /^client\/entry\.client\.[\w-]+\.js$/.test(p))
  const css = paths.filter((p) => /^client\/assets\.[\w-]+\.css$/.test(p))
  if (clientJs.length !== 1) throw new BuildError(`the client build produced ${clientJs.length} entry files, not one`)
  if (css.length > 1) throw new BuildError(`the client build produced ${css.length} stylesheets, not one`)

  const m = template.manifest
  const body: Omit<ManifestV2, 'build_id'> = {
    manifest_version: 2,
    template_id: m.id,
    version: m.version,
    built_at: new Date().toISOString(),
    protocol: 2,
    contract: m.contract,
    toolchain: { line: TOOLCHAIN.line, revision: options.toolchainRevision ?? TOOLCHAIN.revision },
    runtime: { id: runtime.runtime_id },
    entry: { server: 'server/entry.server.cjs', client_js: clientJs[0]!, css: css[0] ?? '' },
    files,
    pages: Object.keys(sources.pages),
    layouts: sources.layout ? ['default', 'minimal'] : [],
    islands: Object.keys(sources.islands).sort(),
    tokens: m.tokens,
    settings: m.settings,
    inventory: collected.inventory.entries(),
    media_base: options.localPaths ? '' : (options.mediaBase ?? ''),
  }
  const { manifest_version, ...rest } = body
  let manifest: ManifestV2 = { manifest_version, build_id: buildId(body), ...rest }
  if (options.signingKey) manifest = signManifest(manifest, options.signingKey)
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}
