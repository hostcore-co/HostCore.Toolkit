import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  acceptBaselines,
  baselineReports,
  DEFAULT_GO_PACKAGE,
  NEW_VERSION_ADVICE,
  generateAll,
  generateFrontendPrefixes,
  generateGoFiles,
  staleFiles,
  TOOLKIT_CONTRACT_DIR,
  writeFiles,
} from '../contract/src/generate'

/**
 * hct contract — generate and check the page contract.
 *
 *   generate      rewrite contract/dist, the contract "1" fixtures, fixtures/links.json and fixtures/tokens.json
 *   check         fail when anything generated is out of date, or the
 *                 contract differs from its frozen baselines
 *   accept        record additive contract changes in the baselines
 *   generate-go   write Go source into another project
 */

export const CONTRACT_USAGE = `  hct contract generate [--contract-dir <dir>]
  hct contract check [--contract-dir <dir>]
  hct contract accept [--contract-dir <dir>]
  hct contract generate-go --kind contract --package <name> --out <dir>
  hct contract generate-go --kind frontend-prefixes --package <name> --out <file>
`

const GO_PACKAGE = /^[a-z][a-z0-9_]*$/

export async function contractCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const [sub] = positional
  const contractDir = typeof flags['contract-dir'] === 'string' ? resolve(flags['contract-dir']) : TOOLKIT_CONTRACT_DIR

  switch (sub) {
    case 'generate': {
      const files = generateAll(contractDir)
      writeFiles(contractDir, files)
      process.stdout.write(`wrote ${Object.keys(files).length} files under ${contractDir}\n`)
      return 0
    }
    case 'check': {
      const stale = staleFiles(contractDir)
      if (stale.length > 0) {
        process.stderr.write(
          `the generated contract is stale; run \`hct contract generate\`:\n  ${stale.join('\n  ')}\n`,
        )
        return 1
      }
      const reports = baselineReports(contractDir)
      const missing = reports.filter((r) => !r.hasBaseline).map((r) => r.version)
      const breaking = reports.flatMap((r) => r.changes.filter((c) => c.kind === 'breaking').map((c) => `contract ${r.version}: ${c.at}: ${c.what}`))
      const additive = reports.flatMap((r) => r.changes.filter((c) => c.kind === 'additive').map((c) => `contract ${r.version}: ${c.at}: ${c.what}`))
      if (breaking.length > 0) {
        process.stderr.write(`the contract has breaking changes:\n  ${breaking.join('\n  ')}\n${NEW_VERSION_ADVICE}\n`)
        if (additive.length > 0) process.stderr.write(`It also has additive changes:\n  ${additive.join('\n  ')}\n`)
        return 1
      }
      if (additive.length > 0 || missing.length > 0) {
        process.stderr.write(
          [
            ...(missing.length > 0 ? [`no baseline for contract ${missing.join(', ')}`] : []),
            ...(additive.length > 0 ? [`the contract has additive changes not yet in its baseline:\n  ${additive.join('\n  ')}`] : []),
            'Review them, then run `hct contract accept` to record them in contract/baselines/.',
            '',
          ].join('\n'),
        )
        return 1
      }
      process.stdout.write('the generated contract is up to date, and matches its baselines\n')
      return 0
    }
    case 'accept': {
      const reports = acceptBaselines(contractDir)
      for (const r of reports) {
        if (!r.hasBaseline) process.stdout.write(`recorded a first baseline for contract ${r.version}\n`)
        else if (r.changes.length > 0) {
          process.stdout.write(`recorded ${r.changes.length} additive change(s) in the baseline of contract ${r.version}:\n  ${r.changes.map((c) => `${c.at}: ${c.what}`).join('\n  ')}\n`)
        } else process.stdout.write(`contract ${r.version} matches its baseline\n`)
      }
      return 0
    }
    case 'generate-go':
      return generateGo(contractDir, flags)
    default:
      process.stderr.write(`unknown contract command: ${sub ?? '(none)'}\n\nUsage:\n${CONTRACT_USAGE}`)
      return 1
  }
}

function generateGo(contractDir: string, flags: Record<string, string | boolean>): number {
  const kind = flags.kind
  const packageName = typeof flags.package === 'string' ? flags.package : DEFAULT_GO_PACKAGE
  const out = flags.out

  if (!GO_PACKAGE.test(packageName)) {
    process.stderr.write(`--package must be a Go package name, got ${JSON.stringify(packageName)}\n`)
    return 1
  }
  if (typeof out !== 'string') {
    process.stderr.write('generate-go needs --out\n')
    return 1
  }

  if (kind === 'frontend-prefixes') {
    const target = resolve(out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, generateFrontendPrefixes(contractDir, packageName))
    process.stdout.write(`wrote ${target}\n`)
    return 0
  }
  if (kind === 'contract') {
    const dir = resolve(out)
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(generateGoFiles(contractDir, packageName))) {
      writeFileSync(join(dir, name), content)
    }
    process.stdout.write(`wrote package ${packageName} to ${dir}\n`)
    return 0
  }

  process.stderr.write('--kind must be contract or frontend-prefixes\n')
  return 1
}
