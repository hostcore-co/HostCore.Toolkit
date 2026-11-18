import { island } from '@hostcore/toolkit'
import CheckoutCancel from '../islands/checkout-cancel'

export const hydrate = 'islands'
const CheckoutCancelIsland = island(CheckoutCancel)

/** Where the customer returns after abandoning payment. */
export default function CheckoutCancelPage() {
  return (
    <div className="px-6 py-16">
      <CheckoutCancelIsland />
    </div>
  )
}
