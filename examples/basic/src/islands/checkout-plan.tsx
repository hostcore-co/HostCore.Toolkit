import { useCheckoutPlan } from '@hostcore/toolkit'
import {
  AddressFields,
  BankTransferDetails,
  ContactFields,
  CurrencyChoice,
  intervalName,
  Offers,
  OrderFormFields,
  PaymentChoice,
  perInterval,
  PlaceOrder,
  QuoteLines,
  Section,
  show,
  storeMoney,
} from '../checkout/parts'

/** The plan checkout: configure the plan, add add-ons, pay. */
export default function CheckoutPlan() {
  const c = useCheckoutPlan()
  const price = (minor: number) => show(c.money(storeMoney(minor, c.payment.currency)))
  if (c.placed) return <BankTransferDetails placed={c.placed} />
  const { plan, cycle } = c
  const per = cycle ? perInterval(cycle.interval) : ''
  const free = plan.payment_type === 'free'
  const trial = plan.payment_type === 'free_trial'
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <aside className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{free ? 'Price' : 'Due at checkout'}</p>
          <CurrencyChoice state={c} />
        </div>
        <p className="font-heading text-4xl">{show(c.dueNow)}</p>
        {trial && cycle && (
          <p className="text-sm text-muted">
            Free for {plan.trial_days} days, then {show(c.cyclePrice(cycle))}
            {per}
          </p>
        )}
        <div className="flex justify-between gap-3">
          <div>
            <p className="font-heading">{c.service.name}</p>
            <p className="text-sm text-muted">{c.primaryPaid && cycle ? `${plan.name} · ${intervalName(cycle.interval)}` : plan.name}</p>
            {plan.provisioning === 'manual' && <p className="text-xs text-muted">Set up by our team after purchase</p>}
          </div>
          <p>{free ? 'Free' : trial ? `Free for ${plan.trial_days} days` : cycle ? `${show(c.cyclePrice(cycle))}${per}` : ''}</p>
        </div>
        {c.setupFee.amount_minor > 0 && (
          <p className="flex justify-between text-sm">
            <span className="text-muted">One-time setup fee</span>
            {show(c.setupFee)}
          </p>
        )}
        {c.quote && c.anyPaid && <QuoteLines quote={c.quote} money={c.money} />}
        {c.primaryPaid && cycle && (
          <p className="flex justify-between text-sm">
            <span className="text-muted">Renews {intervalName(cycle.interval).toLowerCase()}</span>
            <span>
              {show(c.cyclePrice(cycle))}
              {per} +tax
            </span>
          </p>
        )}
      </aside>

      <div className="flex flex-col gap-8">
        <Section title="Configure your order">
          {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
          {c.primaryPaid && c.cycles.length > 1 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {c.cycles.map((option) => (
                <button
                  key={option.interval}
                  type="button"
                  onClick={() => c.setCycle(option.interval)}
                  className={`rounded-card border px-3 py-2 text-left ${option.interval === cycle?.interval ? 'border-accent' : 'border-border'}`}
                >
                  <span className="block text-xs text-muted">{intervalName(option.interval)}</span>
                  {show(c.cyclePrice(option))}
                </button>
              ))}
            </div>
          )}
          <OrderFormFields form={plan.order_form} values={c.order} onChange={c.setOrderValue} price={price} />
        </Section>
        <Offers offers={c.offers} price={price} />
        {c.needsContact && <ContactFields state={c} />}
        {c.anyPaid && <AddressFields state={c} />}
        {c.anyPaid && <PaymentChoice state={c} />}
        <PlaceOrder state={c} label={c.anyPaid ? 'Pay & complete order' : 'Start now'} promo={c.anyPaid ? 'shown' : 'hidden'} />
      </div>
    </div>
  )
}
