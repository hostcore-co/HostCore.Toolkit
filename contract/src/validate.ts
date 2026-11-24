import { resolve, type Contract, type Schema } from './dsl'
import { contract1 } from './contract-1'
import { contract202611 } from './contract-2026-11'

export interface ValidationError {
  /** Where the problem is, as `$.data.plans[0].price`. */
  path: string
  message: string
}

export interface ValidateOptions {
  /**
   * Accept keys the contract does not declare. Off by default, so fixtures
   * and tests catch a misspelt key; turn it on to check a payload from a
   * newer platform, which may carry additive fields.
   */
  allowUnknownKeys?: boolean
}

export const CONTRACTS: Record<string, Contract> = {
  '1': contract1,
  '2026-11': contract202611,
}

export function contractFor(version: string): Contract {
  const contract = CONTRACTS[version]
  if (!contract) throw new Error(`unknown contract ${JSON.stringify(version)}`)
  return contract
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value)}`
}

class Validator {
  readonly errors: ValidationError[] = []

  constructor(
    private readonly contract: Contract,
    private readonly pageId: string,
    private readonly options: ValidateOptions,
  ) {}

  private fail(path: string, message: string): void {
    this.errors.push({ path, message })
  }

  check(schema: Schema, value: unknown, path: string): void {
    switch (schema.kind) {
      case 'string':
        if (typeof value !== 'string') return this.fail(path, `expected a string, got ${describe(value)}`)
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
          this.fail(path, `must match ${schema.pattern}`)
        }
        return
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          this.fail(path, `expected a number, got ${describe(value)}`)
        }
        return
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          this.fail(path, `expected an integer, got ${describe(value)}`)
        }
        return
      case 'boolean':
        if (typeof value !== 'boolean') this.fail(path, `expected a boolean, got ${describe(value)}`)
        return
      case 'literal':
        if (value !== schema.value) this.fail(path, `expected ${JSON.stringify(schema.value)}, got ${describe(value)}`)
        return
      case 'enum':
        if (typeof value !== 'string') return this.fail(path, `expected a string, got ${describe(value)}`)
        if (!schema.open && !schema.values.includes(value)) {
          this.fail(path, `expected one of ${schema.values.join(', ')}, got ${JSON.stringify(value)}`)
        }
        return
      case 'array':
        if (!Array.isArray(value)) return this.fail(path, `expected an array, got ${describe(value)}`)
        value.forEach((item, i) => this.check(schema.items, item, `${path}[${i}]`))
        return
      case 'nullable':
        if (value !== null) this.check(schema.inner, value, path)
        return
      case 'record':
        if (!isRecord(value)) return this.fail(path, `expected an object, got ${describe(value)}`)
        for (const [key, item] of Object.entries(value)) this.check(schema.values, item, `${path}[${JSON.stringify(key)}]`)
        return
      case 'object': {
        if (!isRecord(value)) return this.fail(path, `expected an object, got ${describe(value)}`)
        for (const [key, field] of Object.entries(schema.fields)) {
          if (!(key in value) || value[key] === undefined) {
            if (!field.optional) this.fail(`${path}.${key}`, 'is required')
            continue
          }
          this.check(field.schema, value[key], `${path}.${key}`)
        }
        if (!this.options.allowUnknownKeys) {
          for (const key of Object.keys(value)) {
            if (!(key in schema.fields)) this.fail(`${path}.${key}`, 'is not part of the contract')
          }
        }
        return
      }
      case 'ref':
        return this.check(resolve(this.contract, schema.name).schema, value, path)
      case 'union': {
        if (!isRecord(value)) return this.fail(path, `expected an object, got ${describe(value)}`)
        const tag = value[schema.tag]
        const variant = typeof tag === 'string' ? schema.variants[tag] : undefined
        if (!variant) {
          return this.fail(`${path}.${schema.tag}`, `expected one of ${Object.keys(schema.variants).join(', ')}`)
        }
        return this.check(resolve(this.contract, variant).schema, value, path)
      }
      case 'json':
        return this.checkJson(value, path)
      case 'page-id':
        if (value !== this.pageId) this.fail(path, `expected ${JSON.stringify(this.pageId)}, got ${describe(value)}`)
        return
      case 'page-data': {
        const type = this.contract.pages[this.pageId]
        if (!type) return this.fail(path, `contract ${this.contract.version} has no page ${this.pageId}`)
        return this.check(resolve(this.contract, type).schema, value, path)
      }
    }
  }

  private checkJson(value: unknown, path: string): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) this.fail(path, 'expected a finite number')
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => this.checkJson(item, `${path}[${i}]`))
      return
    }
    if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) this.checkJson(item, `${path}[${JSON.stringify(key)}]`)
      return
    }
    this.fail(path, `expected a JSON value, got ${describe(value)}`)
  }
}

/**
 * Checks a page payload against a contract. `pageId` is the registry id of
 * the page (`catalog.service`, not contract "1"'s `service`). Returns every
 * problem found; an empty array means the payload is valid.
 */
export function validate(
  contract: string,
  pageId: string,
  value: unknown,
  options: ValidateOptions = {},
): ValidationError[] {
  const c = contractFor(contract)
  const type = c.pages[pageId]
  if (!type) return [{ path: '$', message: `contract ${contract} has no page ${pageId}` }]
  const validator = new Validator(c, pageId, options)
  validator.check(resolve(c, c.envelope ?? type).schema, value, '$')
  return validator.errors
}

/** Checks a value against one named type of a contract. */
export function validateType(
  contract: string,
  typeName: string,
  value: unknown,
  options: ValidateOptions = {},
): ValidationError[] {
  const c = contractFor(contract)
  const validator = new Validator(c, '', options)
  validator.check(resolve(c, typeName).schema, value, '$')
  return validator.errors
}
