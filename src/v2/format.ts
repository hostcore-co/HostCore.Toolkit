import type { Price, PriceInterval } from '../../contract/dist/ts/contract-2026-11'
import { useStore } from './hooks'

/**
 * Formats an amount in major units as money: `formatMoney(9.5, 'USD')` →
 * `$9.50`. Whole amounts keep their cents so prices line up in a table.
 */
export function formatMoney(amount: number, currency: string, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    // An unknown locale or currency code: still show the amount.
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** Formats a plan price for one billing cycle: `$9.50`. */
export function formatPrice(price: Price, locale = 'en'): string {
  return formatMoney(price.amount, price.currency, locale)
}

/** How an interval is worded. */
export type IntervalStyle = 'long' | 'short' | 'adverb'

const INTERVAL_WORDS: Record<PriceInterval, Record<IntervalStyle, string>> = {
  month: { long: 'month', short: 'mo', adverb: 'monthly' },
  quarter: { long: 'quarter', short: 'qtr', adverb: 'quarterly' },
  semi_annual: { long: '6 months', short: '6 mo', adverb: 'every 6 months' },
  year: { long: 'year', short: 'yr', adverb: 'yearly' },
}

/**
 * Words a billing interval: `formatInterval('month')` → `month`,
 * `'short'` → `mo`, `'adverb'` → `monthly`. An interval this version does
 * not know is returned as it came.
 */
export function formatInterval(interval: PriceInterval, style: IntervalStyle = 'long'): string {
  return INTERVAL_WORDS[interval]?.[style] ?? interval
}

/** A price with its interval: `$9.50/mo`. */
export function formatPricePerInterval(price: Price, locale = 'en'): string {
  return `${formatPrice(price, locale)}/${formatInterval(price.interval, 'short')}`
}

/**
 * Formatters bound to the store's locale and currency. For amounts that are
 * not already a Price, such as a domain's yearly price.
 */
export function useMoney(): {
  money: (amount: number, currency?: string) => string
  price: (price: Price) => string
  pricePerInterval: (price: Price) => string
} {
  const store = useStore()
  return {
    money: (amount, currency = store.currency) => formatMoney(amount, currency, store.locale),
    price: (price) => formatPrice(price, store.locale),
    pricePerInterval: (price) => formatPricePerInterval(price, store.locale),
  }
}
