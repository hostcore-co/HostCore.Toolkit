/**
 * A small schema language for the template data contract.
 *
 * Every shape a template can receive is declared once with these
 * constructors. The TypeScript types, Go structs, JSON Schemas and the
 * runtime validator are all generated from the same declarations, so they
 * cannot disagree with each other.
 *
 * Schemas are plain data. Field order is significant: it is the order the
 * generated Go structs and TypeScript interfaces list their fields in.
 */

export type Schema =
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | LiteralSchema
  | EnumSchema
  | ArraySchema
  | NullableSchema
  | ObjectSchema
  | RecordSchema
  | RefSchema
  | UnionSchema
  | JsonSchemaValue
  | PageIdSchema
  | PageDataSchema

interface Described {
  /** A full sentence or two for the reader of the generated types. */
  doc?: string
}

export interface StringSchema extends Described {
  kind: 'string'
  /** A regular expression the value must match, written to work in both JavaScript and Go. */
  pattern?: string
}

export interface NumberSchema extends Described {
  kind: 'number'
}

export interface IntegerSchema extends Described {
  kind: 'integer'
  /** 64 when values can exceed 32 bits. Changes only the generated Go type. */
  bits?: 32 | 64
}

export interface BooleanSchema extends Described {
  kind: 'boolean'
}

export interface LiteralSchema extends Described {
  kind: 'literal'
  value: string
}

/**
 * A set of string values. A closed enum rejects anything else. An open enum
 * accepts any string, and names the fallback an older contract receives in
 * place of a value it does not know.
 */
export interface EnumSchema extends Described {
  kind: 'enum'
  values: readonly string[]
  open?: { fallback: string }
}

export interface ArraySchema extends Described {
  kind: 'array'
  items: Schema
}

export interface NullableSchema extends Described {
  kind: 'nullable'
  inner: Schema
}

export interface Field {
  schema: Schema
  /**
   * The key may be absent. In Go this is `omitempty`: the key is left out
   * whenever the value is the zero value of its type.
   */
  optional: boolean
  doc?: string
  /** Overrides the generated Go field name. */
  goName?: string
}

export interface ObjectSchema extends Described {
  kind: 'object'
  fields: Record<string, Field>
  /**
   * The named object this one extends. Its fields are already merged into
   * `fields`; generators use the name to emit `extends` and Go embedding.
   */
  base?: string
}

export interface RecordSchema extends Described {
  kind: 'record'
  values: Schema
}

export interface RefSchema extends Described {
  kind: 'ref'
  name: string
}

/** Named objects told apart by a literal-typed field they all carry. */
export interface UnionSchema extends Described {
  kind: 'union'
  tag: string
  variants: Record<string, string>
}

/** Any JSON value. */
export interface JsonSchemaValue extends Described {
  kind: 'json'
}

/** The id of a page that carries data in a contract. */
export interface PageIdSchema extends Described {
  kind: 'page-id'
}

/** The page-specific data whose shape is chosen by the envelope's page id. */
export interface PageDataSchema extends Described {
  kind: 'page-data'
}

export interface Definition {
  name: string
  schema: Schema
  /** Read after the name: "Price is …". */
  doc: string
}

export interface Contract {
  version: string
  /** Prefix for generated Go identifiers, so contracts can share a package. */
  goPrefix: string
  /** Named types in declaration order. */
  definitions: Definition[]
  /** Registry page id → the named type its payload (or its `data`) has. */
  pages: Record<string, string>
  /** The named type a whole response has, when it is not the page type itself. */
  envelope?: string
  /**
   * Named types a template sends rather than reads, such as a request body.
   * A change to one is classified the other way round from data a template
   * reads: a field becoming required breaks it.
   */
  inputs?: readonly string[]
}

// ─── Constructors ──────────────────────────────────────────────────────────

const string = (opts: { pattern?: string } = {}): StringSchema => ({ kind: 'string', ...opts })
const number = (): NumberSchema => ({ kind: 'number' })
const integer = (opts: { bits?: 32 | 64 } = {}): IntegerSchema => ({ kind: 'integer', ...opts })
const boolean = (): BooleanSchema => ({ kind: 'boolean' })
const literal = (value: string): LiteralSchema => ({ kind: 'literal', value })
const enumOf = (values: readonly string[]): EnumSchema => ({ kind: 'enum', values })
const openEnum = (values: readonly string[], fallback: string): EnumSchema => {
  if (!values.includes(fallback)) {
    throw new Error(`open enum fallback ${JSON.stringify(fallback)} is not one of its values`)
  }
  return { kind: 'enum', values, open: { fallback } }
}
const array = (items: Schema): ArraySchema => ({ kind: 'array', items })
const nullable = (inner: Schema): NullableSchema => ({ kind: 'nullable', inner })
const record = (values: Schema): RecordSchema => ({ kind: 'record', values })
const ref = (name: string): RefSchema => ({ kind: 'ref', name })
const json = (): JsonSchemaValue => ({ kind: 'json' })
const pageId = (): PageIdSchema => ({ kind: 'page-id' })
const pageData = (): PageDataSchema => ({ kind: 'page-data' })
const union = (tag: string, variants: Record<string, string>): UnionSchema => ({
  kind: 'union',
  tag,
  variants,
})

type FieldInput = Schema | Field

function isField(input: FieldInput): input is Field {
  return 'schema' in input && 'optional' in input
}

function toFields(input: Record<string, FieldInput>): Record<string, Field> {
  const out: Record<string, Field> = {}
  for (const [name, value] of Object.entries(input)) {
    out[name] = isField(value) ? value : { schema: value, optional: false, ...(value.doc ? { doc: value.doc } : {}) }
  }
  return out
}

const object = (fields: Record<string, FieldInput>): ObjectSchema => ({
  kind: 'object',
  fields: toFields(fields),
})

/** A field whose key may be absent (Go `omitempty`). */
const optional = (schema: Schema): Field => ({ schema, optional: true, ...(schema.doc ? { doc: schema.doc } : {}) })

/** Attaches a description to a schema or a field. */
function doc<T extends Schema | Field>(text: string, target: T): T {
  return { ...target, doc: text }
}

/** Overrides the Go name generated for a field. */
function goName(name: string, target: FieldInput): Field {
  const field = isField(target) ? target : { schema: target, optional: false, ...(target.doc ? { doc: target.doc } : {}) }
  return { ...field, goName: name }
}

export const t = {
  string,
  number,
  integer,
  boolean,
  literal,
  enum: enumOf,
  openEnum,
  array,
  nullable,
  record,
  ref,
  json,
  pageId,
  pageData,
  union,
  object,
  optional,
  doc,
  goName,
}

/**
 * Collects named definitions in order. `extend` builds an object from a
 * named base plus its own fields; a field the base already has may be
 * redeclared only to narrow it (a literal in place of an enum, say).
 */
export class Definitions {
  readonly list: Definition[] = []

  define(name: string, doc: string, schema: Schema): RefSchema {
    if (this.list.some((d) => d.name === name)) {
      throw new Error(`definition ${name} is declared twice`)
    }
    this.list.push({ name, doc, schema })
    return ref(name)
  }

  extend(name: string, doc: string, base: string, fields: Record<string, FieldInput>): RefSchema {
    const parent = this.get(base)
    if (parent.schema.kind !== 'object') throw new Error(`${name} extends ${base}, which is not an object`)
    const own = toFields(fields)
    return this.define(name, doc, {
      kind: 'object',
      base,
      fields: { ...parent.schema.fields, ...own },
    })
  }

  get(name: string): Definition {
    const found = this.list.find((d) => d.name === name)
    if (!found) throw new Error(`unknown definition ${name}`)
    return found
  }
}

/** Looks up a named definition in a contract. */
export function resolve(contract: Contract, name: string): Definition {
  const found = contract.definitions.find((d) => d.name === name)
  if (!found) throw new Error(`contract ${contract.version} has no definition ${name}`)
  return found
}

/**
 * Checks that every reference resolves, every union variant is an object
 * with a literal tag, and every page names an object type.
 */
export function checkContract(contract: Contract): string[] {
  const errors: string[] = []
  const names = new Set(contract.definitions.map((d) => d.name))

  const visit = (schema: Schema, at: string): void => {
    switch (schema.kind) {
      case 'ref':
        if (!names.has(schema.name)) errors.push(`${at}: unknown type ${schema.name}`)
        return
      case 'array':
        return visit(schema.items, `${at}[]`)
      case 'nullable':
        return visit(schema.inner, at)
      case 'record':
        return visit(schema.values, `${at}{}`)
      case 'object':
        for (const [key, field] of Object.entries(schema.fields)) visit(field.schema, `${at}.${key}`)
        return
      case 'union':
        for (const [tag, variant] of Object.entries(schema.variants)) {
          const def = contract.definitions.find((d) => d.name === variant)
          if (!def) {
            errors.push(`${at}: unknown union variant ${variant}`)
            continue
          }
          const tagField = def.schema.kind === 'object' ? def.schema.fields[schema.tag] : undefined
          if (!tagField || tagField.schema.kind !== 'literal' || tagField.schema.value !== tag) {
            errors.push(`${at}: variant ${variant} must have ${schema.tag}: "${tag}"`)
          }
        }
        return
      default:
        return
    }
  }

  for (const def of contract.definitions) visit(def.schema, def.name)
  for (const [page, type] of Object.entries(contract.pages)) {
    const def = contract.definitions.find((d) => d.name === type)
    if (!def || def.schema.kind !== 'object') errors.push(`page ${page}: ${type} is not an object type`)
  }
  if (contract.envelope && !names.has(contract.envelope)) {
    errors.push(`envelope ${contract.envelope} is not defined`)
  }
  return errors
}
