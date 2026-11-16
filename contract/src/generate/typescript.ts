import { resolve, type Contract, type Definition, type Schema } from '../dsl'
import { GENERATED_NOTICE, wrap } from './text'

const PAGE_PARAM = 'P'

function jsdoc(text: string | undefined, indent: string): string[] {
  if (!text) return []
  const lines = wrap(text, 76 - indent.length)
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`]
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`]
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name)
}

/** Names of definitions whose TypeScript type takes the page id parameter. */
function genericDefinitions(contract: Contract): Set<string> {
  const generic = new Set<string>()
  const uses = (schema: Schema): boolean => {
    switch (schema.kind) {
      case 'page-id':
      case 'page-data':
        return true
      case 'ref':
        return generic.has(schema.name)
      case 'array':
        return uses(schema.items)
      case 'nullable':
        return uses(schema.inner)
      case 'record':
        return uses(schema.values)
      case 'object':
        return Object.values(schema.fields).some((f) => uses(f.schema))
      default:
        return false
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const def of contract.definitions) {
      if (!generic.has(def.name) && uses(def.schema)) {
        generic.add(def.name)
        changed = true
      }
    }
  }
  return generic
}

class TypeScriptWriter {
  private readonly generic: Set<string>
  usesJson = false

  constructor(private readonly contract: Contract) {
    this.generic = genericDefinitions(contract)
  }

  type(schema: Schema, indent: string): string {
    switch (schema.kind) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'literal':
        return quote(schema.value)
      case 'enum': {
        const values = schema.values.map(quote)
        if (schema.open) values.push('(string & {})')
        return values.join(' | ')
      }
      case 'array': {
        const inner = this.type(schema.items, indent)
        return /^[A-Za-z0-9_<>[\]]+$/.test(inner) ? `${inner}[]` : `Array<${inner}>`
      }
      case 'nullable':
        return `${this.type(schema.inner, indent)} | null`
      case 'record':
        return `Record<string, ${this.type(schema.values, indent)}>`
      case 'ref':
        return this.generic.has(schema.name) ? `${schema.name}<${PAGE_PARAM}>` : schema.name
      case 'union':
        return Object.values(schema.variants).join(' | ')
      case 'json':
        this.usesJson = true
        return 'JsonValue'
      case 'page-id':
        return PAGE_PARAM
      case 'page-data':
        return `PageDataMap[${PAGE_PARAM}]`
      case 'object':
        return this.objectBody(schema.fields, indent)
    }
  }

  private objectBody(fields: Record<string, { schema: Schema; optional: boolean; doc?: string }>, indent: string): string {
    const entries = Object.entries(fields)
    if (entries.length === 0) return 'Record<string, never>'
    const inner = `${indent}  `
    const lines = ['{']
    for (const [name, field] of entries) {
      lines.push(...jsdoc(field.doc, inner))
      lines.push(`${inner}${propertyKey(name)}${field.optional ? '?' : ''}: ${this.type(field.schema, inner)}`)
    }
    lines.push(`${indent}}`)
    return lines.join('\n')
  }

  definition(def: Definition): string[] {
    const out = jsdoc(`${def.name} ${def.doc}`, '')
    const params = this.generic.has(def.name) ? `<${PAGE_PARAM} extends ContractPageId = ContractPageId>` : ''
    const schema = def.schema

    if (schema.kind === 'object') {
      const own = { ...schema.fields }
      let heritage = ''
      if (schema.base) {
        const base = resolve(this.contract, schema.base).schema
        if (base.kind === 'object') {
          for (const [name, field] of Object.entries(base.fields)) {
            if (JSON.stringify(own[name]) === JSON.stringify(field)) delete own[name]
          }
        }
        heritage = ` extends ${schema.base}`
      }
      if (Object.keys(schema.fields).length === 0) {
        out.push(`export type ${def.name}${params} = Record<string, never>`)
      } else {
        out.push(`export interface ${def.name}${params}${heritage} ${this.objectBody(own, '')}`)
      }
      return out
    }

    out.push(`export type ${def.name}${params} = ${this.type(schema, '')}`)
    if (schema.kind === 'enum') {
      out.push('')
      out.push(`export const ${def.name}Values = [${schema.values.map(quote).join(', ')}] as const`)
      if (schema.open) {
        out.push('')
        out.push(...jsdoc(`${def.name}Fallback is what a contract that does not know a ${def.name} value receives in its place.`, ''))
        out.push(`export const ${def.name}Fallback = ${quote(schema.open.fallback)}`)
      }
    }
    return out
  }
}

/** Renders a contract as a self-contained TypeScript module. */
export function generateTypeScript(contract: Contract, intro: string): string {
  const writer = new TypeScriptWriter(contract)
  const body: string[] = []

  body.push(`export const CONTRACT_VERSION = ${quote(contract.version)}`)
  body.push('')
  for (const def of contract.definitions) {
    body.push(...writer.definition(def))
    body.push('')
  }

  body.push(...jsdoc('PageDataMap maps each page id to the type of its data.', ''))
  body.push('export interface PageDataMap {')
  for (const [page, type] of Object.entries(contract.pages)) body.push(`  ${propertyKey(page)}: ${type}`)
  body.push('}')
  body.push('')
  body.push(...jsdoc('ContractPageId is a page that carries data in this contract.', ''))
  body.push('export type ContractPageId = keyof PageDataMap')
  body.push('')
  if (contract.envelope) {
    body.push(...jsdoc(`Any${contract.envelope} is a ${contract.envelope} for any page.`, ''))
    body.push(
      `export type Any${contract.envelope} = { [${PAGE_PARAM} in ContractPageId]: ${contract.envelope}<${PAGE_PARAM}> }[ContractPageId]`,
    )
    body.push('')
  }

  const head = ['// ' + GENERATED_NOTICE, '//', ...wrap(intro, 76).map((l) => `// ${l}`), '']
  if (writer.usesJson) {
    head.push(...jsdoc('JsonValue is any value JSON can carry.', ''))
    head.push(
      'export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }',
      '',
    )
  }
  return [...head, ...body].join('\n').replace(/\n+$/, '\n')
}
