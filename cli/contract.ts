import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  DEFAULT_GO_PACKAGE,
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
 *   generate      rewrite contract/dist and the contract "1" fixtures
 *   check         fail when anything generated is out of date
 *   generate-go   write Go source into another project
 */

export const CONTRACT_USAGE = `  hct contract generate [--contract-dir <dir>]
  hct contract check [--contract-dir <dir>]
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
      process.stdout.write('the generated contract is up to date\n')
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
