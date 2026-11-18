import type * as V1 from '../dist/ts/contract-1'
import type * as V202611 from '../dist/ts/contract-2026-11'
import { settingValueError, standardSetting } from './settings'

/**
 * The reference downgrade from contract "2026-11" to contract "1".
 *
 * A template written against contract "1" receives exactly what this
 * function returns for the envelope the platform builds. The mapping is
 * documented field by field in contract/README.md; the contract "1"
 * fixtures are its output for the "2026-11" fixtures.
 *
 * Objects are built in the field order contract "1" declares.
 */

/** The pages contract "1" has, by 2026-11 page id. A page not listed is served only to 2026-11 templates. */
const PAGE_TYPES: Partial<Record<V202611.ContractPageId, V1.PageType>> = {
  home: 'home',
  'catalog.group': 'group',
  'catalog.service': 'service',
  domains: 'domains',
  'not-found': 'not-found',
}

/** The service types contract "1" knows. A service with no type set has the empty string in both contracts. */
const SERVICE_TYPES: readonly string[] = ['game-server', 'web-hosting', 'dedicated-server', 'vps', 'other', '']
const SERVICE_TYPE_FALLBACK: V1.ServiceType = 'other'

export class DowngradeError extends Error {}

/**
 * A standard setting's value: the store's own when it is set and fits the
 * setting, the setting's default otherwise.
 */
function setting<T>(settings: Record<string, unknown>, id: string): T {
  const entry = standardSetting(id)
  const value = settings[id]
  if (value !== undefined && settingValueError(entry, value) === null) return value as T
  return entry.default as T
}

function content(settings: Record<string, unknown>): V1.StoreContent {
  const link = (id: string): V1.Cta => {
    const value = setting<{ label: string; href: string }>(settings, id)
    return { label: value.label, href: value.href }
  }
  return {
    hero: {
      title: setting(settings, 'hero.title'),
      subtitle: setting(settings, 'hero.subtitle'),
      highlights: [...setting<string[]>(settings, 'hero.highlights')],
      primary_cta: link('hero.primary_cta'),
      secondary_cta: link('hero.secondary_cta'),
    },
    categories: {
      title: setting(settings, 'categories.title'),
      subtitle: setting(settings, 'categories.subtitle'),
    },
    features: {
      title: setting(settings, 'features.title'),
      subtitle: setting(settings, 'features.subtitle'),
      cards: setting<Array<{ title: string; description: string }>>(settings, 'features.cards').map((c) => ({
        title: c.title,
        description: c.description,
      })),
    },
    faq: {
      title: setting(settings, 'faq.title'),
      subtitle: setting(settings, 'faq.subtitle'),
      items: setting<Array<{ question: string; answer: string }>>(settings, 'faq.items').map((i) => ({
        question: i.question,
        answer: i.answer,
      })),
    },
  }
}

function marketing(m: V202611.Marketing): V1.Marketing {
  return {
    title: m.title,
    description: m.description,
    features: m.features.map((f) => ({ icon: f.icon, text: f.text })),
  }
}

function group(g: V202611.Group): V1.ServiceGroup {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    description: g.description,
    image: g.image,
    marketing: marketing(g.marketing),
  }
}

function service(s: V202611.Service): V1.Service {
  return {
    id: s.id,
    group_id: s.group_id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    image: s.image,
    type: SERVICE_TYPES.includes(s.type) ? (s.type as V1.ServiceType) : SERVICE_TYPE_FALLBACK,
    marketing: marketing(s.marketing),
    single_plan: s.single_plan,
  }
}

function price(p: V202611.Price): V1.Price {
  return { amount: p.amount, currency: p.currency, interval: p.interval }
}

function option(o: V202611.OrderFormOption): V1.OrderFormOption {
  return { label: o.label, value: o.value, price: o.price }
}

function orderFormComponent(c: V202611.OrderFormComponent): V1.OrderFormComponent {
  const out: V1.OrderFormComponent = {
    order: c.order,
    type: c.type,
    label: c.label,
    description: c.description,
    key: c.key,
    required: c.required,
  }
  if (c.placeholder) out.placeholder = c.placeholder
  if (c.regex) out.regex = c.regex
  if (c.default_value) out.default_value = c.default_value
  if (c.price) out.price = c.price
  if (c.children && c.children.length > 0) out.children = c.children.map(option)
  if (c.dropdown && c.dropdown.length > 0) {
    out.dropdown = c.dropdown.map((r) => ({
      order: r.order,
      label: r.label,
      default: r.default,
      default_value: r.default_value,
      // Contract "1" allows a region's children to be null; a region without
      // any is downgraded with an empty list either way.
      children: (r.children ?? []).map(option),
    }))
  }
  if (c.preset_id) out.preset_id = c.preset_id
  return out
}

function plan(p: V202611.Plan): V1.ServicePlan {
  const pricing: V1.ServicePlanPricing = { price: price(p.price) }
  if (p.original_price !== null) pricing.original_price = price(p.original_price)
  return {
    id: p.id,
    service_id: p.service_id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    image: p.image,
    pricing,
    trial_days: p.trial_days,
    payment_type: p.payment_type,
    provisioning: p.provisioning,
    order_form: (p.order_form ?? []).map(orderFormComponent),
  }
}

function meta(m: V202611.PageMeta): V1.PageMeta {
  const out: V1.PageMeta = { title: m.title, description: m.description }
  if (m.og_image !== '') out.og_image = m.og_image
  if (m.no_index) out.no_index = true
  return out
}

function store(envelope: V202611.AnyPageEnvelope): V1.StorePublicInfo {
  const s = envelope.store
  const b = s.business
  const th = s.theme
  return {
    store_name: s.name,
    website_domain: s.domain,
    logo_url: s.logo_url,
    favicon_url: s.favicon_url,
    terms_of_service_url: envelope.nav.links.terms,
    privacy_policy_url: envelope.nav.links.privacy,
    root_redirect_url: s.root_redirect_url,
    login_image_url: s.login_image_url,
    signup_image_url: s.signup_image_url,
    business_info: {
      address_line1: b.address_line1,
      address_line2: b.address_line2,
      city: b.city,
      state: b.state,
      country: b.country,
      postal_code: b.postal_code,
      business_number: b.business_number,
      tax_number: b.tax_number,
      phone_number: b.phone_number,
      billing_email: b.billing_email,
    },
    theme: {
      background: th.background,
      surface: th.surface,
      surface_raised: th.surface_raised,
      border: th.border,
      text: th.text,
      text_muted: th.text_muted,
      accent: th.accent,
      accent_strong: th.accent_strong,
    },
  }
}

function required<T>(data: T | undefined, pageId: string): T {
  if (data === undefined) throw new DowngradeError(`a ${pageId} envelope without data cannot be downgraded`)
  return data
}

/** Converts a contract "2026-11" envelope into the contract "1" payload for the same page. */
export function downgrade(envelope: V202611.AnyPageEnvelope): V1.PageData {
  const pageId = envelope.page.id
  const pageType = PAGE_TYPES[pageId]
  if (!pageType) throw new DowngradeError(`page ${String(pageId)} has no contract "1" payload`)

  const base = {
    meta: meta(envelope.meta),
    store: store(envelope),
    service_groups: envelope.nav.groups.map(group),
    content: content(envelope.settings),
    domains_enabled: envelope.nav.links.domains !== '',
  }

  switch (envelope.page.id) {
    case 'home':
      return { page_type: 'home', ...base }
    case 'catalog.group': {
      const data = required(envelope.data as V202611.CatalogGroupData | undefined, pageId)
      return {
        page_type: 'group',
        ...base,
        group: group(data.group),
        services: data.services.map((card) => ({ service: service(card.service), cheapest_plan: plan(card.from) })),
      }
    }
    case 'catalog.service': {
      const data = required(envelope.data as V202611.CatalogServiceData | undefined, pageId)
      return { page_type: 'service', ...base, service: service(data.service), plans: data.plans.map(plan) }
    }
    case 'domains': {
      const data = required(envelope.data as V202611.DomainsData | undefined, pageId)
      return {
        page_type: 'domains',
        ...base,
        tlds: data.tlds.map((t) => ({
          tld: t.tld,
          featured: t.featured,
          register: t.register,
          transfer: t.transfer,
          renew: t.renew,
        })),
        currency: data.currency,
      }
    }
    case 'not-found':
      return { page_type: 'not-found', ...base }
    default:
      throw new DowngradeError(`page ${String(pageId)} has no contract "1" payload`)
  }
}
