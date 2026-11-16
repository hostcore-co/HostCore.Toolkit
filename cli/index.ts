#!/usr/bin/env bun
import { generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { buildTemplate, BuildError } from './build'
import { CONTRACT_USAGE, contractCommand } from './contract'
import { ContractError } from '../contract/src/generate'
import { loadTemplate, TemplateError } from './template'
import { formatFindings, validateTemplate } from './validate'

/**
 * hct — the HostCore template toolchain.
 *
 * Turns a template into the bundle the platform renders. The build checks
 * what your template depends on and what it reaches for before it compiles
 * anything, so a template that would be refused at render time fails here
 * instead, with a file and a line.
 *
 *   hct validate            check a template against the build policy
 *   hct build               validate, build, and emit a signed manifest
 *   hct dev                 run the template's local dev server
 *   hct keygen              generate a signing keypair
 *   hct contract            generate and check the page data contract
 */

const USAGE = `hct — HostCore template toolchain

Usage:
  hct validate [dir]
  hct build [dir] [--local-paths] [--out <dir>] [--sign <base64-key>]
  hct dev [dir]
  hct keygen
${CONTRACT_USAGE}
Options:
  --local-paths        Address assets at a platform-local path instead of a
                       CDN, so no $CDN_BASE_URL is needed. Use it to build and
                       preview locally.
  --out <dir>          Output directory (default: <dir>/dist)
  --sign <base64-key>  Raw base64 ed25519 private key.
                       Defaults to $TEMPLATE_SIGNING_PRIVATE_KEY.
  --skip-validation    Build without the policy check (local only)
  --contract-dir <dir> The contract directory to generate or check
                       (default: the one in this toolkit)
  --kind <kind>        What generate-go writes: the contract package, or
                       the list of paths the platform front end serves
  --package <name>     The Go package name of generate-go output

Environment:
  CDN_BASE_URL         Where a published template's client assets are served
                       from. Required unless --local-paths.
`

/**
 * Flags that never take a value. Without this a positional argument after a
 * boolean flag would be swallowed as its value.
 */
const BOOLEAN_FLAGS = new Set(['local-paths', 'skip-validation'])

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }

  const { positional, flags } = parseArgs(rest)
  if (command === 'contract') return contractCommand(positional, flags)

  const root = resolve(positional[0] ?? process.cwd())

  switch (command) {
    case 'validate':
      return validateCommand(root)
    case 'build':
      return buildCommand(root, flags)
    case 'dev':
      return devCommand(root)
    case 'keygen':
      return keygenCommand()
    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
      return 1
  }
}

async function validateCommand(root: string): Promise<number> {
  const template = await loadTemplate(root)
  const result = await validateTemplate(template)
  const output = formatFindings(result)

  if (result.findings.length > 0) {
    process.stderr.write(`${output}\n`)
    return 1
  }

  process.stdout.write(`${template.manifest.id}@${template.manifest.version}: ${output}\n`)
  return 0
}

async function buildCommand(
  root: string,
  flags: Record<string, string | boolean>,
): Promise<number> {
  const localPaths = flags['local-paths'] === true
  const cdnBaseUrl = process.env.CDN_BASE_URL

  if (!localPaths && !cdnBaseUrl) {
    process.stderr.write(
      'build needs $CDN_BASE_URL, or --local-paths to address assets locally\n',
    )
    return 1
  }

  const signingKey =
    (flags.sign as string | undefined) ??
    process.env.TEMPLATE_SIGNING_PRIVATE_KEY

  const template = await loadTemplate(root)
  const { manifest, outDir } = await buildTemplate(template, {
    ...(cdnBaseUrl ? { cdnBaseUrl } : {}),
    localPaths,
    outDir: flags.out as string | undefined,
    signingKey,
    skipValidation: flags['skip-validation'] === true,
  })

  process.stdout.write(
    [
      `built ${manifest.template_id}@${manifest.version}`,
      `  output:    ${outDir}`,
      `  server:    ${manifest.integrity.server_bundle}`,
      `  client:    ${manifest.cdn_paths.client_js}`,
      `  css:       ${manifest.cdn_paths.css}`,
      `  assets:    ${localPaths ? 'addressed locally' : 'published to the CDN'}`,
      `  signature: ${manifest.signature ? 'signed' : localPaths ? 'unsigned — local build' : 'UNSIGNED — a published template needs a signature'}`,
      '',
    ].join('\n'),
  )

  return 0
}

/**
 * Runs your template's own Vite config, which serves the dev harness in
 * dev/ against the fixtures in mocks/. Nothing else has to be running —
 * the harness supplies the page data the platform would.
 */
async function devCommand(root: string): Promise<number> {
  const proc = Bun.spawn(['bunx', 'vite'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  return await proc.exited
}

function keygenCommand(): number {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  // Raw 32-byte keys: the last 32 bytes of the DER encodings, which is the
  // form --sign and the verifier both expect.
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)

  process.stdout.write(
    [
      'ed25519 template signing keypair',
      '',
      `TEMPLATE_SIGNING_PRIVATE_KEY=${priv.toString('base64')}`,
      `TEMPLATE_SIGNING_PUBLIC_KEY=${pub.toString('base64')}`,
      '',
      'The private key belongs to whatever builds your templates, and',
      'nowhere else. The public key is what verifies a build was produced',
      'with it.',
      '',
    ].join('\n'),
  )
  return 0
}

function parseArgs(argv: string[]): {
  positional: string[]
  flags: Record<string, string | boolean>
} {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith('--')) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }

  return { positional, flags }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    if (e instanceof TemplateError || e instanceof BuildError || e instanceof ContractError) {
      process.stderr.write(`${e.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`)
    process.exit(1)
  })
