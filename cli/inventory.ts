import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { InventoryEntry } from './manifest'

/**
 * Works out which packages the bundler actually put into a build, from the
 * module ids it reports: each module belongs to the nearest package.json
 * above it that has a name and a version.
 */

interface PackageId {
  name: string
  version: string
}

export class Inventory {
  private readonly found = new Map<string, Set<string>>()
  private readonly cache = new Map<string, PackageId | null>()

  /**
   * @param ownRoot modules under this directory (and not under one of its
   *   node_modules) are the template's own code, not a package.
   */
  constructor(private readonly ownRoot: string | null) {}

  /** Records that the module `id` ended up in `where`. */
  add(id: string, where: string): void {
    const pkg = this.packageOf(id)
    if (!pkg) return
    const key = `${pkg.name}@${pkg.version}`
    const places = this.found.get(key) ?? new Set<string>()
    places.add(where)
    this.found.set(key, places)
  }

  /** Records every entry of another inventory. */
  merge(entries: readonly InventoryEntry[]): void {
    for (const entry of entries) {
      const key = `${entry.name}@${entry.version}`
      const places = this.found.get(key) ?? new Set<string>()
      for (const where of entry.in) places.add(where)
      this.found.set(key, places)
    }
  }

  /** Sorted by name then version; each `in` list sorted. */
  entries(): InventoryEntry[] {
    return [...this.found.entries()]
      .map(([key, places]) => {
        const at = key.lastIndexOf('@')
        return { name: key.slice(0, at), version: key.slice(at + 1), in: [...places].sort() }
      })
      .sort((a, b) => (a.name === b.name ? cmp(a.version, b.version) : cmp(a.name, b.name)))
  }

  private packageOf(id: string): PackageId | null {
    if (id.startsWith('\0')) return null
    const path = id.split('?')[0]!
    if (!isAbsolute(path)) return null
    if (this.ownRoot) {
      const rel = relative(this.ownRoot, path)
      if (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('node_modules')) return null
    }
    return this.lookup(dirname(path))
  }

  private lookup(dir: string): PackageId | null {
    const cached = this.cache.get(dir)
    if (cached !== undefined) return cached
    let result: PackageId | null = null
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown }
        if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
          result = { name: pkg.name, version: pkg.version }
        }
      } catch {
        // Not a package manifest; keep looking further up.
      }
    }
    if (!result) {
      const parent = dirname(dir)
      result = parent === dir ? null : this.lookup(parent)
    }
    this.cache.set(dir, result)
    return result
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The modules of an output chunk that contributed code to it. */
export function renderedModules(chunk: { modules?: Record<string, { renderedLength?: number }>; moduleIds?: readonly string[] }): string[] {
  const modules = chunk.modules ?? {}
  return Object.entries(modules)
    .filter(([, info]) => (info.renderedLength ?? 1) > 0)
    .map(([id]) => id)
}
