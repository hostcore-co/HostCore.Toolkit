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

export interface SettingField {
  id: string
  type: SettingScalarType
  label?: string
  /** Characters for text types; the largest value for numbers. */
  max?: number
}

export interface SettingSchemaEntry {
  /** Lowercase words joined by dots, such as `hero.title`. */
  id: string
  type: SettingType
  label?: string
  description?: string
  /** Characters for text types; entries for lists; the largest value for numbers. */
  max?: number
  /** The smallest value, for numbers. */
  min?: number
  /** What a `list` holds. */
  of?: SettingScalarType
  /** The fields of each `object-list` entry. */
  fields?: SettingField[]
  /** The choices of a `select`. */
  options?: SettingOption[]
  /** What a store that has not set the value gets. */
  default?: SettingValue
}

export const SETTING_ID_PATTERN = '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)*$'
export const SETTING_FIELD_ID_PATTERN = '^[a-z][a-z0-9_]*$'
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

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
    default: ['Online in minutes', 'DDoS protection included', 'Support around the clock'],
  },
  { id: 'hero.primary_cta', type: 'link', label: 'Primary button', default: { label: 'Browse plans', href: '/' } },
  { id: 'hero.secondary_cta', type: 'link', label: 'Secondary button', default: { label: 'Find a domain', href: '/domains' } },
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

function scalarError(type: SettingScalarType, max: number | undefined, value: unknown): string | null {
  if (TEXT_TYPES.has(type)) {
    if (typeof value !== 'string') return 'must be a string'
    if (max !== undefined && [...value].length > max) return `must be at most ${max} characters`
    return null
  }
  if (type === 'color') {
    return typeof value === 'string' && HEX_COLOR.test(value) ? null : 'must be a hex colour'
  }
  if (type === 'boolean') return typeof value === 'boolean' ? null : 'must be a boolean'
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number'
  if (max !== undefined && value > max) return `must be at most ${max}`
  return null
}

/**
 * Checks a value against its setting. Returns null when it fits, or a
 * message saying why not.
 */
export function settingValueError(entry: SettingSchemaEntry, value: unknown): string | null {
  switch (entry.type) {
    case 'text':
    case 'textarea':
    case 'url':
    case 'image':
    case 'color':
    case 'boolean':
      return scalarError(entry.type, entry.max, value)
    case 'number': {
      const err = scalarError('number', entry.max, value)
      if (err) return err
      if (entry.min !== undefined && (value as number) < entry.min) return `must be at least ${entry.min}`
      return null
    }
    case 'link':
      if (!isRecord(value) || typeof value.label !== 'string' || typeof value.href !== 'string') {
        return 'must be { label, href } strings'
      }
      return Object.keys(value).length === 2 ? null : 'must have only label and href'
    case 'select':
      if (typeof value !== 'string') return 'must be a string'
      return entry.options?.some((o) => o.value === value) ? null : 'must be one of the options'
    case 'list': {
      if (!Array.isArray(value)) return 'must be a list'
      if (entry.max !== undefined && value.length > entry.max) return `must have at most ${entry.max} entries`
      for (const [i, item] of value.entries()) {
        const err = scalarError(entry.of ?? 'text', undefined, item)
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
          const err = scalarError(field.type, field.max, item[field.id])
          if (err) return `entry ${i} field ${field.id} ${err}`
        }
      }
      return null
    }
  }
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
    for (const key of ['max', 'min'] as const) {
      if (entry[key] !== undefined && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]))) {
        errors.push(`${at}.${key} must be a number`)
      }
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
          }
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
    if (entry.default !== undefined && errors.length === before) {
      const err = settingValueError(entry, entry.default)
      if (err) errors.push(`${at}.default ${err}`)
    }
  })

  return errors
}
