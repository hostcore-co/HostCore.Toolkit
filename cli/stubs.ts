import { CLIENT_ONLY_PACKAGES } from './policy'

/**
 * Inert stand-ins for the client-only packages, used in place of the real
 * package in a format-2 server build. Each is safe to call while a page
 * renders on the server, and does nothing: animations and carousels only
 * start in the browser, where the real package runs.
 */

/** A value every property, call and construction of which returns itself. */
const INERT = `
const inertTarget = function () {}
const inert = new Proxy(inertTarget, {
  get(_target, key) {
    if (key === 'then') return undefined
    if (key === Symbol.toPrimitive) return () => ''
    if (key === Symbol.iterator) return function* () {}
    if (key === 'length') return 0
    if (key === 'toString' || key === 'valueOf') return () => ''
    return inert
  },
  apply() { return inert },
  construct() { return inert },
  has() { return false },
  set() { return true },
})
`

/** Plugin names exported by gsap/all, and by gsap/<Plugin>. */
const GSAP_PLUGINS = [
  'CSSPlugin', 'CSSRulePlugin', 'CustomBounce', 'CustomEase', 'CustomWiggle', 'Draggable', 'DrawSVGPlugin',
  'EaselPlugin', 'EasePack', 'Flip', 'GSDevTools', 'InertiaPlugin', 'MorphSVGPlugin', 'MotionPathHelper',
  'MotionPathPlugin', 'Observer', 'Physics2DPlugin', 'PhysicsPropsPlugin', 'PixiPlugin', 'ScrambleTextPlugin',
  'ScrollSmoother', 'ScrollToPlugin', 'ScrollTrigger', 'SplitText', 'TextPlugin', 'TweenLite', 'TweenMax',
  'TimelineLite', 'TimelineMax', 'ExpoScaleEase', 'RoughEase', 'SlowMo', 'Back', 'Bounce', 'Circ', 'Cubic',
  'Elastic', 'Expo', 'Linear', 'Power0', 'Power1', 'Power2', 'Power3', 'Power4', 'Quad', 'Quart', 'Quint',
  'Sine', 'Strong',
]

function gsapStub(specifier: string): string {
  const sub = specifier.slice('gsap'.length).replace(/^\//, '').replace(/\.js$/, '').split('/').pop() ?? ''
  const names = new Set(['gsap', ...GSAP_PLUGINS])
  if (/^[A-Za-z_$][\w$]*$/.test(sub)) names.add(sub)
  return `${INERT}
export default inert
${[...names].sort().map((n) => `export const ${n} = inert`).join('\n')}
`
}

/**
 * useEmblaCarousel returns [viewportRef, api]. On the server the real hook
 * returns a ref callback and no api, because the carousel only starts once
 * mounted, so that is what the stand-in returns.
 */
function emblaStub(): string {
  return `
function useEmblaCarousel() {
  return [function emblaViewportRef() {}, undefined]
}
useEmblaCarousel.globalOptions = undefined
export default useEmblaCarousel
`
}

/** The bare package name of an import specifier. */
export function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

export function isClientOnly(specifier: string): boolean {
  return CLIENT_ONLY_PACKAGES.includes(packageName(specifier))
}

/** The stand-in module for a client-only import specifier. */
export function serverStub(specifier: string): string {
  switch (packageName(specifier)) {
    case 'gsap':
      return gsapStub(specifier)
    case 'embla-carousel-react':
      return emblaStub()
    default:
      throw new Error(`${specifier} is not a client-only package`)
  }
}
