#!/usr/bin/env bun
import { generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { ContractError } from '../contract/src/generate'
import { buildTemplate, BuildError } from './build'
import { buildFormat2 } from './build-v2'
import { checkCommand } from './check'
import { BOOLEAN_FLAGS, commandHelp, CommandError, findCommand, overviewHelp, type Flags } from './commands'
import { contractCommand } from './contract'
import { devCommand } from './dev'
import { docsCommand } from './docs'
import { initCommand } from './init'
import { pushCommand } from './push'
import { buildRuntime, RuntimeError, writeRuntime } from './runtime'
import { isFormat2, loadTemplate, TemplateError } from './template'
import { upgradeCommand } from './upgrade'
import { formatFindings, validateTemplate } from './validate'

/**
 * hct — the HostCore template toolchain: everything from a template's first
 * file to its upload. The commands, their flags and their help text are in
 * commands.ts; each command's work is in its own module.
 */

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(overviewHelp())
    return command ? 0 : 1
  }

  const { positional, flags } = parseArgs(rest)
  const doc = findCommand(command === 'runtime' ? 'runtime build' : command)
  if (!doc) {
    process.stderr.write(`unknown command: ${command}\n\n${overviewHelp()}`)
    return 1
  }
  if (flags.help === true) {
    process.stdout.write(commandHelp(doc))
    return 0
  }
  const root = resolve(positional[0] ?? process.cwd())

  switch (command) {
    case 'contract':
      return contractCommand(positional, flags)
    case 'runtime':
      return runtimeCommand(positional, flags)
    case 'docs':
      return docsCommand(flags)
    case 'validate':
      return validateCommand(root)
    case 'build':
      return buildCommand(root, flags)
    case 'check':
      return checkCommand(root, flags)
    case 'dev':
      return devCommand(root, flags)
    case 'init':
      return initCommand(root, flags)
    case 'upgrade':
      return upgradeCommand(root, flags)
    case 'push':
      return pushCommand(root, flags)
    case 'keygen':
      return keygenCommand()
    default:
      process.stderr.write(`unknown command: ${command}\n\n${overviewHelp()}`)
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
  flags: Flags,
): Promise<number> {
  const localPaths = flags['local-paths'] === true
  const signingKey =
    (flags.sign as string | undefined) ??
    process.env.TEMPLATE_SIGNING_PRIVATE_KEY
  const template = await loadTemplate(root)

  if (isFormat2(template)) {
    const mediaBase = typeof flags['media-base'] === 'string' ? flags['media-base'] : undefined
    const { manifest, outDir } = await buildFormat2(template, {
      outDir: flags.out as string | undefined,
      localPaths,
      mediaBase,
      signingKey,
      skipValidation: flags['skip-validation'] === true,
      runtimeDir: typeof flags.runtime === 'string' ? flags.runtime : undefined,
    })
    process.stdout.write(
      [
        `built ${manifest.template_id}@${manifest.version} (format 2)`,
        `  output:    ${outDir}`,
        `  build id:  ${manifest.build_id}`,
        `  runtime:   ${manifest.runtime.id}`,
        `  pages:     ${manifest.pages.join(', ') || '(none; the platform supplies every page)'}`,
        `  layout:    ${manifest.layouts.length > 0 ? 'yes' : '(none; the platform supplies it)'}`,
        `  islands:   ${manifest.islands.join(', ') || '(none)'}`,
        `  server:    ${manifest.entry.server} (${manifest.files[manifest.entry.server]?.bytes} bytes)`,
        `  client:    ${manifest.entry.client_js}`,
        `  css:       ${manifest.entry.css || '(none)'}`,
        `  signature: ${manifest.signature ? 'signed' : 'unsigned'}`,
        '',
      ].join('\n'),
    )
    return 0
  }

  const cdnBaseUrl = process.env.CDN_BASE_URL

  if (!localPaths && !cdnBaseUrl) {
    process.stderr.write(
      'build needs $CDN_BASE_URL, or --local-paths to address assets locally\n',
    )
    return 1
  }

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
 * hct runtime build — writes the shared React runtime format-2 server and
 * client bundles are loaded with. The same installed packages always give
 * the same files and the same runtime_id.
 */
async function runtimeCommand(
  positional: string[],
  flags: Flags,
): Promise<number> {
  if (positional[0] !== 'build') {
    process.stderr.write(`unknown runtime command: ${positional[0] ?? '(none)'}\n\n${commandHelp(findCommand('runtime build')!)}`)
    return 1
  }
  if (typeof flags.out !== 'string') {
    process.stderr.write('runtime build needs --out <dir>\n')
    return 1
  }
  const signingKey =
    (flags.sign as string | undefined) ?? process.env.TEMPLATE_SIGNING_PRIVATE_KEY
  const root = resolve(typeof flags.root === 'string' ? flags.root : process.cwd())
  const out = resolve(flags.out)
  const runtime = await buildRuntime(root, signingKey)
  await writeRuntime(runtime, out)
  process.stdout.write(
    [
      `built runtime ${runtime.json.runtime_id}`,
      `  output:    ${out}`,
      ...Object.entries(runtime.json.files).map(([path, f]) => `  ${path}: ${f.bytes} bytes`),
      '',
    ].join('\n'),
  )
  return 0
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
    if (e instanceof TemplateError || e instanceof BuildError || e instanceof ContractError || e instanceof RuntimeError || e instanceof CommandError) {
      process.stderr.write(`${e.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`)
    process.exit(1)
  })
