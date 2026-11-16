import { useState } from 'react'

export interface FaqProps {
  items: Array<{ question: string; answer: string }>
}

/** An accordion: the only part of the home page that needs JavaScript. */
export default function Faq({ items }: FaqProps) {
  const [open, setOpen] = useState(0)
  return (
    <dl className="divide-y divide-border">
      {items.map((item, i) => (
        <div key={item.question} className="py-3">
          <dt>
            <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
              {item.question}
            </button>
          </dt>
          <dd hidden={open !== i} className="text-muted">
            {item.answer}
          </dd>
        </div>
      ))}
    </dl>
  )
}
