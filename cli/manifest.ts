import { createHash, createPrivateKey, sign } from 'node:crypto'

/**
 * Build-side counterpart to packages/engine/src/bundles/integrity.ts.
 *
 * The two files must agree exactly on the digest format and on what the
 * signature covers — they are the producer and consumer of the same
 * trust anchor. The engine's tests cover verification; these functions
 * cover production.
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
 * Deterministic JSON with sorted keys — must match the engine's
 * canonicalJson, or nothing will verify.
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
 * Signs a manifest with the pipeline's ed25519 key.
 *
 * `privateKeyBase64` is the raw 32-byte key as printed by `hct keygen`.
 * It is the only secret in the build, and it is what stops anyone with
 * write access to the bucket from pointing a store at their own bundle.
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
