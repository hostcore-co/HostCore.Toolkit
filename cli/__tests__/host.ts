import { join } from 'node:path'

/**
 * Loads bundles the way a host does: in a bare vm context with no globals
 * of the host's, where `require` answers only from the runtime's module
 * table. Only strings cross in and out. `hct check` and `hct dev` load
 * bundles with the same code.
 */
export { loadBundle, loadLegacyBundle, runtimeModules, type LoadedBundle } from '../sandbox'

/**
 * Runs the hct CLI with the Bun running the tests, in the environment an
 * author runs it in: bun test's NODE_ENV=test is not passed on.
 */
export async function hct(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const { NODE_ENV: _test, ...env } = process.env
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'index.ts'), ...args], {
    cwd: cwd ?? join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...env, TEMPLATE_SIGNING_PRIVATE_KEY: '' },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}
