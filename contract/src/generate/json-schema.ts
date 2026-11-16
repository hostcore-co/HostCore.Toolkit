import type { Contract, Schema } from '../dsl'

type JsonObject = Record<string, unknown>

function described(doc: string | undefined, schema: JsonObject): JsonObject {
  return doc ? { description: doc, ...schema } : schema
}

function convert(schema: Schema): JsonObject {
  switch (schema.kind) {
    case 'string':
      return described(schema.doc, schema.pattern ? { type: 'string', pattern: schema.pattern } : { type: 'string' })
    case 'number':
      return described(schema.doc, { type: 'number' })
    case 'integer':
      return described(schema.doc, { type: 'integer' })
    case 'boolean':
      return described(schema.doc, { type: 'boolean' })
    case 'literal':
      return described(schema.doc, { const: schema.value })
    case 'enum':
      if (schema.open) {
        return described(schema.doc, {
          type: 'string',
          examples: [...schema.values],
          'x-open-enum': { known: [...schema.values], fallback: schema.open.fallback },
        })
      }
      return described(schema.doc, { enum: [...schema.values] })
    case 'array':
      return described(schema.doc, { type: 'array', items: convert(schema.items) })
    case 'nullable':
      return described(schema.doc, { anyOf: [convert(schema.inner), { type: 'null' }] })
    case 'record':
      return described(schema.doc, { type: 'object', additionalProperties: convert(schema.values) })
    case 'ref':
      return described(schema.doc, { $ref: `#/$defs/${schema.name}` })
    case 'union':
      return described(schema.doc, {
        oneOf: Object.values(schema.variants).map((v) => ({ $ref: `#/$defs/${v}` })),
      })
    case 'json':
    case 'page-data':
      return described(schema.doc, {})
    case 'page-id':
      return described(schema.doc, { type: 'string' })
    case 'object': {
      const properties: JsonObject = {}
      const required: string[] = []
      for (const [name, field] of Object.entries(schema.fields)) {
        properties[name] = described(field.doc, convert(field.schema))
        if (!field.optional) required.push(name)
      }
      return described(schema.doc, { type: 'object', properties, required, additionalProperties: false })
    }
  }
}

/**
 * Renders a contract as a JSON Schema (draft 2020-12). The root accepts the
 * payload of any page; for an enveloped contract, `data` is checked against
 * the type its `page.id` names.
 */
export function generateJsonSchema(contract: Contract): JsonObject {
  const defs: JsonObject = {}
  for (const def of contract.definitions) {
    defs[def.name] = { description: `${def.name} ${def.doc}`, ...convert(def.schema) }
  }

  let root: JsonObject
  if (contract.envelope) {
    root = {
      $ref: `#/$defs/${contract.envelope}`,
      allOf: Object.entries(contract.pages).map(([page, type]) => ({
        if: { properties: { page: { properties: { id: { const: page } }, required: ['id'] } }, required: ['page'] },
        then: { properties: { data: { $ref: `#/$defs/${type}` } } },
      })),
      properties: { page: { properties: { id: { enum: Object.keys(contract.pages) } } } },
    }
  } else {
    root = { oneOf: [...new Set(Object.values(contract.pages))].map((type) => ({ $ref: `#/$defs/${type}` })) }
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Storefront page contract ${contract.version}`,
    ...root,
    $defs: defs,
  }
}
