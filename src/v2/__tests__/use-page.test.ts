import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type FunctionComponent } from 'react'
import { renderToString } from 'react-dom/server'
import type { AnyPageEnvelope } from '../../../contract/dist/ts/contract-2026-11'
import { PageContext } from '../context'
import { usePage } from '../hooks'

const FIXTURES = join(import.meta.dir, '..', '..', '..', 'contract', 'fixtures', '2026-11')

function fixture(name: string): AnyPageEnvelope {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as AnyPageEnvelope
}

function render(component: FunctionComponent, payload: AnyPageEnvelope): string {
  const env = { build_id: '', asset_base: '/', locale: 'en', currency: 'USD', mode: 'document' as const }
  return renderToString(createElement(PageContext.Provider, { value: { payload, env, defaults: {}, outlet: null } }, createElement(component)))
}

/** A shared component: it reads the service page's data without receiving it as props. */
function PlanNames() {
  const { data } = usePage('catalog.service')
  return createElement('ul', null, ...data.plans.map((plan) => createElement('li', { key: plan.id }, plan.name)))
}

describe("usePage('<page id>')", () => {
  it("types and returns the named page's data on that page", () => {
    const payload = fixture('catalog.service')
    const html = render(PlanNames, payload)
    const plans = (payload.data as { plans: Array<{ name: string }> }).plans
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) expect(html).toContain(`<li>${plan.name}</li>`)
  })

  it('throws, naming both pages, on another page', () => {
    expect(() => render(PlanNames, fixture('home'))).toThrow(
      'usePage("catalog.service") was called on page "home": a component that names a page may only be used on that page',
    )
  })

  it('throws when the page carries no data', () => {
    const { data: _data, ...payload } = fixture('catalog.service')
    expect(() => render(PlanNames, payload as AnyPageEnvelope)).toThrow('usePage("catalog.service"): this render of "catalog.service" carries no data')
  })

  it('keeps the unchecked forms', () => {
    function Unchecked() {
      const typed = usePage<'catalog.service'>()
      const any = usePage()
      return createElement('p', null, `${typed.data.plans.length} ${any.page.id}`)
    }
    expect(render(Unchecked, fixture('catalog.service'))).toMatch(/<p>\d+ catalog.service<\/p>/)
  })

  it("types data as the named page's", () => {
    function Wrong() {
      // @ts-expect-error groups is home's data, not catalog.service's
      return createElement('p', null, String(usePage('catalog.service').data.groups))
    }
    expect(Wrong).toBeFunction()
  })
})
