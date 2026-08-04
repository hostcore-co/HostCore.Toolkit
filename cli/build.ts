import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { InlineConfig, PluginOption } from 'vite'
import { digest, signManifest, type BundleManifest } from './manifest'
import type { LoadedTemplate } from './template'
import { formatFindings, validateTemplate } from './validate'

/** Prefix the engine serves a built-in template's own assets from. */
export const ENGINE_ASSET_PREFIX = '/_hc/assets/'

export interface BuildOptions {
  /** Where the built artefacts go. Defaults to <root>/dist. */
  outDir?: string
  /**
   * Base URL the client bundle and CSS are served from. Required unless
   * `localPaths` is set, and taken from $CDN_BASE_URL by the CLI.
   */
  cdnBaseUrl?: string
  /**
   * Build for a template the engine serves itself.
   *
   * Built-in templates ship inside the engine image, so their assets are
   * addressed at an engine-local path rather than on a CDN — there is no
   * upload step and nothing to point them at.
   */
  localPaths?: boolean
  /** Raw base64 ed25519 key. Omitted produces an unsigned build. */
  signingKey?: string
  /** Skip the policy check. Only for iterating locally. */
  skipValidation?: boolean
}

export interface BuildResult {
  manifest: BundleManifest
  outDir: string
}

export class BuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildError'
  }
}

/**
 * Builds a template into the two artefacts the platform serves.
 *
 *   server/entry.server.cjs — loaded by the engine's render workers.
 *     Everything is inlined, because the sandbox has no module loader:
 *     a bundle that still contains a require() fails at render time.
 *
 *   client/*.js + client/*.css — served to browsers from the CDN and
 *     referenced by the manifest.
 *
 * Validation runs first and a failure stops the build. The point of the
 * policy is that unvetted code never reaches a bundle, so building it
 * "just to see" would defeat it.
 */
export async function buildTemplate(
  template: LoadedTemplate,
  options: BuildOptions,
): Promise<BuildResult> {
  if (!options.skipValidation) {
    const result = await validateTemplate(template)
    if (result.findings.length > 0) {
      throw new BuildError(
        `template failed policy validation\n\n${formatFindings(result)}`,
      )
    }
  }

  const outDir = resolve(options.outDir ?? join(template.root, 'dist'))
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const vite = await loadVite(template.root)

  await vite.build(await serverConfig(template, outDir))
  await vite.build(await clientConfig(template, outDir))

  const manifest = await writeManifest(template, outDir, options)
  return { manifest, outDir }
}

/**
 * Resolves Vite from the template rather than from the CLI, so a
 * template builds against the toolchain version it declares instead of
 * whatever the CLI happens to be installed with.
 */
async function loadVite(root: string): Promise<typeof import('vite')> {
  const require = createRequire(join(root, 'package.json'))
  // Prefer the ESM entry: require.resolve picks the CJS build, which
  // Vite has deprecated and which prints a warning on every build.
  const candidates = ['vite/dist/node/index.js', 'vite']

  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate)
      return (await import(pathToFileURL(resolved).href)) as typeof import('vite')
    } catch {
      continue
    }
  }

  throw new BuildError(
    `could not load vite from ${root}. Run the template's install first.`,
  )
}

function sharedConfig(template: LoadedTemplate): InlineConfig {
  return {
    root: template.root,
    configFile: false,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@': join(template.root, 'src'),
        '@template': join(template.root, 'src'),
      },
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  }
}

/**
 * The SSR build.
 *
 * `ssr.noExternal: true` is what makes the output self-contained. Vite
 * would otherwise leave react as an external require, which the render
 * sandbox cannot satisfy.
 */
async function serverConfig(
  template: LoadedTemplate,
  outDir: string,
): Promise<InlineConfig> {
  return {
    ...sharedConfig(template),
    plugins: await plugins(template.root),
    // 'webworker' rather than 'node' so react-dom resolves to its
    // builtin-free server build. The render sandbox has no node
    // builtins, so a bundle that reached for `util` could not run.
    ssr: { noExternal: true, target: 'webworker' },
    build: {
      outDir: join(outDir, 'server'),
      emptyOutDir: true,
      ssr: true,
      minify: false,
      // Keep CSS out of the SSR bundle — the client build emits it, and
      // the engine links it from the CDN.
      cssCodeSplit: false,
      lib: {
        entry: entryPath(template.root, 'entry.server'),
        formats: ['cjs'],
        fileName: () => 'entry.server.cjs',
      },
      rollupOptions: { external: [] },
    },
  }
}

async function clientConfig(
  template: LoadedTemplate,
  outDir: string,
): Promise<InlineConfig> {
  return {
    ...sharedConfig(template),
    plugins: await plugins(template.root),
    build: {
      outDir: join(outDir, 'client'),
      emptyOutDir: true,
      manifest: false,
      minify: 'esbuild',
      cssCodeSplit: false,
      rollupOptions: {
        input: entryPath(template.root, 'entry.client'),
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

/**
 * The SDK's entrypoints are locked files: the build always uses the
 * SDK's copies, never a template-supplied override, so a template
 * cannot replace the code that wraps its App in the engine's context.
 */
function entryPath(root: string, entry: 'entry.server' | 'entry.client'): string {
  const require = createRequire(join(root, 'package.json'))
  try {
    return require.resolve(`@hostcore/toolkit/${entry}`)
  } catch (e) {
    throw new BuildError(
      `could not resolve @hostcore/toolkit/${entry}: ${(e as Error).message}`,
    )
  }
}

/** The plugin set both builds share, resolved from the template. */
async function plugins(root: string): Promise<PluginOption[]> {
  return [
    await loadPlugin(root, '@vitejs/plugin-react'),
    await loadPlugin(root, '@tailwindcss/vite', true),
  ]
}

/**
 * Loads a build plugin from the template's own dependencies.
 *
 * Imported rather than required so the plugin pulls in Vite's ESM
 * build; the CJS entry is deprecated and warns on every build.
 * Optional plugins a template doesn't declare are skipped rather than
 * failing the build — not every template uses Tailwind.
 */
async function loadPlugin(
  root: string,
  name: string,
  optional = false,
): Promise<PluginOption> {
  const require = createRequire(join(root, 'package.json'))
  try {
    const resolved = pathToFileURL(require.resolve(name)).href
    const mod = (await import(resolved)) as {
      default?: () => PluginOption
    }
    const factory = mod.default
    if (typeof factory !== 'function') {
      throw new Error('module does not export a plugin factory')
    }
    return factory()
  } catch (e) {
    if (optional) return []
    throw new BuildError(
      `could not load ${name} from ${root}: ${(e as Error).message}`,
    )
  }
}

async function writeManifest(
  template: LoadedTemplate,
  outDir: string,
  options: BuildOptions,
): Promise<BundleManifest> {
  const serverBundle = await readFile(join(outDir, 'server', 'entry.server.cjs'))
  assertSelfContained(serverBundle.toString('utf8'))

  const clientDir = join(outDir, 'client')
  const files = await readdir(clientDir)

  const clientJs = files.find((f) => f.startsWith('entry.client.') && f.endsWith('.js'))
  const css = files.find((f) => f.endsWith('.css'))

  if (!clientJs) throw new BuildError('client build produced no entry bundle')
  if (!css) throw new BuildError('client build produced no stylesheet')

  const clientBytes = await readFile(join(clientDir, clientJs))
  const cssBytes = await readFile(join(clientDir, css))

  let base: string
  if (options.localPaths) {
    base = ENGINE_ASSET_PREFIX.replace(/\/$/, '')
  } else {
    if (!options.cdnBaseUrl) {
      throw new BuildError(
        'a build for object storage needs a CDN base URL; pass --local-paths for a template the engine serves itself',
      )
    }
    base = `${options.cdnBaseUrl.replace(/\/$/, '')}/templates/${template.manifest.id}/${template.manifest.version}/client`
  }

  let manifest: BundleManifest = {
    template_id: template.manifest.id,
    version: template.manifest.version,
    built_at: new Date().toISOString(),
    integrity: {
      server_bundle: digest(serverBundle),
      client_bundle: digest(clientBytes),
      css_bundle: digest(cssBytes),
    },
    cdn_paths: {
      client_js: `${base}/${clientJs}`,
      css: `${base}/${css}`,
    },
  }

  if (options.signingKey) {
    manifest = signManifest(manifest, options.signingKey)
  }

  await writeFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  return manifest
}

/**
 * The render sandbox has no module loader, so a server bundle that still
 * calls require() would throw on its first render. Catching it here
 * turns a production failure into a build failure.
 */
function assertSelfContained(source: string): void {
  const match = /(^|[^.\w])require\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(source)
  if (match) {
    throw new BuildError(
      `server bundle is not self-contained: it still requires "${match[2]}". ` +
        'Every dependency must be inlined for the render sandbox.',
    )
  }
}
