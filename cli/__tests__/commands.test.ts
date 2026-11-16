import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { COMMANDS } from '../commands'
import { hct } from './host'

describe('hct help', () => {
  it('lists every command', async () => {
    const result = await hct(['--help'])
    expect(result.code).toBe(0)
    for (const c of COMMANDS) expect(result.stdout).toContain(`  ${c.name} `)
  })

  it('prints each command\'s usage and every option it takes', async () => {
    for (const c of COMMANDS) {
      const result = await hct([...c.name.split(' '), '--help'])
      expect(result.code).toBe(0)
      expect(result.stdout).toStartWith(`Usage: ${c.usage}\n`)
      for (const f of c.flags) expect(result.stdout).toContain(`  ${f.flag}\n`)
      for (const flag of c.usage.matchAll(/--[a-z-]+/g)) expect(c.flags.map((f) => f.flag.split(' ')[0])).toContain(flag[0])
    }
  })

  it('prints the toolkit version', async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'))
    expect(pkg.version).toBe('2.0.0')
    const result = await hct(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('2.0.0\n')
  })

  it('refuses an unknown command', async () => {
    const result = await hct(['deploy'])
    expect(result.code).toBe(1)
    expect(result.stderr).toStartWith('unknown command: deploy')
  })
})
