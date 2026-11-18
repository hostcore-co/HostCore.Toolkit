// Path matching for the page registry. This file has no imports: its text is
// copied into the generated registry module, so the matcher the toolkit
// tests is the one every consumer runs.

export interface RoutePage {
  id: string
  /** Every path the page is reached by; empty for a page no path reaches, such as not-found. */
  paths: readonly string[]
  /** True when the page also owns every path below its own. */
  prefix: boolean
}

export interface PathMatch<Id extends string = string> {
  id: Id
  /** Raw path segments by parameter name, not percent-decoded. */
  params: Record<string, string>
}

/**
 * Finds the page a pathname belongs to.
 *
 * - The pathname must start with "/". One trailing "/" is ignored; an empty
 *   segment anywhere else ("//") matches nothing.
 * - A pathname with any segment starting with "_" matches nothing. Those
 *   paths belong to the platform.
 * - A `{param}` in first position never captures the first segment of a
 *   page's path (`domains`, `checkout`, …), so `/domains/x` is not a service
 *   page of a group called "domains". Any other segment it captures, a
 *   reserved slug no page uses among them: a reserved slug is a name a
 *   store may not give a new group, not a path that stops matching.
 * - A prefix page matches its own path and every path below it, on a "/"
 *   boundary: /order matches /order and /order/x but not /orders.
 * - A page with several paths matches by any of them.
 * - When several pages match, the one whose earliest differing segment is
 *   static wins; then the longer pattern; then an exact page over a prefix
 *   page; then registry order.
 */
export function matchRoute(pages: readonly RoutePage[], pathname: string): PathMatch | null {
  if (!pathname.startsWith('/')) return null
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const segments = trimmed === '/' ? [] : trimmed.slice(1).split('/')
  if (segments.some((s) => s === '' || s.startsWith('_'))) return null

  const owned = new Set<string>()
  for (const page of pages) {
    for (const path of page.paths) {
      const first = path === '/' ? '' : path.slice(1).split('/')[0]!
      if (first !== '' && !first.startsWith('{')) owned.add(first)
    }
  }

  let best: { match: PathMatch; rank: number[]; prefix: boolean } | null = null

  for (const page of pages) {
    for (const path of page.paths) {
      const pattern = path === '/' ? [] : path.slice(1).split('/')
      if (page.prefix ? segments.length < pattern.length : segments.length !== pattern.length) continue

      const params: Record<string, string> = {}
      const rank: number[] = []
      let matched = true
      for (let i = 0; i < pattern.length; i++) {
        const part = pattern[i]!
        const segment = segments[i]!
        if (part.startsWith('{')) {
          if (i === 0 && owned.has(segment)) {
            matched = false
            break
          }
          params[part.slice(1, -1)] = segment
          rank.push(1)
        } else if (part === segment) {
          rank.push(0)
        } else {
          matched = false
          break
        }
      }
      if (!matched) continue

      if (best === null || outranks(rank, page.prefix, best.rank, best.prefix)) {
        best = { match: { id: page.id, params }, rank, prefix: page.prefix }
      }
    }
  }

  return best?.match ?? null
}

function outranks(rank: number[], prefix: boolean, other: number[], otherPrefix: boolean): boolean {
  const shared = Math.min(rank.length, other.length)
  for (let i = 0; i < shared; i++) {
    if (rank[i] !== other[i]) return rank[i]! < other[i]!
  }
  if (rank.length !== other.length) return rank.length > other.length
  return !prefix && otherPrefix
}
