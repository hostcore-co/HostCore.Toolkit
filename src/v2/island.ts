import { createElement, useContext, type ComponentType } from 'react'
import { PageContext } from './context'

/** The element an island renders around its component. */
export const ISLAND_TAG = 'hc-island'

const names = new WeakMap<object, string>()

/**
 * Records the island name of a component. The build calls this for the
 * default export of every file in src/islands/; templates never need to.
 */
export function nameIsland<C>(component: C, name: string): C {
  if ((typeof component === 'function' || (typeof component === 'object' && component !== null))) {
    names.set(component as object, name)
  }
  return component
}

/** The island name of a component, if it is the default export of a file in src/islands/. */
export function islandName(component: unknown): string | undefined {
  return typeof component === 'function' || (typeof component === 'object' && component !== null)
    ? names.get(component as object)
    : undefined
}

/**
 * Describes why a value cannot cross from the server to the browser as an
 * island prop, or returns null when it can. Island props travel as JSON, so
 * only what JSON carries unchanged is allowed.
 */
export function unserialisable(value: unknown, path: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} is ${value}, which JSON cannot carry`
  if (typeof value === 'function') return `${path} is a function`
  if (typeof value === 'undefined') return `${path} is undefined`
  if (typeof value !== 'object') return `${path} is a ${typeof value}`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = unserialisable(value[i], `${path}[${i}]`)
      if (err) return err
    }
    return null
  }
  if ((value as { $$typeof?: unknown }).$$typeof !== undefined) return `${path} is a React element`
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'object'
    return `${path} is a ${name}, not a plain object`
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    const err = unserialisable(item, `${path}.${key}`)
    if (err) return err
  }
  return null
}

/**
 * Makes an island: a component the browser hydrates on its own, so a page
 * that sets `export const hydrate = "islands"` ships only the JavaScript of
 * its islands rather than of the whole page.
 *
 * Pass the default export of a file in src/islands/:
 *
 *   import Counter from '../islands/counter'
 *   const CounterIsland = island(Counter)
 *   // …
 *   <CounterIsland start={3} />
 *
 * Its props are sent to the browser as JSON: strings, numbers, booleans,
 * null, arrays and plain objects only. Anything else — a function, a React
 * element (including `children`), a Date — fails the render with an error
 * naming the prop.
 */
export function island<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function Island(props: P) {
    const slot = useContext(PageContext)?.slot
    if (slot !== undefined) {
      throw new Error(`HC_SLOT_SCRIPT: slot "${slot}" renders an island, and a slot is shown with no script`)
    }
    const name = islandName(Component)
    const label = Component.displayName ?? Component.name ?? 'component'
    if (!name) {
      throw new Error(
        `HC_ISLAND: island() was given ${label}, which is not the default export of a file in src/islands/`,
      )
    }
    const problem = unserialisable(props, 'props')
    if (problem) {
      throw new Error(
        `HC_ISLAND_PROPS: island "${name}": ${problem}. Island props must be JSON values: strings, numbers, booleans, null, arrays and plain objects`,
      )
    }
    return createElement(
      ISLAND_TAG,
      { 'data-name': name, 'data-props': JSON.stringify(props) },
      createElement(Component, props),
    )
  }
  Island.displayName = `island(${Component.displayName ?? Component.name ?? 'component'})`
  return Island
}
