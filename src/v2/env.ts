import type { Env } from './types'

/**
 * The environment of the render in progress. Rendering is synchronous on the
 * server and happens once per page on the client, so one module-level value
 * is enough for `asset()` to read without a hook.
 */
let current: Env | null = null

/** Sets the environment `asset()` reads; returns the previous one. */
export function setCurrentEnv(env: Env | null): Env | null {
  const previous = current
  current = env
  return previous
}

/**
 * The URL of a file in your template's public/ directory, wherever this build
 * is served from: `asset('images/logo.svg')`. Use it for every reference to
 * your own files in markup, so they resolve the same in every environment.
 */
export function asset(path: string): string {
  const base = current?.asset_base ?? ''
  if (base === '') return path
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
