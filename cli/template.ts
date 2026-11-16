import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateSettingSchema, type SettingSchemaEntry } from '../contract/src/settings'
import { validateTokens } from '../contract/src/tokens'
import { CONTRACTS } from '../contract/src/validate'
import { TOOLCHAIN } from './toolchain'

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
  /**
   * The source format. Absent or 1: one App component, built as today
   * (bundle protocol 1, contract "1"). 2: a layout and one file per page
   * (bundle protocol 2).
   */
  format?: 1 | 2
  /** The page contract the template is written against. Format 2 only. */
  contract?: string
  /** The toolchain line the template builds with. Format 2 only. */
  toolchain?: number
  /** Design token values, by token name. Format 2 only. */
  tokens?: Record<string, string>
  /** The settings a store can edit for this template. Format 2 only. */
  settings?: SettingSchemaEntry[]
}

/** template.json of a format-2 template, with its defaults filled in. */
export interface TemplateManifestV2 extends TemplateManifest {
  format: 2
  contract: string
  toolchain: number
  tokens: Record<string, string>
  settings: SettingSchemaEntry[]
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

export function isFormat2(
  template: LoadedTemplate,
): template is LoadedTemplate & { manifest: TemplateManifestV2 } {
  return template.manifest.format === 2
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
 * The id and version are checked against exactly what the platform will
 * accept, so a template that could never be loaded fails here rather than
 * on the first request to a storefront.
 */
export async function loadTemplate(root: string): Promise<LoadedTemplate> {
  const manifest = await readJson<TemplateManifest>(
    join(root, 'template.json'),
    'template.json',
  )
  const format = manifest.format ?? 1
  if (format !== 1 && format !== 2) {
    throw new TemplateError(`template.json: format must be 1 or 2, got ${JSON.stringify(manifest.format)}`)
  }

  // A format-2 template needs no package.json of its own: one that is only
  // template.json is a valid template.
  const pkg =
    format === 2
      ? await readOptionalJson<TemplatePackageJson>(join(root, 'package.json'), 'package.json')
      : await readJson<TemplatePackageJson>(join(root, 'package.json'), 'package.json')

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
  if (format === 2) {
    manifest.allowedPackages ??= []
    checkFormat2(manifest)
  }
  if (!Array.isArray(manifest.allowedPackages)) {
    throw new TemplateError('template.json: allowedPackages must be an array')
  }

  return { root, manifest, pkg }
}

/**
 * The format-2 fields of template.json. Every problem is reported at once,
 * each with the field it is in.
 */
function checkFormat2(manifest: TemplateManifest): void {
  const errors: string[] = []
  const contracts = Object.keys(CONTRACTS).filter((c) => c !== '1')
  if (typeof manifest.contract !== 'string' || !(manifest.contract in CONTRACTS)) {
    errors.push(`contract must be one of ${contracts.join(', ')}, got ${JSON.stringify(manifest.contract)}`)
  } else if (manifest.contract === '1') {
    errors.push(`contract "1" is for format-1 templates; a format-2 template uses ${contracts.join(', ')}`)
  }
  if (typeof manifest.toolchain !== 'number' || !Number.isInteger(manifest.toolchain)) {
    errors.push(`toolchain must be an integer toolchain line, got ${JSON.stringify(manifest.toolchain)}`)
  } else if (manifest.toolchain !== TOOLCHAIN.line) {
    errors.push(`toolchain ${manifest.toolchain} cannot be built by this toolkit, which builds toolchain ${TOOLCHAIN.line}`)
  }
  manifest.tokens ??= {}
  errors.push(...validateTokens(manifest.tokens))
  manifest.settings ??= []
  errors.push(...validateSettingSchema(manifest.settings))
  if (errors.length > 0) {
    throw new TemplateError(errors.map((e) => `template.json: ${e}`).join('\n'))
  }
}

async function readOptionalJson<T extends object>(path: string, label: string): Promise<T> {
  try {
    await readFile(path)
  } catch {
    return {} as T
  }
  return readJson<T>(path, label)
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
