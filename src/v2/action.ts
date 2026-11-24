import type { Action, Actions } from '../../contract/dist/ts/contract-2026-11'

/** The query parameters of the page `actions.domain_checkout` leads to. */
export interface DomainCheckoutParams {
  /** The domain name, such as `acme.example`. */
  domain: string
  /** Whether to register the domain or transfer it in. */
  action: 'register' | 'transfer'
  /** A whole number of years, one of the terms the search result offers. */
  years: number
}

/** The query parameters each action that is a link takes, by action name. */
export interface ActionParams {
  domain_checkout: DomainCheckoutParams
}

/** Query parameters for an action no ActionParams entry types. An undefined value is left out. */
export type ActionQuery = Readonly<Record<string, string | number | boolean | undefined>>

declare const PARAMS: unique symbol

/** An Action that carries the type of the query parameters it takes. */
export type ActionWithParams<P> = Action & { readonly [PARAMS]?: P }

/** What useAction(name) returns: the action, typed with its parameters when it is a link. */
export type ActionFor<K extends keyof Actions> = K extends keyof ActionParams
  ? ActionWithParams<ActionParams[K]> | undefined
  : Actions[K]

/**
 * The href that sends a visitor to an action with the given query
 * parameters: `actionHref(useAction('domain_checkout')!, { domain, action:
 * 'register', years: 1 })`. Each name and value is percent-encoded, a value
 * that is `undefined` is left out, the parameters follow any query the
 * action's url already has, and a fragment in the url stays at the end.
 * For `domain_checkout` the parameters are typed (DomainCheckoutParams).
 */
export function actionHref<P extends object = ActionQuery>(action: ActionWithParams<P>, params: NoInfer<P>): string {
  const pairs = Object.entries(params as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
  const hashAt = action.url.indexOf('#')
  const url = hashAt === -1 ? action.url : action.url.slice(0, hashAt)
  const fragment = hashAt === -1 ? '' : action.url.slice(hashAt)
  if (pairs.length === 0) return action.url
  const joiner = !url.includes('?') ? '?' : url.endsWith('?') || url.endsWith('&') ? '' : '&'
  return `${url}${joiner}${pairs.join('&')}${fragment}`
}
