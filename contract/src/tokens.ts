/**
 * Design tokens: the named values a template styles itself with.
 *
 * The rendering engine writes each token to a CSS custom property on `:root`
 * (and `:host`). A value is resolved in this order, last one winning: the
 * platform default, the template's own `tokens` in template.json, then the
 * store's theme, which sets the eight colours.
 */

export type TokenKind = 'color' | 'radius' | 'font' | 'space'

export interface TokenDefinition {
  name: string
  property: string
  kind: TokenKind
  /** The store theme key that overrides this token, for the eight colours. */
  theme_key?: string
}

/** Patterns written to work the same in JavaScript and Go. */
export const TOKEN_PATTERNS: Record<TokenKind, string> = {
  color: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$',
  font: '^[A-Za-z0-9 ,\'"-]{1,200}$',
  radius: '^[0-9]+(\\.[0-9]+)?(px|rem)$',
  space: '^[0-9]+(\\.[0-9]+)?(px|rem)$',
}

const colour = (key: string): TokenDefinition => ({
  name: `color.${key.replace(/_/g, '-')}`,
  property: `--hc-${key.replace(/_/g, '-')}`,
  kind: 'color',
  theme_key: key,
})

export const TOKENS: readonly TokenDefinition[] = [
  colour('background'),
  colour('surface'),
  colour('surface_raised'),
  colour('border'),
  colour('text'),
  colour('text_muted'),
  colour('accent'),
  colour('accent_strong'),
  { name: 'radius.sm', property: '--hc-radius-sm', kind: 'radius' },
  { name: 'radius.md', property: '--hc-radius-md', kind: 'radius' },
  { name: 'radius.lg', property: '--hc-radius-lg', kind: 'radius' },
  { name: 'font.body', property: '--hc-font-body', kind: 'font' },
  { name: 'font.heading', property: '--hc-font-heading', kind: 'font' },
  { name: 'space.unit', property: '--hc-space-unit', kind: 'space' },
]

/** Checks a template's `tokens` object. Returns one message per problem. */
export function validateTokens(tokens: unknown): string[] {
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
    return ['tokens must be an object']
  }
  const errors: string[] = []
  for (const [name, value] of Object.entries(tokens)) {
    const token = TOKENS.find((t) => t.name === name)
    if (!token) {
      errors.push(`tokens.${name} is not a design token`)
      continue
    }
    if (typeof value !== 'string' || !new RegExp(TOKEN_PATTERNS[token.kind]).test(value)) {
      errors.push(`tokens.${name} must match ${TOKEN_PATTERNS[token.kind]}`)
    }
  }
  return errors
}
