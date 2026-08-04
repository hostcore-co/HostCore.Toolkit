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

export function signingPayload(manifest: BundleManifest): string {
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
export function signManifest(
  manifest: BundleManifest,
  privateKeyBase64: string,
): BundleManifest {
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
