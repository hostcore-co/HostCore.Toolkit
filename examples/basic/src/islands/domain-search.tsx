import { useState } from 'react'
import { actionHref, formatMoney, searchDomains, useAction, type DomainSearchOutcome } from '@hostcore/toolkit'

/**
 * A domain search box. searchDomains asks the store, and each domain that
 * can be bought links to checkout through the checkout action, for its
 * shortest term.
 */
export default function DomainSearch({ placeholder }: { placeholder: string }) {
  const search = useAction('domain_search')
  const checkout = useAction('domain_checkout')
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<DomainSearchOutcome | null>(null)
  if (!search) return null

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault()
    setOutcome(await searchDomains(search, query))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="rounded-card border border-border bg-surface px-3 py-2"
        />
        <button type="submit" className="rounded-card bg-accent px-4 py-2 text-background">
          Search
        </button>
      </div>
      {outcome?.status === 'error' && <p role="status">{outcome.message}</p>}
      {outcome?.status === 'ok' && (
        <ul role="status">
          {outcome.results.length === 0 && <li>No domains matched.</li>}
          {outcome.results.map((result) => {
            const terms = result.action === 'register' ? result.register : result.transfer
            const term = terms[0]
            return (
              <li key={result.domain} className="flex gap-3">
                <span>{result.domain}</span>
                {checkout && term && result.action !== 'none' ? (
                  <a href={actionHref(checkout, { domain: result.domain, action: result.action, years: term.years })} className="text-accent">
                    {result.action === 'register' ? 'Register' : 'Transfer'} for {formatMoney(term.amount, term.currency)}
                  </a>
                ) : (
                  <span className="text-muted">{result.reason || 'Not available'}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </form>
  )
}
