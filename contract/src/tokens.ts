/**
 * Design tokens: the named values a template styles itself with.
 *
 * The rendering engine writes each token to a CSS custom property on `:root`
 * (and `:host`). effectiveTokens below gives each token's value from the
 * template's own `tokens` in template.json and the store's theme:
 *
 * - a store theme colour the owner has changed from the platform default
 *   palette (PLATFORM_THEME) overrides the template's `color.*` token;
 * - a colour the store has never changed gives way to the template's token;
 * - where the template declares no value either, the colour is the platform
 *   default.
 *
 * The other tokens (radius, font, space) are the template's value where it
 * declares one, and otherwise a platform default the rendering engine sets.
 */

export type TokenKind = 'color' | 'radius' | 'font' | 'space'

export interface TokenDefinition {
  name: string
  property: string
  kind: TokenKind
  /**
   * The store theme colour this token corresponds to, for the eight
   * colours. It overrides the template's value once the store has changed it
   * from the platform default.
   */
  theme_key?: string
}

/** Patterns written to work the same in JavaScript and Go. */
export const TOKEN_PATTERNS: Record<TokenKind, string> = {
  color: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
  font: '^[A-Za-z0-9 ,\'"-]{1,200}$',
  radius: '^[0-9]+(\\.[0-9]+)?(px|rem)$',
  space: '^[0-9]+(\\.[0-9]+)?(px|rem)$',
}

/** The eight colours of a store's theme. */
export const THEME_KEYS = [
  'background',
  'surface',
  'surface_raised',
  'border',
  'text',
  'text_muted',
  'accent',
  'accent_strong',
] as const

export type ThemeKey = (typeof THEME_KEYS)[number]

const colour = (key: ThemeKey): TokenDefinition => ({
  name: `color.${key.replace(/_/g, '-')}`,
  property: `--hc-${key.replace(/_/g, '-')}`,
  kind: 'color',
  theme_key: key,
})

export const TOKENS: readonly TokenDefinition[] = [
  ...THEME_KEYS.map(colour),
  { name: 'radius.sm', property: '--hc-radius-sm', kind: 'radius' },
  { name: 'radius.md', property: '--hc-radius-md', kind: 'radius' },
  { name: 'radius.lg', property: '--hc-radius-lg', kind: 'radius' },
  { name: 'font.body', property: '--hc-font-body', kind: 'font' },
  { name: 'font.heading', property: '--hc-font-heading', kind: 'font' },
  { name: 'space.unit', property: '--hc-space-unit', kind: 'space' },
]

/** The design token each store theme colour corresponds to, such as `accent` → `color.accent`. */
export const THEME_TOKENS: Readonly<Record<ThemeKey, string>> = Object.fromEntries(
  THEME_KEYS.map((key) => [key, colour(key).name]),
) as Record<ThemeKey, string>

/**
 * The platform default palette. Every store has all eight colours set, to
 * these until its owner changes one; a colour equal to its default (compared
 * without regard to case) counts as unchanged.
 */
export const PLATFORM_THEME: Readonly<Record<ThemeKey, string>> = {
  background: '#141517',
  surface: '#111214',
  surface_raised: '#191A1C',
  border: '#27282A',
  text: '#FFFFFF',
  text_muted: '#A2A3A7',
  accent: '#34D0FF',
  accent_strong: '#1F9DFF',
}

/**
 * The value of every token that has one, by token name, in TOKENS order,
 * from a template's `tokens` and a store's theme.
 *
 * Each of the eight colours is the store's colour when the store has changed
 * it: it is a hex colour (`#rgb` or `#rrggbb`) that differs from its
 * PLATFORM_THEME value when both are lowercased. Otherwise it is the
 * template's value for the token, or the PLATFORM_THEME value where the
 * template has none. A theme colour that is missing, empty or not a hex
 * colour counts as unchanged. The other tokens appear only where the
 * template sets them; keys of `template` that are not tokens are ignored.
 */
export function effectiveTokens(
  template: Readonly<Record<string, string>>,
  theme?: Readonly<Partial<Record<ThemeKey, string>>> | null,
): Record<string, string> {
  const hex = new RegExp(TOKEN_PATTERNS.color)
  const values: Record<string, string> = {}
  for (const token of TOKENS) {
    const own = Object.prototype.hasOwnProperty.call(template, token.name) ? template[token.name] : undefined
    const key = token.theme_key as ThemeKey | undefined
    if (key === undefined) {
      if (typeof own === 'string') values[token.name] = own
      continue
    }
    const fallback = PLATFORM_THEME[key]
    const store = theme && Object.prototype.hasOwnProperty.call(theme, key) ? theme[key] : undefined
    const changed = typeof store === 'string' && hex.test(store) && store.toLowerCase() !== fallback.toLowerCase()
    values[token.name] = changed ? store : typeof own === 'string' ? own : fallback
  }
  return values
}

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
