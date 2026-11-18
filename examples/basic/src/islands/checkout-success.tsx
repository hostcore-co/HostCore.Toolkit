import { useCheckoutSuccess, useNav } from '@hostcore/toolkit'

const COPY = {
  confirming: ['Confirming your payment…', 'Hold tight — this only takes a moment.'],
  paid: ['Order placed!', 'Your order is being set up. Check your email for confirmation and next steps.'],
  processing: ['Payment processing', 'Your payment is settling with the provider. Your order activates automatically the moment it clears — no action needed.'],
  failed: ['Something went wrong', 'We could not confirm your payment. If you were charged, contact support.'],
  signed_out: ['Signing you in…', 'Sign in to finish confirming your order.'],
} as const

/** Confirms the payment the customer returns from, and says how it went. */
export default function CheckoutSuccess() {
  const { state, message } = useCheckoutSuccess()
  const nav = useNav()
  const [heading, detail] = COPY[state]
  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-heading text-3xl">{heading}</h1>
      <p className="text-muted">{state === 'failed' && message ? message : detail}</p>
      {(state === 'paid' || state === 'processing' || state === 'failed') && (
        <a href={nav.links.account} className="self-start rounded-card bg-accent px-4 py-2 text-background">
          {state === 'failed' ? 'Go to your account' : 'Continue'}
        </a>
      )}
    </section>
  )
}
