import toolkitPackage from '../package.json' with { type: 'json' }

/**
 * The toolchain this toolkit builds format-2 templates with.
 *
 * A line is a set of package majors (line 2: Vite 8, React 19); a revision
 * is one exact set of versions within a line. Every format-2 manifest and
 * runtime records the toolchain it was built with.
 */
export const TOOLCHAIN = { line: 2, revision: 0 } as const

export type Toolchain = { line: number; revision: number }

/** The oldest Vite major a format-2 build runs on. */
export const MIN_VITE_MAJOR = 8

/** The React major the runtime and format-2 templates are built against. */
export const REACT_MAJOR = 19

/**
 * The dependency ranges of a format-2 template on this toolchain line, for
 * every package a template may install. `hct init` writes them and
 * `hct upgrade` moves a format-1 template's package.json to them.
 */
export const FORMAT2_PACKAGE_RANGES: Readonly<Record<string, string>> = {
  react: '~19.3.1',
  'react-dom': '~19.3.1',
  clsx: '^2.1.1',
  'embla-carousel-react': '^8.6.0',
  gsap: '^3.15.1',
  'react-icons': '^5.7.0',
  'tailwind-merge': '^3.7.0',
  vite: '^8.3.8',
  '@vitejs/plugin-react': '^6.3.0',
  '@tailwindcss/vite': '^4.3.5',
  tailwindcss: '^4.3.5',
  typescript: '~5.9.3',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
}

/** What a format-2 template needs installed to build: React, Vite and its React plugin. */
export const FORMAT2_REQUIRED = {
  dependencies: ['react', 'react-dom'],
  devDependencies: ['vite', '@vitejs/plugin-react'],
} as const

/** This toolkit's release version, from its package.json. `hct --version` prints it. */
export const TOOLKIT_VERSION: string = toolkitPackage.version

/**
 * The @hostcore/toolkit dependency a new template gets: this repository at
 * the tag of a toolkit release, `v<version>`.
 */
export function toolkitDependency(version: string = TOOLKIT_VERSION): string {
  return `github:hostcore-co/HostCore.Toolkit#v${version}`
}
