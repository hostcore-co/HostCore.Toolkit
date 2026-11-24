import { describe, expect, it } from 'bun:test'
import { createContext, runInContext } from 'node:vm'
import { CLIENT_ONLY_PACKAGES } from '../policy'
import { isClientOnly, serverStub } from '../stubs'

/** Evaluates a stub's ES module source as a function body returning its exports. */
function evaluate(source: string): Record<string, any> {
  const body = source
    .replace(/^export default (.+)$/m, 'exports.default = $1')
    .replace(/^export const (\w+) = (.+)$/gm, 'exports.$1 = $2')
  const context = createContext(Object.create(null) as object)
  return runInContext(`(function () { const exports = {}; ${body}; return exports })()`, context)
}

describe('server stubs', () => {
  it('has a stand-in for every client-only package', () => {
    for (const name of CLIENT_ONLY_PACKAGES) {
      expect(isClientOnly(name)).toBe(true)
      expect(() => serverStub(name)).not.toThrow()
    }
    expect(isClientOnly('gsap/ScrollTrigger')).toBe(true)
    expect(isClientOnly('react')).toBe(false)
  })

  it('gives gsap calls that chain and do nothing', () => {
    const gsap = evaluate(serverStub('gsap'))
    expect(typeof gsap.default.to).toBe('function')
    const timeline = gsap.gsap.timeline({ repeat: -1 }).to('.x', { y: 10 }).from('.y', { opacity: 0 })
    expect(timeline.then).toBeUndefined()
    expect(`${gsap.default.utils.toArray('.x')}`).toBe('')
    expect(() => gsap.default.registerPlugin(gsap.ScrollTrigger)).not.toThrow()
    const ctx = gsap.default.context(() => {})
    expect(() => ctx.revert()).not.toThrow()
  })

  it('exports the plugin a gsap subpath is named after', () => {
    expect(Object.keys(evaluate(serverStub('gsap/ScrollTrigger')))).toContain('ScrollTrigger')
    expect(Object.keys(evaluate(serverStub('gsap/dist/MyPlugin.js')))).toContain('MyPlugin')
  })

  it('gives useEmblaCarousel the shape it has before a carousel mounts', () => {
    const embla = evaluate(serverStub('embla-carousel-react'))
    const [ref, api] = embla.default({ loop: true })
    expect(typeof ref).toBe('function')
    expect(ref(null)).toBeUndefined()
    expect(api).toBeUndefined()
  })
})
