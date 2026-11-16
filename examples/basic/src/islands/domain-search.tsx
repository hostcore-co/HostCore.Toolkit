import { useState } from 'react'
import { useAction } from '@hostcore/toolkit'

/** A domain search box. It posts to the endpoint the page payload names. */
export default function DomainSearch({ placeholder }: { placeholder: string }) {
  const search = useAction('domain_search')
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
    </form>
  )
}
