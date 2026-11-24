import { describe, expect, it } from 'bun:test'
import { asset, setCurrentEnv } from '../env'
import { formatInterval, formatMoney, formatPrice, formatPricePerInterval } from '../format'
import { unserialisable } from '../island'

describe('formatters', () => {
  it('formats money in the store locale', () => {
    expect(formatMoney(9.5, 'USD')).toBe('$9.50')
    expect(formatMoney(1234, 'EUR', 'en')).toBe('€1,234.00')
    expect(formatMoney(5, 'not-a-code')).toBe('5.00 not-a-code')
  })

  it('formats prices and intervals', () => {
    const price = { amount: 12, amount_minor: 1200, currency: 'USD', interval: 'month' as const }
    expect(formatPrice(price)).toBe('$12.00')
    expect(formatPricePerInterval(price)).toBe('$12.00/mo')
    expect(formatInterval('semi_annual')).toBe('6 months')
    expect(formatInterval('year', 'adverb')).toBe('yearly')
    expect(formatInterval('fortnight' as never)).toBe('fortnight')
  })
})

describe('asset()', () => {
  it('joins the asset base and the path with one slash', () => {
    const previous = setCurrentEnv({ build_id: 'x', asset_base: '/_hc/b/x/client/', locale: 'en', currency: 'USD', mode: 'document' })
    expect(asset('images/logo.svg')).toBe('/_hc/b/x/client/images/logo.svg')
    expect(asset('/images/logo.svg')).toBe('/_hc/b/x/client/images/logo.svg')
    setCurrentEnv({ build_id: 'x', asset_base: 'https://cdn.example.com/b', locale: 'en', currency: 'USD', mode: 'document' })
    expect(asset('fonts/a.woff2')).toBe('https://cdn.example.com/b/fonts/a.woff2')
    setCurrentEnv(previous)
    expect(asset('images/logo.svg')).toBe('images/logo.svg')
  })
})

describe('island props', () => {
  it('accepts JSON values and names what is not one', () => {
    expect(unserialisable({ a: 1, b: ['x', null, true], c: { d: 'e' }, skipped: undefined }, 'props')).toBeNull()
    expect(unserialisable({ onClick: () => {} }, 'props')).toBe('props.onClick is a function')
    expect(unserialisable({ when: new Date(0) }, 'props')).toBe('props.when is a Date, not a plain object')
    expect(unserialisable({ list: [1, undefined] }, 'props')).toBe('props.list[1] is undefined')
    expect(unserialisable({ n: Number.NaN }, 'props')).toBe('props.n is NaN, which JSON cannot carry')
    expect(unserialisable({ children: { $$typeof: Symbol.for('react.transitional.element') } }, 'props')).toBe(
      'props.children is a React element',
    )
  })
})
