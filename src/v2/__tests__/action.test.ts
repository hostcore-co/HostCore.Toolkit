import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import type { Action } from '../../../contract/dist/ts/contract-2026-11'
import { actionHref, type ActionWithParams, type DomainCheckoutParams } from '../action'
import { PageContext } from '../context'
import { useAction } from '../hooks'

const checkout: ActionWithParams<DomainCheckoutParams> = { method: 'GET', url: '/checkout/domains' }

describe('actionHref()', () => {
  it('appends the parameters as a query, encoding each name and value', () => {
    expect(actionHref(checkout, { domain: 'acme.example', action: 'register', years: 2 })).toBe(
      '/checkout/domains?domain=acme.example&action=register&years=2',
    )
    const plain: Action = { method: 'GET', url: '/go' }
    expect(actionHref(plain, { 'a b': 'x&y=z', q: 'ü/?#', on: true })).toBe('/go?a%20b=x%26y%3Dz&q=%C3%BC%2F%3F%23&on=true')
  })

  it('follows a query the url already has, and keeps its fragment last', () => {
    const plain = (url: string): Action => ({ method: 'GET', url })
    expect(actionHref(plain('/go?ref=nav'), { a: 1 })).toBe('/go?ref=nav&a=1')
    expect(actionHref(plain('/go?'), { a: 1 })).toBe('/go?a=1')
    expect(actionHref(plain('/go?ref=nav&'), { a: 1 })).toBe('/go?ref=nav&a=1')
    expect(actionHref(plain('/go#top'), { a: 1 })).toBe('/go?a=1#top')
    expect(actionHref(plain('https://shop.example.com/go?x=1#top'), { a: 1 })).toBe('https://shop.example.com/go?x=1&a=1#top')
  })

  it('leaves out undefined values, and the url as it is when nothing is left', () => {
    const plain: Action = { method: 'GET', url: '/go?x=1' }
    expect(actionHref(plain, { a: undefined, b: 'c' })).toBe('/go?x=1&b=c')
    expect(actionHref(plain, { a: undefined })).toBe('/go?x=1')
    expect(actionHref(plain, {})).toBe('/go?x=1')
  })

  it("types domain_checkout's parameters", () => {
    // @ts-expect-error years is a number
    actionHref(checkout, { domain: 'acme.example', action: 'register', years: '2' })
    // @ts-expect-error action is register or transfer
    actionHref(checkout, { domain: 'acme.example', action: 'renew', years: 1 })
    // @ts-expect-error domain is required
    actionHref(checkout, { action: 'transfer', years: 1 })
  })
})

describe("useAction('domain_checkout')", () => {
  it('returns the action from the payload, typed for actionHref', () => {
    const payload = JSON.parse(readFileSync(join(import.meta.dir, '../../../contract/fixtures/2026-11/domains.json'), 'utf8'))
    let href = ''
    function Probe() {
      const action = useAction('domain_checkout')
      href = action ? actionHref(action, { domain: 'acme.example', action: 'transfer', years: 1 }) : ''
      return null
    }
    const env = { build_id: '', asset_base: '', locale: 'en', currency: 'USD' }
    renderToString(createElement(PageContext.Provider, { value: { payload, env, defaults: {} } as never }, createElement(Probe)))
    expect(href).toBe('/checkout/domains?domain=acme.example&action=transfer&years=1')
  })
})
