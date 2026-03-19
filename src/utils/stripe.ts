import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' })
  }
  return _stripe
}

// Convenience re-export used by the webhook route (needs direct Stripe access for constructEvent)
export { Stripe }

export const PLANS = {
  starter: {
    name:        'Starter',
    priceId:     process.env.STRIPE_STARTER_PRICE_ID ?? '',
    maxUsers:    15,
    description: 'Up to 15 users. All core modules.',
    price:       '£49/mo',
  },
  pro: {
    name:        'Pro',
    priceId:     process.env.STRIPE_PRO_PRICE_ID ?? '',
    maxUsers:    100,
    description: 'Up to 100 users. All modules + AI predictions.',
    price:       '£149/mo',
  },
  enterprise: {
    name:        'Enterprise',
    priceId:     process.env.STRIPE_ENTERPRISE_PRICE_ID ?? '',
    maxUsers:    9999,
    description: 'Unlimited users. Custom onboarding + SLA.',
    price:       'Contact us',
  },
} as const

export type PlanKey = keyof typeof PLANS
