import { useCheckoutCancel, useNav } from '@hostcore/toolkit'

/** Cancels the order whose payment was abandoned. */
export default function CheckoutCancel() {
  const { state } = useCheckoutCancel()
  const nav = useNav()
  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-heading text-3xl">Checkout cancelled</h1>
      <p className="text-muted">{state === 'cancelling' ? 'Cancelling your order…' : 'Your checkout has been cancelled. Nothing was charged.'}</p>
      <a href={nav.links.account} className="self-start rounded-card bg-accent px-4 py-2 text-background">
        Continue
      </a>
    </section>
  )
}
