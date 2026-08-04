import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Contents of a template's template.json. */
export interface TemplateManifest {
  id: string
  version: string
  name: string
  /**
   * Runtime dependencies this template uses. Must be a subset of the
   * platform allowlist — see policy.ts.
   */
  allowedPackages: string[]
}

export interface TemplatePackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface LoadedTemplate {
  root: string
  manifest: TemplateManifest
  pkg: TemplatePackageJson
}

const TEMPLATE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const TEMPLATE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

/**
 * Reads and checks a template's metadata.
 *
 * The id and version are validated to exactly the shape the engine
 * accepts, so a template that would be unloadable in production fails
 * here instead of at first request.
 */
export async function loadTemplate(root: string): Promise<LoadedTemplate> {
  const manifest = await readJson<TemplateManifest>(
    join(root, 'template.json'),
    'template.json',
  )
  const pkg = await readJson<TemplatePackageJson>(
    join(root, 'package.json'),
    'package.json',
  )

  if (typeof manifest.id !== 'string' || !TEMPLATE_ID.test(manifest.id)) {
    throw new TemplateError(
      `template.json: id must be lowercase alphanumeric with dashes, got ${JSON.stringify(manifest.id)}`,
    )
  }
  if (
    typeof manifest.version !== 'string' ||
    !TEMPLATE_VERSION.test(manifest.version)
  ) {
    throw new TemplateError(
      `template.json: version must be semver, got ${JSON.stringify(manifest.version)}`,
    )
  }
  if (!Array.isArray(manifest.allowedPackages)) {
    throw new TemplateError('template.json: allowedPackages must be an array')
  }

  return { root, manifest, pkg }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new TemplateError(`${label} not found at ${path}`)
  }
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    throw new TemplateError(`${label} is not valid JSON: ${(e as Error).message}`)
  }
}
