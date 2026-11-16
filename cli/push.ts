import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTemplate } from './build'
import { buildFormat2 } from './build-v2'
import { CommandError, stringFlag, type Flags } from './commands'
import { isFormat2, loadTemplate, type LoadedTemplate } from './template'
import { zip, type ZipEntry } from './zip'

/**
 * hct push — uploads a template's source as a new version of a marketplace
 * listing, after building it here so that a template that does not build
 * is never uploaded. A template without a package.json has nothing
 * installed to build with here, so it is uploaded as it is and the
 * platform's answer reported.
 *
 *   POST <api>/api/v1/developer/modules/<listing>/submissions
 *     multipart/form-data: archive (the source as a zip), tag, changelog
 *   POST <api>/api/v1/developer/modules/<listing>/submissions/<id>/preview
 *
 * Both carry `Authorization: Bearer <token>`, and `X-Organisation: <org>`
 * when an organisation is named.
 */

/** A version tag the platform accepts: three numbers. */
export const TAG = /^[0-9]+\.[0-9]+\.[0-9]+$/

/** Directories that are installs or outputs, never part of a template's source. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build'])

export interface PushConfig {
  api: string
  token: string
  listing: string
  org?: string
  tag: string
  changelog: string
}

/** One automated check the platform ran on the upload. */
export interface PlatformCheck {
  id: string
  title: string
  status: string
  detail: string
}

export interface Submission {
  id: string
  status: string
  checks: PlatformCheck[]
  build_log?: string
}

/**
 * The files of a template's source, by path relative to its root, sorted.
 * Names starting with a dot (.git, .env, editor files) are left out, as are
 * node_modules/, dist/ and build/.
 */
export async function sourceFiles(root: string, dir = root, prefix = ''): Promise<ZipEntry[]> {
  const out: ZipEntry[] = []
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (prefix === '' && SKIPPED_DIRECTORIES.has(entry.name)) continue
      if (entry.name === 'node_modules') continue
      out.push(...(await sourceFiles(root, join(dir, entry.name), path)))
    } else if (entry.isFile()) {
      out.push({ name: path, data: new Uint8Array(await readFile(join(dir, entry.name))) })
    }
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Builds the template into a temporary directory and throws if it does not build. */
async function buildOnce(template: LoadedTemplate): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'hct-push-'))
  try {
    if (isFormat2(template)) await buildFormat2(template, { outDir: join(scratch, 'dist'), localPaths: true })
    else await buildTemplate(template, { outDir: join(scratch, 'dist'), localPaths: true })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

interface ApiError {
  status: number
  code: string
  message: string
}

async function call(config: PushConfig, path: string, body: FormData | null): Promise<{ ok: true; attributes: Record<string, any>; id: string } | { ok: false; error: ApiError }> {
  const headers: Record<string, string> = { authorization: `Bearer ${config.token}`, accept: 'application/json' }
  if (config.org) headers['x-organisation'] = config.org
  if (body === null) headers['content-type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`${config.api.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: body ?? '{}',
    })
  } catch (e) {
    return { ok: false, error: { status: 0, code: 'unreachable', message: `could not reach ${config.api}: ${(e as Error).message}` } }
  }
  const text = await response.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // Not JSON: reported below with the status.
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        status: response.status,
        code: typeof json?.error?.code === 'string' ? json.error.code : '',
        message: typeof json?.error?.message === 'string' ? json.error.message : text.slice(0, 300) || response.statusText,
      },
    }
  }
  const resource = json?.data?.[0]
  if (!resource || typeof resource.attributes !== 'object') {
    return { ok: false, error: { status: response.status, code: 'unexpected_response', message: 'the platform answered without the expected data' } }
  }
  return { ok: true, attributes: resource.attributes as Record<string, any>, id: String(resource.id ?? '') }
}

function describeError(what: string, error: ApiError): string {
  const hint =
    error.status === 401
      ? ' Check HOSTCORE_TOKEN: it is missing, expired or not accepted.'
      : error.status === 403
        ? ' Your role in the organisation may not allow it; --org picks another organisation.'
        : error.status === 404
          ? ' Check the listing id, and --org if the listing belongs to another organisation.'
          : ''
  const message = hint && !/[.!?]$/.test(error.message) ? `${error.message}.` : error.message
  return `${what} failed${error.status ? ` (${error.status}${error.code ? ` ${error.code}` : ''})` : ''}: ${message}${hint}`
}

function readConfig(flags: Flags, version: string): PushConfig {
  const api = stringFlag(flags, 'api') ?? process.env.HOSTCORE_API_URL ?? ''
  const token = process.env.HOSTCORE_TOKEN ?? ''
  const listing = stringFlag(flags, 'listing') ?? process.env.HOSTCORE_LISTING ?? ''
  const org = stringFlag(flags, 'org') ?? process.env.HOSTCORE_ORG
  const tag = stringFlag(flags, 'tag') ?? version
  const missing = [
    api ? '' : '--api <url> or HOSTCORE_API_URL',
    token ? '' : 'HOSTCORE_TOKEN',
    listing ? '' : '--listing <id> or HOSTCORE_LISTING',
  ].filter(Boolean)
  if (missing.length > 0) throw new CommandError(`push needs ${missing.join(', ')}`)
  if (!/^https?:\/\//.test(api)) throw new CommandError(`the API URL must start with http:// or https://, got ${JSON.stringify(api)}`)
  if (!TAG.test(tag)) throw new CommandError(`the version tag must look like 1.2.3, got ${JSON.stringify(tag)}; set --tag or template.json's version`)
  return { api, token, listing, ...(org ? { org } : {}), tag, changelog: stringFlag(flags, 'changelog') ?? '' }
}

/** hct push [dir] --listing <id> [--tag <version>] [--changelog <text>] [--api <url>] [--org <id>] */
export async function pushCommand(root: string, flags: Flags): Promise<number> {
  const template = await loadTemplate(root)
  const config = readConfig(flags, template.manifest.version)

  if (await exists(join(root, 'package.json'))) {
    process.stdout.write(`building ${template.manifest.id}@${config.tag}…\n`)
    await buildOnce(template)
  } else {
    process.stdout.write(`${template.manifest.id}@${config.tag} has no package.json, so nothing is installed to build it with here; uploading it as it is\n`)
  }

  const files = await sourceFiles(root)
  const archive = zip(files)
  const form = new FormData()
  form.set('archive', new Blob([archive], { type: 'application/zip' }), `${template.manifest.id}-${config.tag}.zip`)
  form.set('tag', config.tag)
  form.set('changelog', config.changelog)
  process.stdout.write(`uploading ${files.length} files (${archive.byteLength} bytes) as ${config.tag}…\n`)

  const listingPath = `/api/v1/developer/modules/${encodeURIComponent(config.listing)}/submissions`
  const uploaded = await call(config, listingPath, form)
  if (!uploaded.ok) {
    process.stderr.write(`${describeError('the upload', uploaded.error)}\n`)
    return 1
  }
  const sub = uploaded.attributes as Submission
  const id = sub.id || uploaded.id
  process.stdout.write(`version ${config.tag} uploaded (submission ${id}): ${sub.status}\n`)

  const checks = Array.isArray(sub.checks) ? sub.checks : []
  if (checks.length > 0) {
    process.stdout.write('checks\n')
    for (const c of checks) process.stdout.write(`  ${String(c.status).padEnd(4)}  ${c.title}${c.detail ? `: ${c.detail}` : ''}\n`)
  }
  if (sub.status === 'build_failed') {
    process.stderr.write(`the platform could not build this version:\n${sub.build_log ?? ''}\n`)
    return 1
  }

  const preview = await call(config, `${listingPath}/${encodeURIComponent(id)}/preview`, null)
  if (preview.ok) {
    const until = typeof preview.attributes.expires_at === 'string' ? ` (until ${preview.attributes.expires_at})` : ''
    process.stdout.write(`preview: ${preview.attributes.url}${until}\n`)
  } else {
    process.stderr.write(`${describeError('the preview', preview.error)}\n`)
  }

  const failed = checks.filter((c) => c.status === 'fail')
  if (failed.length > 0) {
    process.stderr.write(`${failed.length} check(s) failed\n`)
    return 1
  }
  process.stdout.write(`next: submit ${config.tag} for review from your listing\n`)
  return 0
}
