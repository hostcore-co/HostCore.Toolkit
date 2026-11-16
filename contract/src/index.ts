/**
 * The page data contract, for tools: the runtime validator, the reference
 * downgrade, path matching, and the setting and token rules.
 *
 * Templates import their types from `@hostcore/toolkit` instead.
 */

export { validate, validateType, CONTRACTS, type ValidationError, type ValidateOptions } from './validate'
export { downgrade, DowngradeError } from './downgrade'
export { matchRoute, type PathMatch, type RoutePage } from './match'
export {
  matchRegistryPath,
  normaliseRegistry,
  readRegistry,
  validateRegistry,
  type NormalisedRegistry,
  type Registry,
  type RegistryPage,
} from './registry'
export {
  STANDARD_SETTINGS,
  settingValueError,
  standardSetting,
  validateSettingSchema,
  type SettingSchemaEntry,
  type SettingType,
  type SettingValue,
} from './settings'
export { TOKENS, TOKEN_PATTERNS, validateTokens, type TokenDefinition, type TokenKind } from './tokens'
export type { Contract, Schema } from './dsl'
