import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommandError, stringFlag, type Flags } from './commands'
import { TEMPLATE_ID } from './template'
import { FORMAT2_PACKAGE_RANGES, toolkitDependency } from './toolchain'

/**
 * hct init — writes a new format-2 template. The full scaffold is a copy of
 * examples/basic, the tokens-only one of examples/minimal, each with the
 * new template's id and name and a package.json an author can install,
 * which depends on the release of this toolkit that wrote it.
 */

const TOOLKIT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLES = join(TOOLKIT_ROOT, 'examples')

export interface InitOptions {
  minimal?: boolean
  id?: string
  name?: string
}

/** A template id made from a directory name: lowercase words joined by dashes. */
export function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
}

function titleFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw e
  }
}

function packageJson(id: string, minimal: boolean, toolkit: string, example: Record<string, any>): Record<string, unknown> {
  const ranges = (names: string[]) =>
    Object.fromEntries(
      names
        .filter((n) => n !== '@hostcore/toolkit')
        .sort()
        .map((n) => {
          const range = FORMAT2_PACKAGE_RANGES[n]
          if (!range) throw new Error(`examples/basic depends on ${n}, which has no format-2 range`)
          return [n, range]
        }),
    )
  const dependencies = minimal ? ['react', 'react-dom'] : Object.keys(example.dependencies ?? {})
  const devDependencies = minimal ? ['@vitejs/plugin-react', 'vite'] : Object.keys(example.devDependencies ?? {})
  return {
    name: id,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'hct dev',
      check: 'hct check',
      build: 'hct build --local-paths',
      validate: 'hct validate',
      push: 'hct push',
    },
    dependencies: { '@hostcore/toolkit': toolkit, ...ranges(dependencies) },
    devDependencies: ranges(devDependencies),
  }
}

const GITIGNORE = 'node_modules/\ndist/\n'

/** Writes a new template into `root`, which must be empty or not exist. Returns the files written. */
export async function initTemplate(root: string, options: InitOptions = {}): Promise<string[]> {
  if (!(await isEmptyOrMissing(root))) {
    throw new CommandError(`${root} is not empty; hct init writes a new template into an empty directory`)
  }
  const id = options.id ?? idFromName(basename(root))
  if (!TEMPLATE_ID.test(id)) {
    throw new CommandError(
      `${JSON.stringify(id)} is not a template id (lowercase letters, digits and dashes, at most 64); pass --id <id>`,
    )
  }
  const name = options.name ?? titleFromId(id)
  const minimal = options.minimal === true
  const source = join(EXAMPLES, minimal ? 'minimal' : 'basic')
  const basicPkg = JSON.parse(await readFile(join(EXAMPLES, 'basic', 'package.json'), 'utf8')) as Record<string, any>

  await mkdir(root, { recursive: true })
  const written: string[] = []
  if (!minimal) {
    for (const entry of ['src', 'public', 'tsconfig.json']) {
      await cp(join(source, entry), join(root, entry), { recursive: true })
    }
    written.push('src/', 'public/', 'tsconfig.json')
  }

  const template = JSON.parse(await readFile(join(source, 'template.json'), 'utf8')) as Record<string, unknown>
  const { id: _id, version: _version, name: _name, ...rest } = template
  await writeFile(join(root, 'template.json'), `${JSON.stringify({ id, version: '0.1.0', name, ...rest }, null, 2)}\n`)
  const pkg = packageJson(id, minimal, toolkitDependency(), basicPkg)
  await writeFile(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(join(root, '.gitignore'), GITIGNORE)
  written.push('template.json', 'package.json', '.gitignore')
  return written.sort()
}

/** hct init [dir] [--minimal] [--id <id>] [--name <name>] */
export async function initCommand(root: string, flags: Flags): Promise<number> {
  const options: InitOptions = { minimal: flags.minimal === true }
  const id = stringFlag(flags, 'id')
  const name = stringFlag(flags, 'name')
  if (id !== undefined) options.id = id
  if (name !== undefined) options.name = name
  const written = await initTemplate(root, options)
  process.stdout.write(
    [
      `wrote a ${options.minimal ? 'tokens-only' : 'format-2'} template in ${root}:`,
      ...written.map((f) => `  ${f}`),
      '',
      'Next:',
      '  bun install       install React, Vite and the toolkit',
      '  bun run dev       preview every page against the contract fixtures (hct dev)',
      '  bun run check     render every page the way the platform does (hct check)',
      '  bun run push      upload a version (hct push --listing <id>)',
      '',
    ].join('\n'),
  )
  return 0
}
