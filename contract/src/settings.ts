/**
 * Template settings: the values a store edits for the template it runs.
 *
 * A template declares its settings in template.json. The platform stores a
 * value per store under each setting id, and a page receives them in the
 * envelope's `settings`. When a store switches template, values whose id and
 * type both match carry over.
 *
 * The standard settings below are the well-known ids every store has. The
 * built-in default template declares exactly this set, and contract "1"
 * payloads rebuild their `content` from them.
 */

export const SETTING_TYPES = [
  'text',
  'textarea',
  'url',
  'link',
  'color',
  'boolean',
  'number',
  'select',
  'image',
  'list',
  'object-list',
] as const

export type SettingType = (typeof SETTING_TYPES)[number]

/** The types a `list` holds, and the types an `object-list` field may have. */
export const SETTING_SCALAR_TYPES = ['text', 'textarea', 'url', 'color', 'image', 'boolean', 'number'] as const

export type SettingScalarType = (typeof SETTING_SCALAR_TYPES)[number]

export interface SettingLink {
  label: string
  href: string
}

export type SettingValue =
  | string
  | number
  | boolean
  | SettingLink
  | string[]
  | Array<Record<string, string | number | boolean>>

export interface SettingOption {
  value: string
  label: string
}

/**
 * One field of each entry of an object-list setting. A field takes the same
 * optional keys as a top-level setting of its type.
 */
export interface SettingField {
  id: string
  type: SettingScalarType
  label?: string
  /** Help text shown beside the field in the editor. */
  description?: string
  /** Characters for text types; the largest value for numbers. */
  max?: number
  /** The smallest value, for numbers. */
  min?: number
  /** The increment a number moves in, counted from `min` (or zero). */
  step?: number
}

export interface SettingSchemaEntry {
  /** Lowercase words joined by dots, such as `hero.title`. */
  id: string
  type: SettingType
  label?: string
  /** Help text shown beside the setting in the editor. */
  description?: string
  /**
   * Characters for text types; for a link, the characters of its label (and
   * of its href too when `href_max` is absent); entries for lists; the
   * largest value for numbers.
   */
  max?: number
  /** Characters of a link's href. Without it, `max` limits the href as well. */
  href_max?: number
  /** The smallest value, for numbers. */
  min?: number
  /** The increment a number moves in, counted from `min` (or zero). */
  step?: number
  /** What a `list` holds. */
  of?: SettingScalarType
  /** Characters of each text item of a `list`. */
  item_max?: number
  /** The fields of each `object-list` entry. */
  fields?: SettingField[]
  /** The choices of a `select`. */
  options?: SettingOption[]
  /** What a store that has not set the value gets. */
  default?: SettingValue
}

export const SETTING_ID_PATTERN = '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)*$'
export const SETTING_FIELD_ID_PATTERN = '^[a-z][a-z0-9_]*$'
/** A colour is `#rgb` or `#rrggbb`. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const STANDARD_SETTINGS: readonly SettingSchemaEntry[] = [
  { id: 'hero.title', type: 'text', label: 'Headline', max: 160, default: 'Game servers and web hosting, online in minutes' },
  {
    id: 'hero.subtitle',
    type: 'text',
    label: 'Subheading',
    max: 600,
    default:
      'Fast hardware, DDoS protection and automatic setup, with a control panel that puts you in charge of everything you run with us.',
  },
  {
    id: 'hero.highlights',
    type: 'list',
    of: 'text',
    label: 'Highlights',
    max: 6,
    item_max: 160,
    default: ['Online in minutes', 'DDoS protection included', 'Support around the clock'],
  },
  {
    id: 'hero.primary_cta',
    type: 'link',
    label: 'Primary button',
    max: 160,
    href_max: 600,
    default: { label: 'Browse plans', href: '/' },
  },
  {
    id: 'hero.secondary_cta',
    type: 'link',
    label: 'Secondary button',
    max: 160,
    href_max: 600,
    default: { label: 'Find a domain', href: '/domains' },
  },
  { id: 'categories.title', type: 'text', label: 'Categories heading', max: 160, default: 'What we host' },
  {
    id: 'categories.subtitle',
    type: 'text',
    label: 'Categories subheading',
    max: 600,
    default: 'Game servers, web hosting and everything you need to run them.',
  },
  { id: 'features.title', type: 'text', label: 'Features heading', max: 160, default: 'Why host with us' },
  {
    id: 'features.subtitle',
    type: 'text',
    label: 'Features subheading',
    max: 600,
    default: 'The things you would want from a host, standard on every plan.',
  },
  {
    id: 'features.cards',
    type: 'object-list',
    label: 'Feature cards',
    max: 12,
    fields: [
      { id: 'title', type: 'text', label: 'Title', max: 160 },
      { id: 'description', type: 'text', label: 'Description', max: 600 },
    ],
    default: [
      {
        title: 'Online in minutes',
        description: 'Your service is set up automatically the moment your payment clears. No queue, no waiting on a technician.',
      },
      {
        title: 'Hardware built for low latency',
        description:
          'Current-generation CPUs and NVMe storage, on networks chosen for the routes your players and visitors actually take.',
      },
      {
        title: 'DDoS protection as standard',
        description: 'Always-on filtering across the whole network, included at no extra cost rather than sold as an upgrade.',
      },
      {
        title: 'Full control of your service',
        description: 'Start, stop, reinstall, back up and reconfigure whenever you like, straight from your control panel.',
      },
      {
        title: 'One-click mods and apps',
        description: 'Modpacks, plugins and the web applications you already use install in a couple of clicks.',
      },
      {
        title: 'Support that answers',
        description: 'Real people on tickets at any hour, whether it is a config question or something genuinely broken.',
      },
    ],
  },
  { id: 'faq.title', type: 'text', label: 'FAQ heading', max: 160, default: 'Frequently asked questions' },
  { id: 'faq.subtitle', type: 'text', label: 'FAQ subheading', max: 600, default: '' },
  {
    id: 'faq.items',
    type: 'object-list',
    label: 'Questions',
    max: 24,
    fields: [
      { id: 'question', type: 'text', label: 'Question', max: 600 },
      { id: 'answer', type: 'textarea', label: 'Answer', max: 2000 },
    ],
    default: [
      {
        question: 'How quickly will my server be ready?',
        answer:
          'Usually within a few minutes. Setup runs automatically as soon as your payment clears and your login details are emailed to you.',
      },
      {
        question: 'Can I change plan later?',
        answer:
          'Yes. Upgrade or downgrade from your client area whenever you need to and your next invoice is adjusted to match.',
      },
      {
        question: 'Can I move an existing server or site to you?',
        answer: 'Yes. Open a ticket telling us what you are running now and our team will help you move it across.',
      },
      {
        question: 'How do backups work?',
        answer:
          'You can take a backup from your control panel whenever you like. What is kept automatically depends on the plan you choose.',
      },
      {
        question: 'What if something goes wrong?',
        answer:
          'Open a ticket from your client area at any hour. Support handles setup problems, migrations and anything that stops working.',
      },
    ],
  },
]

export function standardSetting(id: string): SettingSchemaEntry {
  const found = STANDARD_SETTINGS.find((s) => s.id === id)
  if (!found) throw new Error(`${id} is not a standard setting`)
  return found
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TEXT_TYPES = new Set(['text', 'textarea', 'url', 'image'])

interface Bounds {
  max?: number
  min?: number
  step?: number
}

function textError(max: number | undefined, value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string'
  if (max !== undefined && [...value].length > max) return `must be at most ${max} characters`
  return null
}

/** Whether `value` is a whole number of `step`s from `base`, allowing for float rounding. */
function onStep(value: number, base: number, step: number): boolean {
  const steps = (value - base) / step
  return Math.abs(steps - Math.round(steps)) < 1e-9
}

/**
 * What the link rule applies to: the href of a `link` setting, and the value
 * of a `url` or `image` setting, list item or object-list field.
 */
export type LinkKind = 'link' | 'url' | 'image'

/** Why a link's href is refused. */
export const LINK_HREF_RULE = 'must be a path on this site starting with a single /, a #fragment of this page or an https:// URL'
/** Why a url or image is refused. */
export const LINK_URL_RULE = 'must be a path on this site starting with a single / or an https:// URL'

/** C0 control characters and DEL. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * The link rule: the forms of link a store can save, and so the forms a
 * template's default may take. Returns null when `value` is accepted as
 * `kind`, or a message saying why not.
 *
 * Accepted: the empty string (nothing set); an `https://` URL; a path on the
 * store's own site, starting with `/` but not `//` or `/\`; and, for a link's
 * href only, a fragment of the same page starting with `#`. A value with a
 * control character (U+0000 to U+001F, or U+007F) anywhere is refused, since
 * a browser drops tabs and line breaks inside a URL. Whitespace is not
 * trimmed: a value that starts with a space does not start with `/` or
 * `https://`. The scheme is matched as written, in lowercase.
 */
export function linkValueError(kind: LinkKind, value: string): string | null {
  const rule = kind === 'link' ? LINK_HREF_RULE : LINK_URL_RULE
  if (value === '') return null
  if (CONTROL_CHARACTER.test(value)) return rule
  if (value.startsWith('https://')) return null
  if (kind === 'link' && value.startsWith('#')) return null
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return null
  return rule
}

function scalarError(type: SettingScalarType, bounds: Bounds, value: unknown): string | null {
  if (type === 'url' || type === 'image') return textError(bounds.max, value) ?? linkValueError(type, value as string)
  if (TEXT_TYPES.has(type)) return textError(bounds.max, value)
  if (type === 'color') {
    return typeof value === 'string' && HEX_COLOR.test(value) ? null : 'must be a hex colour'
  }
  if (type === 'boolean') return typeof value === 'boolean' ? null : 'must be a boolean'
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number'
  if (bounds.max !== undefined && value > bounds.max) return `must be at most ${bounds.max}`
  if (bounds.min !== undefined && value < bounds.min) return `must be at least ${bounds.min}`
  if (bounds.step !== undefined && !onStep(value, bounds.min ?? 0, bounds.step)) {
    return `must be a multiple of ${bounds.step}${bounds.min !== undefined ? ` from ${bounds.min}` : ''}`
  }
  return null
}

/**
 * Checks a value against its setting. Returns null when it fits, or a
 * message saying why not. A link's href and every url and image value,
 * including list items and object-list fields, also follow the link rule
 * (linkValueError).
 */
export function settingValueError(entry: SettingSchemaEntry, value: unknown): string | null {
  switch (entry.type) {
    case 'text':
    case 'textarea':
    case 'url':
    case 'image':
    case 'color':
    case 'boolean':
    case 'number':
      return scalarError(entry.type, entry, value)
    case 'link': {
      if (!isRecord(value) || typeof value.label !== 'string' || typeof value.href !== 'string') {
        return 'must be { label, href } strings'
      }
      if (Object.keys(value).length !== 2) return 'must have only label and href'
      const label = textError(entry.max, value.label)
      if (label) return `label ${label}`
      const href = textError(entry.href_max ?? entry.max, value.href) ?? linkValueError('link', value.href)
      return href ? `href ${href}` : null
    }
    case 'select':
      if (typeof value !== 'string') return 'must be a string'
      return entry.options?.some((o) => o.value === value) ? null : 'must be one of the options'
    case 'list': {
      if (!Array.isArray(value)) return 'must be a list'
      if (entry.max !== undefined && value.length > entry.max) return `must have at most ${entry.max} entries`
      for (const [i, item] of value.entries()) {
        const of = entry.of ?? 'text'
        const err = scalarError(of, TEXT_TYPES.has(of) ? { max: entry.item_max } : {}, item)
        if (err) return `entry ${i} ${err}`
      }
      return null
    }
    case 'object-list': {
      if (!Array.isArray(value)) return 'must be a list'
      if (entry.max !== undefined && value.length > entry.max) return `must have at most ${entry.max} entries`
      const fields = entry.fields ?? []
      for (const [i, item] of value.entries()) {
        if (!isRecord(item)) return `entry ${i} must be an object`
        for (const key of Object.keys(item)) {
          if (!fields.some((f) => f.id === key)) return `entry ${i} has unknown field ${key}`
        }
        for (const field of fields) {
          if (!(field.id in item)) return `entry ${i} is missing ${field.id}`
          const err = scalarError(field.type, field, item[field.id])
          if (err) return `entry ${i} field ${field.id} ${err}`
        }
      }
      return null
    }
  }
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Checks `max`, `min` and `step` on a setting or an object-list field of the given type. */
function boundsErrors(at: string, type: string, bounds: Bounds): string[] {
  const errors: string[] = []
  for (const key of ['max', 'min', 'step'] as const) {
    if (bounds[key] !== undefined && (typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]))) {
      errors.push(`${at}.${key} must be a number`)
    }
  }
  if (type !== 'number') {
    if (bounds.min !== undefined) errors.push(`${at}.min is only for number settings`)
    if (bounds.step !== undefined) errors.push(`${at}.step is only for number settings`)
    if (bounds.max !== undefined && typeof bounds.max === 'number' && !isCount(bounds.max)) {
      errors.push(`${at}.max must be a whole number`)
    }
    return errors
  }
  if (typeof bounds.step === 'number' && !(bounds.step > 0)) errors.push(`${at}.step must be greater than zero`)
  if (typeof bounds.min === 'number' && typeof bounds.max === 'number' && bounds.min > bounds.max) {
    errors.push(`${at}.min must not be greater than max`)
  }
  return errors
}

/**
 * Checks that a template declaring a standard setting keeps its shape.
 *
 * A store's content for a standard id is shared by every template and by the
 * pages the platform supplies, so a template may change the label, the limits
 * and the default, but not the type, a list's item type or an object list's
 * fields.
 */
function standardShapeErrors(at: string, entry: SettingSchemaEntry): string[] {
  const standard = STANDARD_SETTINGS.find((s) => s.id === entry.id)
  if (!standard) return []
  const why = `${entry.id} is a standard setting and keeps its shape in every template`
  if (entry.type !== standard.type) return [`${at}.type must be ${standard.type}: ${why}`]
  if (standard.type === 'list' && (entry.of ?? 'text') !== (standard.of ?? 'text')) {
    return [`${at}.of must be ${standard.of ?? 'text'}: ${why}`]
  }
  if (standard.type !== 'object-list' || !Array.isArray(entry.fields)) return []
  const want = (standard.fields ?? []).map((f) => `${f.id} (${f.type})`)
  const got = entry.fields.map((f) => `${f?.id} (${f?.type})`)
  if (want.length === got.length && want.every((f) => got.includes(f))) return []
  return [`${at}.fields must be ${want.join(', ')}: ${why}`]
}

/** Checks a template's declared settings. Returns one message per problem. */
export function validateSettingSchema(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ['settings must be an array']
  const errors: string[] = []
  const seen = new Set<string>()
  const idPattern = new RegExp(SETTING_ID_PATTERN)
  const fieldPattern = new RegExp(SETTING_FIELD_ID_PATTERN)

  entries.forEach((raw, i) => {
    const at = `settings[${i}]`
    const before = errors.length
    if (!isRecord(raw)) {
      errors.push(`${at} must be an object`)
      return
    }
    const entry = raw as unknown as SettingSchemaEntry
    if (typeof entry.id !== 'string' || !idPattern.test(entry.id)) {
      errors.push(`${at}.id must match ${SETTING_ID_PATTERN}`)
    } else if (seen.has(entry.id)) {
      errors.push(`${at}.id ${entry.id} is declared twice`)
    } else {
      seen.add(entry.id)
    }
    if (!SETTING_TYPES.includes(entry.type)) {
      errors.push(`${at}.type must be one of ${SETTING_TYPES.join(', ')}`)
      return
    }
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      errors.push(`${at}.description must be a string`)
    }
    errors.push(...boundsErrors(at, entry.type, entry))
    if (entry.href_max !== undefined) {
      if (entry.type !== 'link') errors.push(`${at}.href_max is only for link settings`)
      else if (!isCount(entry.href_max)) errors.push(`${at}.href_max must be a whole number`)
    }
    if (entry.item_max !== undefined) {
      if (entry.type !== 'list') errors.push(`${at}.item_max is only for list settings`)
      else if (!isCount(entry.item_max)) errors.push(`${at}.item_max must be a whole number`)
    }
    if (entry.type === 'list' && entry.of !== undefined && !SETTING_SCALAR_TYPES.includes(entry.of)) {
      errors.push(`${at}.of must be one of ${SETTING_SCALAR_TYPES.join(', ')}`)
    }
    if (entry.type !== 'list' && entry.of !== undefined) errors.push(`${at}.of is only for list settings`)
    if (entry.type === 'object-list') {
      if (!Array.isArray(entry.fields) || entry.fields.length === 0) {
        errors.push(`${at}.fields must list at least one field`)
      } else {
        const fieldIds = new Set<string>()
        entry.fields.forEach((f, j) => {
          if (!isRecord(f) || typeof f.id !== 'string' || !fieldPattern.test(f.id)) {
            errors.push(`${at}.fields[${j}].id must match ${SETTING_FIELD_ID_PATTERN}`)
            return
          }
          if (fieldIds.has(f.id)) errors.push(`${at}.fields[${j}].id ${f.id} is declared twice`)
          fieldIds.add(f.id)
          if (!SETTING_SCALAR_TYPES.includes(f.type)) {
            errors.push(`${at}.fields[${j}].type must be one of ${SETTING_SCALAR_TYPES.join(', ')}`)
            return
          }
          if (f.label !== undefined && typeof f.label !== 'string') {
            errors.push(`${at}.fields[${j}].label must be a string`)
          }
          if (f.description !== undefined && typeof f.description !== 'string') {
            errors.push(`${at}.fields[${j}].description must be a string`)
          }
          errors.push(...boundsErrors(`${at}.fields[${j}]`, f.type, f as Bounds))
        })
      }
    } else if (entry.fields !== undefined) {
      errors.push(`${at}.fields is only for object-list settings`)
    }
    if (entry.type === 'select') {
      if (!Array.isArray(entry.options) || entry.options.length === 0) {
        errors.push(`${at}.options must list at least one option`)
      } else if (
        !entry.options.every((o) => isRecord(o) && typeof o.value === 'string' && typeof o.label === 'string')
      ) {
        errors.push(`${at}.options must be { value, label } strings`)
      }
    } else if (entry.options !== undefined) {
      errors.push(`${at}.options is only for select settings`)
    }
    if (errors.length === before) errors.push(...standardShapeErrors(at, entry))
    if (entry.default !== undefined && errors.length === before) {
      const err = settingValueError(entry, entry.default)
      if (err) errors.push(`${at}.default ${err}`)
    }
  })

  return errors
}
