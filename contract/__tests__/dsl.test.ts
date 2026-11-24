import { describe, expect, it } from 'bun:test'
import { checkContract, Definitions, t, type Contract } from '../src/dsl'
import { contract1 } from '../src/contract-1'
import { contract202611 } from '../src/contract-2026-11'

describe('the schema DSL', () => {
  it('keeps fields in declaration order and marks optional ones', () => {
    const schema = t.object({ b: t.string(), a: t.optional(t.integer()), c: t.doc('Third.', t.boolean()) })
    expect(schema.kind).toBe('object')
    expect(Object.keys(schema.fields)).toEqual(['b', 'a', 'c'])
    expect(schema.fields.a!.optional).toBe(true)
    expect(schema.fields.b!.optional).toBe(false)
    expect(schema.fields.c!.doc).toBe('Third.')
  })

  it('requires an open enum fallback to be one of its values', () => {
    expect(t.openEnum(['a', 'other'], 'other').open).toEqual({ fallback: 'other' })
    expect(() => t.openEnum(['a'], 'other')).toThrow()
  })

  it('merges a base object into an extension and remembers the base', () => {
    const d = new Definitions()
    d.define('Base', 'is a base.', t.object({ kind: t.enum(['x', 'y']), shared: t.string() }))
    d.extend('Child', 'is a child.', 'Base', { kind: t.literal('x'), own: t.number() })
    const child = d.get('Child').schema
    expect(child.kind === 'object' && Object.keys(child.fields)).toEqual(['kind', 'shared', 'own'])
    expect(child.kind === 'object' && child.base).toBe('Base')
    expect(() => d.define('Base', 'again.', t.string())).toThrow()
  })

  it('reports unresolved references and mistagged union variants', () => {
    const d = new Definitions()
    d.define('A', 'is A.', t.object({ tag: t.literal('a'), missing: t.ref('Nope') }))
    d.define('B', 'is B.', t.object({ tag: t.literal('wrong') }))
    d.define('U', 'is U.', t.union('tag', { a: 'A', b: 'B' }))
    const contract: Contract = { version: 'x', goPrefix: 'X', definitions: d.list, pages: { home: 'U' } }
    const errors = checkContract(contract)
    expect(errors).toContain('A.missing: unknown type Nope')
    expect(errors).toContain('U: variant B must have tag: "b"')
    expect(errors).toContain('page home: U is not an object type')
  })

  it('declares both real contracts without errors', () => {
    expect(checkContract(contract1)).toEqual([])
    expect(checkContract(contract202611)).toEqual([])
  })
})
