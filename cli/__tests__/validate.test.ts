import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PAGES } from '../../contract/dist/ts/registry'
import { generateDocs } from '../docs'
import { PLATFORM_URL_RULES } from '../policy'
import { loadTemplate, TemplateError } from '../template'
import { validateTemplate, type Finding } from '../validate'

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
    await mkdir(dirname(join(dir, path)), { recursive: true })
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

  it('refuses a version the platform cannot publish, such as a pre-release', async () => {
    for (const version of ['1.0.0-beta', '1.0.0-rc.1', '1.0.0+build.5', '1.0', 'v1.0.0']) {
      const dir = await fixture({ templateJson: { id: 'sample', version, name: 'x', allowedPackages: [] } })
      expect(loadTemplate(dir)).rejects.toThrow(
        `template.json: version must be a release version, MAJOR.MINOR.PATCH such as 1.2.0, got ${JSON.stringify(version)}: the platform publishes only that form of semver, with no pre-release or build part`,
      )
    }
    const dir = await fixture({ templateJson: { id: 'sample', version: '10.20.30', name: 'x', allowedPackages: [] } })
    expect((await loadTemplate(dir)).manifest.version).toBe('10.20.30')
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
        templateJson: { id: 'sample', version: '1.0.0', name: 'Sample', allowedPackages: ['react', 'react-icons'] },
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

const FORMAT2 = {
  id: 'sample',
  version: '1.0.0',
  name: 'Sample',
  format: 2,
  contract: '2026-11',
  toolchain: 2,
}

async function findings2(sources: Record<string, string>, templateJson: Record<string, unknown> = FORMAT2): Promise<Finding[]> {
  const template = await loadTemplate(await fixture({ templateJson, sources }))
  return (await validateTemplate(template)).findings
}

describe('allowedPackages', () => {
  const source = {
    'src/pages/home.tsx': `import gsap from 'gsap'
import clsx from 'clsx'
import { useNav } from '@hostcore/toolkit'
import { useState } from 'react'
export default function Home() { return <main className={clsx('a')}>{String(!!gsap && !!useNav && !!useState)}</main> }`,
  }

  it('narrows what the source may import when template.json declares it', async () => {
    const found = await findings2(source, { ...FORMAT2, allowedPackages: ['gsap'] })
    expect(found.map((f) => [f.line, f.rule])).toEqual([[2, 'import-not-in-allowed-packages']])
    expect(found[0]!.message).toBe(`"clsx" resolves to "clsx", which template.json's allowedPackages does not list; add it there to use it`)
  })

  it('always lets the source import the SDK and React', async () => {
    expect(await findings2(source, { ...FORMAT2, allowedPackages: ['gsap', 'clsx'] })).toEqual([])
  })

  it('leaves the platform allowlist as it is when template.json does not declare it', async () => {
    expect(await findings2(source, FORMAT2)).toEqual([])
  })

  it('applies to format-1 templates, which always declare it', async () => {
    expect(
      await rules({
        templateJson: { id: 'sample', version: '1.0.0', name: 'Sample', allowedPackages: ['react'] },
        sources: { 'src/App.tsx': "import gsap from 'gsap'\nexport const x = gsap" },
      }),
    ).toEqual(['import-not-in-allowed-packages'])
  })

  it('still refuses a package the platform does not allow, listed or not', async () => {
    expect(await findings2({ 'src/pages/home.tsx': "import x from 'left-pad'\nexport default () => x" }, { ...FORMAT2, allowedPackages: ['left-pad'] })).toMatchObject([
      { rule: 'allowlist-widened' },
      { rule: 'import-not-allowed' },
    ])
  })
})

describe('format 2: template.json', () => {
  it('accepts a template that is only template.json', async () => {
    const dir = join(root, `only-${counter++}`)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'template.json'), JSON.stringify(FORMAT2))
    const template = await loadTemplate(dir)
    expect(template.manifest.allowedPackages).toEqual([])
    expect(template.manifest.settings).toEqual([])
    expect(template.manifest.tokens).toEqual({})
    expect(template.pkg).toEqual({})
    expect((await validateTemplate(template)).findings).toEqual([])
  })

  it('reports every metadata problem with its field and reason', async () => {
    const dir = await fixture({
      templateJson: {
        ...FORMAT2,
        contract: '2030-01',
        toolchain: 2.5,
        tokens: { 'color.accent': 'blue', 'shadow.lg': '1px' },
        settings: [{ id: 'hero.title', type: 'text', max: 3, default: 'too long' }, { id: 'n', type: 'number', step: 0 }],
      },
    })
    const error = await loadTemplate(dir).then(
      () => null,
      (e: Error) => e,
    )
    expect(error).toBeInstanceOf(TemplateError)
    expect(error!.message.split('\n')).toEqual([
      'template.json: contract must be one of 2026-11, got "2030-01"',
      'template.json: toolchain must be an integer toolchain line, got 2.5',
      'template.json: tokens.color.accent must match ^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
      'template.json: tokens.shadow.lg is not a design token',
      'template.json: settings[0].default must be at most 3 characters',
      'template.json: settings[1].step must be greater than zero',
    ])
  })

  it('refuses contract "1", an unknown format and a toolchain this toolkit does not build', async () => {
    const message = async (json: Record<string, unknown>) =>
      loadTemplate(await fixture({ templateJson: json })).then(
        () => '',
        (e: Error) => e.message,
      )
    expect(await message({ ...FORMAT2, contract: '1' })).toContain('contract "1" is for format-1 templates')
    expect(await message({ ...FORMAT2, format: 3 })).toBe('template.json: format must be 1 or 2, got 3')
    expect(await message({ ...FORMAT2, toolchain: 1 })).toContain('toolchain 1 cannot be built by this toolkit')
  })
})

describe('format 2: sources', () => {
  it('passes a layout, pages and islands named by the rules', async () => {
    expect(
      await findings2({
        'src/layout.tsx': 'export default function Layout({ children }: any) { return <div>{children}</div> }',
        'src/pages/home.tsx': `import { useNav, Link } from '@hostcore/toolkit'
export const hydrate = 'islands'
export default function Home() { const nav = useNav(); return <Link href={nav.links.login}>Log in</Link> }`,
        'src/pages/catalog.service.tsx': 'export default function Service() { return null }',
        'src/pages/parts/helper.tsx': 'export const x = 1',
        'src/islands/plan-picker.tsx': 'export default function PlanPicker() { return null }',
      }),
    ).toEqual([])
  })

  it('flags page files that are not page ids, and sources without a default export', async () => {
    const found = await findings2({
      'src/pages/about.tsx': 'export default function About() { return null }',
      'src/pages/home.tsx': 'export function Home() { return null }',
      'src/islands/Plan_Picker.tsx': 'export default function P() { return null }',
      'src/layout.tsx': 'export const Layout = () => null',
    })
    expect(found.map((f) => [f.file, f.rule])).toEqual([
      ['src/layout.tsx', 'missing-default-export'],
      ['src/pages/about.tsx', 'unknown-page'],
      ['src/pages/home.tsx', 'missing-default-export'],
      ['src/islands/Plan_Picker.tsx', 'invalid-island-name'],
    ])
    expect(found[1]!.message).toContain('home.tsx, domains.tsx, catalog.group.tsx, catalog.service.tsx, not-found.tsx')
  })

  it('requires hydrate to be a literal', async () => {
    const found = await findings2({
      'src/pages/home.tsx': "const mode = 'islands'\nexport const hydrate = mode\nexport default function Home() { return null }",
    })
    expect(found.map((f) => f.rule)).toEqual(['invalid-hydrate'])
  })

  it('flags hand-built platform URLs and says where to take each from', async () => {
    const found = await findings2({
      'src/pages/home.tsx': `export default function Home({ data }: any) {
  return (
    <>
      <a href="/login">Log in</a>
      <a href='/signup?next=/'>Sign up</a>
      <a href={\`/checkout/\${data.plan.slug}\`}>Buy</a>
      <a href="/dashboard">Account</a>
      <form action="/api/v1/public/domains/search" />
      <a href="/loginx">Not a platform page</a>
      <a href="/games">A group</a>
    </>
  )
}`,
    })
    expect(found.map((f) => [f.line, f.rule])).toEqual([
      [4, 'hand-built-platform-url'],
      [5, 'hand-built-platform-url'],
      [6, 'hand-built-platform-url'],
      [7, 'hand-built-platform-url'],
      [8, 'hand-built-platform-url'],
    ])
    expect(found[0]!.message).toContain('useNav().links.login')
    expect(found[2]!.message).toContain('checkout_url')
    expect(found[3]!.message).toContain('useNav().links.account')
    expect(found[4]!.message).toContain('useAction(name)')
  })

  it('flags every fixed path of the page registry, and not the home page', async () => {
    const fixed = PAGES.flatMap((p) => p.paths).filter((path) => !path.includes('{') && path !== '/')
    expect(fixed).toContain('/domains')
    expect(fixed).toContain('/checkout/domains')
    expect(PLATFORM_URL_RULES.map((r) => r.path)).toEqual([...fixed, '/api'])
    const found = await findings2({
      'src/pages/home.tsx': `export default function Home() {
  return (
    <>
${fixed.map((path) => `      <a href="${path}">x</a>`).join('\n')}
      <a href="/">Home</a>
    </>
  )
}`,
    })
    expect(found.map((f) => f.line)).toEqual(fixed.map((_, i) => i + 4))
    expect(found[0]!.message).toBe('"/domains…" is a platform URL; take it from the page data instead: useNav().links.domains, which is empty when the store sells no domains')
    expect(found.find((f) => f.message.startsWith('"/forgotpassword'))!.message).toContain('the page data has no link to this platform page')
  })

  it('points a hand-built domain checkout link at actionHref', async () => {
    const found = await findings2({
      'src/islands/buy.tsx': 'export default function Buy({ d }: { d: string }) {\n  return <a href={`/checkout/domains?domain=${d}&action=register&years=1`}>Buy</a>\n}',
    })
    expect(found.map((f) => [f.line, f.message])).toEqual([
      [2, `"/checkout/domains…" is a platform URL; take it from the page data instead: actionHref(useAction('domain_checkout'), { domain, action, years })`],
    ])
  })

  it('agrees with the upgrade guide', () => {
    const upgrading = generateDocs()['upgrading.md']!
    for (const rule of PLATFORM_URL_RULES) expect(upgrading).toContain(`| \`${rule.path}\` |`)
  })

  it('does not apply the URL rule to format-1 templates', async () => {
    expect(
      await rules({ sources: { 'src/App.tsx': 'export function App() { return <a href="/login">x</a> }' } }),
    ).toEqual([])
  })

  it('flags useSetting() with an id template.json does not declare', async () => {
    const found = await findings2(
      {
        'src/pages/home.tsx': `import { useSetting } from '@hostcore/toolkit'
export default function Home() {
  const a = useSetting('hero.title')
  const b = useSetting<string>("hero.tagline")
  return <p>{a}{b}</p>
}`,
      },
      { ...FORMAT2, settings: [{ id: 'hero.title', type: 'text' }] },
    )
    expect(found.map((f) => [f.line, f.rule])).toEqual([[4, 'undeclared-setting']])
  })

  it('applies the format-1 policy too', async () => {
    const found = await findings2({
      'src/pages/home.tsx': "import fs from 'node:fs'\nexport default function Home() { return <p>{String(eval('1'))}</p> }",
    })
    expect(found.map((f) => f.rule).sort()).toEqual(['banned-import', 'eval'])
  })
})

describe('stylesheets', () => {
  const css = `@import "tailwindcss" source(".");
@import url("./fonts.css");
/* url(https://fonts.example.com/inter.woff2) is not loaded from a comment */
.hero { background: url('/images/grid.svg'), url(data:image/png;base64,AAAA) }
.mask { clip-path: url(#clip) }
.logo { background: url("https://images.example.com/logo.png") }
@import '//fonts.example.com/css';
`

  it('flags a URL to another site in a format-2 stylesheet, with its file, line and URL', async () => {
    const found = await findings2({ 'src/styles.css': css, 'public/fonts.css': '@font-face { src: url(fonts/inter.woff2) }' })
    expect(found.map((f) => [f.file, f.line, f.rule])).toEqual([
      ['src/styles.css', 6, 'stylesheet-external-url'],
      ['src/styles.css', 7, 'stylesheet-external-url'],
    ])
    expect(found[0]!.message).toStartWith('url("https://images.example.com/logo.png") loads from another site.')
    expect(found[0]!.message).toContain('put the file in public/ and reference it with a relative or root-relative URL, such as url("/logo.png")')
    expect(found[1]!.message).toStartWith('@import "//fonts.example.com/css" loads from another site.')
  })

  it('applies to format-1 stylesheets too', async () => {
    expect(await rules({ sources: { 'src/styles.css': css } })).toEqual(['stylesheet-external-url', 'stylesheet-external-url'])
  })

  it('leaves out stylesheets that are not part of the template', async () => {
    expect(
      await rules({ sources: { 'node_modules/x/a.css': css, 'dist/client/a.css': css, 'dev/preview.css': css } }),
    ).toEqual([])
  })
})
