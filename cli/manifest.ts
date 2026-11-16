import { createHash, createPrivateKey, sign } from 'node:crypto'

/**
 * The manifest that travels with a build: what each artefact is, and a
 * digest of its bytes.
 *
 * The platform re-checks every digest before it will run a bundle, so a
 * manifest that disagrees with the files beside it is refused rather than
 * rendered.
 */

export interface BundleManifest {
  template_id: string
  version: string
  built_at: string
  integrity: {
    server_bundle: string
    client_bundle: string
    css_bundle: string
  }
  cdn_paths: {
    client_js: string
    css: string
  }
  signature?: string
}

/** PKCS#8 prefix for a raw 32-byte ed25519 private key. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

export function digest(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`
}

/**
 * Deterministic JSON with sorted keys. The signature covers these exact
 * bytes, so the ordering is part of the format rather than a formatting
 * preference.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

export function signingPayload(manifest: { signature?: string }): string {
  const { signature: _omitted, ...rest } = manifest
  return canonicalJson(rest)
}

/**
 * Signs a manifest with an ed25519 key.
 *
 * `privateKeyBase64` is the raw 32-byte key as printed by `hct keygen`.
 * The signature is what proves a build came from a trusted pipeline
 * rather than from anyone who could write to where builds are stored.
 */
export function signManifest<M extends { signature?: string }>(
  manifest: M,
  privateKeyBase64: string,
): M {
  const raw = Buffer.from(privateKeyBase64, 'base64')
  if (raw.length !== 32) {
    throw new Error(
      `signing private key must be 32 raw bytes, got ${raw.length}`,
    )
  }

  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  })

  const signature = sign(null, Buffer.from(signingPayload(manifest)), key)
  return { ...manifest, signature: signature.toString('base64') }
}

/** The size and digest of one built file. */
export interface FileEntry {
  /** `sha256-<base64>` of the file's bytes. */
  integrity: string
  bytes: number
}

/** One third-party package whose code is in a build, and where it ended up. */
export interface InventoryEntry {
  name: string
  /** The exact version, from the package's own package.json. */
  version: string
  /** Sorted: any of "client", "runtime", "server". */
  in: string[]
}

/**
 * The manifest of a format-2 build (bundle protocol 2).
 *
 * `build_id` names the build: the sha256 of the canonical JSON of this
 * manifest without `build_id`, `built_at` and `signature`, and with
 * `media_base` set to "" (see buildId). The same files, metadata and
 * toolchain always give the same id.
 */
export interface ManifestV2 {
  manifest_version: 2
  build_id: string
  template_id: string
  version: string
  built_at: string
  protocol: 2
  contract: string
  toolchain: { line: number; revision: number }
  runtime: { id: string }
  /** Paths relative to the build directory. `css` is "" for a build without CSS. */
  entry: { server: string; client_js: string; css: string }
  /** Every file of the build except manifest.json, by path relative to the build directory. */
  files: Record<string, FileEntry>
  pages: string[]
  layouts: string[]
  islands: string[]
  /** The slots the build fills, by slot id, in registry order. */
  slots: string[]
  tokens: Record<string, string>
  settings: unknown[]
  inventory: InventoryEntry[]
  /** Where the client files are served from; "" for a local build. */
  media_base: string
  signature?: string
}

export function fileEntry(bytes: Uint8Array): FileEntry {
  return { integrity: digest(bytes), bytes: bytes.byteLength }
}

/**
 * The id of a build: 64 lowercase hex characters, the sha256 of the
 * canonical JSON of the manifest with `build_id`, `built_at` and `signature`
 * removed and `media_base` set to "". The media base is left out because it
 * names where a copy of the build is served from, not what the build is.
 */
export function buildId(manifest: Omit<ManifestV2, 'build_id'> & { build_id?: string }): string {
  const { build_id: _id, built_at: _at, signature: _sig, ...rest } = manifest
  return createHash('sha256')
    .update(canonicalJson({ ...rest, media_base: '' }))
    .digest('hex')
}
