import { useState } from 'react'
import { actionHref, useAction } from '@hostcore/toolkit'

/**
 * A domain search box. It posts to the endpoint the page payload names, then
 * links to checkout for the domain searched, through the checkout action.
 */
export default function DomainSearch({ placeholder }: { placeholder: string }) {
  const search = useAction('domain_search')
  const checkout = useAction('domain_checkout')
  const [searched, setSearched] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState('')
  if (!search) return null

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault()
    const response = await fetch(search!.url, {
      method: search!.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    setResult(response.ok ? 'Results are ready below.' : 'Search is unavailable right now.')
    setSearched(response.ok ? query : '')
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="rounded-card border border-border bg-surface px-3 py-2"
      />
      <button type="submit" className="rounded-card bg-accent px-4 py-2 text-background">
        Search
      </button>
      {result !== '' && <p role="status">{result}</p>}
      {checkout && searched !== '' && (
        <a href={actionHref(checkout, { domain: searched, action: 'register', years: 1 })} className="text-accent">
          Register {searched} for a year
        </a>
      )}
    </form>
  )
}
