import { island } from '@hostcore/toolkit'
import CheckoutSuccess from '../islands/checkout-success'

export const hydrate = 'islands'
const CheckoutSuccessIsland = island(CheckoutSuccess)

/** Where the customer returns after paying. */
export default function CheckoutSuccessPage() {
  return (
    <div className="px-6 py-16">
      <CheckoutSuccessIsland />
    </div>
  )
}
