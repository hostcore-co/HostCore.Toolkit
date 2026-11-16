import { PLATFORM_THEME, type ThemeKey } from './tokens'

/**
 * The cases of effectiveTokens, published as `fixtures/tokens.json` so every
 * implementation can be tested against the same table. Each case gives a
 * template's `tokens`, a store's theme and the tokens that result, by name.
 * `hct contract generate` writes the file and checks each case against
 * effectiveTokens.
 */

export interface TokenCase {
  name: string
  template: Record<string, string>
  theme: Partial<Record<ThemeKey, string>>
  tokens: Record<string, string>
}

const DEFAULTS = {
  'color.background': '#141517',
  'color.surface': '#111214',
  'color.surface-raised': '#191A1C',
  'color.border': '#27282A',
  'color.text': '#FFFFFF',
  'color.text-muted': '#A2A3A7',
  'color.accent': '#34D0FF',
  'color.accent-strong': '#1F9DFF',
}

export const TOKEN_CASES: readonly TokenCase[] = [
  {
    name: 'a colour the store has not changed follows the template',
    template: { 'color.accent': '#5b8cff', 'color.background': '#ffffff', 'radius.md': '0.5rem' },
    theme: { ...PLATFORM_THEME },
    tokens: { ...DEFAULTS, 'color.background': '#ffffff', 'color.accent': '#5b8cff', 'radius.md': '0.5rem' },
  },
  {
    name: 'a colour the store has changed overrides the template',
    template: { 'color.accent': '#5b8cff', 'color.background': '#ffffff' },
    theme: { ...PLATFORM_THEME, accent: '#ff5500' },
    tokens: { ...DEFAULTS, 'color.background': '#ffffff', 'color.accent': '#ff5500' },
  },
  {
    name: 'where the template declares no colour, the platform default applies',
    template: {},
    theme: { ...PLATFORM_THEME },
    tokens: { ...DEFAULTS },
  },
  {
    name: 'a colour the store has changed applies where the template declares none',
    template: { 'font.body': 'Inter, system-ui, sans-serif' },
    theme: { ...PLATFORM_THEME, border: '#333', text_muted: '#8a8f98' },
    tokens: { ...DEFAULTS, 'color.border': '#333', 'color.text-muted': '#8a8f98', 'font.body': 'Inter, system-ui, sans-serif' },
  },
  {
    name: 'a colour is compared with its default without regard to case',
    template: { 'color.text': '#111111', 'color.accent': '#5b8cff' },
    theme: { ...PLATFORM_THEME, text: '#ffffff', accent: '#34d0ff' },
    tokens: { ...DEFAULTS, 'color.text': '#111111', 'color.accent': '#5b8cff' },
  },
  {
    name: 'a colour is compared as written, so a short form of the default counts as changed',
    template: { 'color.text': '#111111' },
    theme: { ...PLATFORM_THEME, text: '#fff' },
    tokens: { ...DEFAULTS, 'color.text': '#fff' },
  },
  {
    name: 'a theme colour that is missing, empty or not a hex colour counts as unchanged',
    template: { 'color.accent': '#5b8cff', 'color.surface': '#eeeeee', 'color.border': '#cccccc' },
    theme: { background: '#141517', surface: '', border: 'red', text: '#FFFFFF' },
    tokens: { ...DEFAULTS, 'color.accent': '#5b8cff', 'color.surface': '#eeeeee', 'color.border': '#cccccc' },
  },
  {
    name: 'every token the template sets is kept',
    template: {
      'color.accent-strong': '#3d6fe6',
      'radius.sm': '2px',
      'radius.md': '0.75rem',
      'radius.lg': '1rem',
      'font.body': '"Inter", system-ui, sans-serif',
      'font.heading': '"Space Grotesk", system-ui, sans-serif',
      'space.unit': '4px',
    },
    theme: { ...PLATFORM_THEME },
    tokens: {
      ...DEFAULTS,
      'color.accent-strong': '#3d6fe6',
      'radius.sm': '2px',
      'radius.md': '0.75rem',
      'radius.lg': '1rem',
      'font.body': '"Inter", system-ui, sans-serif',
      'font.heading': '"Space Grotesk", system-ui, sans-serif',
      'space.unit': '4px',
    },
  },
]
