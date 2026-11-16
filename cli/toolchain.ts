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
