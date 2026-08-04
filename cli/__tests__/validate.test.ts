import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTemplate, TemplateError } from '../template'
import { validateTemplate } from '../validate'

const root = join(tmpdir(), `hct-validate-${process.pid}`)

interface Fixture {
  templateJson?: Record<string, unknown>
  packageJson?: Record<string, unknown>
  sources?: Record<string, string>
}

let counter = 0

async function fixture(spec: Fixture): Promise<string> {
  const dir = join(root, `t${counter++}`)
  await mkdir(join(dir, 'src'), { recursive: true })

  await writeFile(
    join(dir, 'template.json'),
    JSON.stringify(
      spec.templateJson ?? {
        id: 'sample',
        version: '1.0.0',
        name: 'Sample',
        allowedPackages: ['react', '@hostcore/toolkit'],
      },
    ),
  )

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      spec.packageJson ?? {
        name: 'sample',
        dependencies: { react: '^19.0.0', '@hostcore/toolkit': 'workspace:*' },
        devDependencies: { vite: '^5.0.0' },
      },
    ),
  )

  for (const [path, source] of Object.entries(spec.sources ?? {})) {
    await writeFile(join(dir, path), source)
  }

  return dir
}

async function rules(spec: Fixture): Promise<string[]> {
  const template = await loadTemplate(await fixture(spec))
  const { findings } = await validateTemplate(template)
  return findings.map((f) => f.rule)
}

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('loadTemplate', () => {
  it('rejects an id the engine could not address', async () => {
    const dir = await fixture({
      templateJson: {
        id: '../escape',
        version: '1.0.0',
        name: 'x',
        allowedPackages: [],
      },
    })
    expect(loadTemplate(dir)).rejects.toBeInstanceOf(TemplateError)
  })

  it('rejects a non-semver version', async () => {
    const dir = await fixture({
      templateJson: {
        id: 'sample',
        version: 'latest',
        name: 'x',
        allowedPackages: [],
      },
    })
    expect(loadTemplate(dir)).rejects.toThrow(/semver/)
  })
})

describe('validateTemplate', () => {
  it('passes a template that stays inside the policy', async () => {
    expect(
      await rules({
        sources: {
          'src/App.tsx': `import { useHC } from '@hostcore/toolkit'
export function App() {
  const { store } = useHC()
  return <h1>{store.store_name}</h1>
}
`,
        },
      }),
    ).toEqual([])
  })

  it('rejects a dependency that is not on the platform allowlist', async () => {
    expect(
      await rules({
        packageJson: {
          name: 'sample',
          dependencies: { react: '^19.0.0', 'node-fetch': '^3.0.0' },
        },
      }),
    ).toContain('dependency-not-allowed')
  })

  it('refuses to let template.json widen the platform allowlist', async () => {
    expect(
      await rules({
        templateJson: {
          id: 'sample',
          version: '1.0.0',
          name: 'Sample',
          allowedPackages: ['react', 'child_process'],
        },
      }),
    ).toContain('allowlist-widened')
  })

  it('rejects importing a host capability', async () => {
    expect(
      await rules({
        sources: {
          'src/App.tsx': `import { readFileSync } from 'node:fs'
export function App() { return <p>{readFileSync('/etc/passwd')}</p> }
`,
        },
      }),
    ).toContain('banned-import')
  })

  it('rejects importing a package that is not allowlisted', async () => {
    expect(
      await rules({
        sources: {
          'src/App.tsx': `import axios from 'axios'
export function App() { return <p>{String(axios)}</p> }
`,
        },
      }),
    ).toContain('import-not-allowed')
  })

  it('allows deep imports of an allowlisted package', async () => {
    expect(
      await rules({
        sources: {
          'src/App.tsx': `import { createElement } from 'react'
import { Icon } from 'react-icons/fa'
export function App() { return createElement(Icon) }
`,
        },
      }),
    ).toEqual([])
  })

  it('rejects the runtime escape hatches', async () => {
    const found = await rules({
      sources: {
        'src/bad.ts': `export const a = eval('1 + 1')
export const b = new Function('return 2')()
export const c = require('node:fs')
export const d = process.env.INTERNAL_API_KEY
export const e = globalThis['pro' + 'cess']
export const f = ''.constructor('return this')()
`,
      },
    })

    expect(found).toContain('eval')
    expect(found).toContain('new-function')
    expect(found).toContain('require')
    expect(found).toContain('process')
    expect(found).toContain('global-escape')
    expect(found).toContain('constructor-escape')
  })

  it('does not flag the local dev harness, which never ships', async () => {
    const dir = await fixture({
      sources: {
        'src/App.tsx': `export function App() { return <p>ok</p> }`,
      },
    })
    await mkdir(join(dir, 'dev'), { recursive: true })
    await writeFile(
      join(dir, 'dev/main.tsx'),
      `import { createRoot } from 'react-dom/client'\nconst x = process.env.NODE_ENV\n`,
    )

    const { findings } = await validateTemplate(await loadTemplate(dir))
    expect(findings).toEqual([])
  })

  it('does not flag a mention inside a comment', async () => {
    expect(
      await rules({
        sources: {
          'src/App.tsx': `// never call eval() here
/* process.env is unavailable */
export function App() { return <p>ok</p> }
`,
        },
      }),
    ).toEqual([])
  })
})
