import { useStore } from '@hostcore/toolkit'

/**
 * Shown under the order summary at checkout. A slot is rendered on the
 * server only and shown with no script, so it is plain markup: here, where
 * to ask about an order.
 */
export default function CheckoutSummary() {
  const store = useStore()
  const email = store.business.billing_email
  if (email === '') return null
  return (
    <p className="text-sm text-muted">
      Questions about this order? Write to <a href={`mailto:${email}`}>{email}</a>.
    </p>
  )
}
