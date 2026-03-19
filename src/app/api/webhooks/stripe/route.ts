import { NextRequest, NextResponse } from 'next/server'
import { getStripe, Stripe, PLANS, type PlanKey } from '@/utils/stripe'
import { createAdminClient } from '@/utils/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get('stripe-signature')

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const orgId   = session.metadata?.organization_id
      const plan    = (session.metadata?.plan ?? 'starter') as PlanKey
      if (!orgId) break

      await adminClient
        .from('organizations')
        .update({
          subscription_status:    'active',
          subscription_plan:      plan,
          stripe_subscription_id: session.subscription as string ?? null,
          max_users:              PLANS[plan]?.maxUsers ?? 15,
        })
        .eq('id', orgId)
      break
    }

    case 'customer.subscription.updated': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub   = event.data.object as any
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      const plan        = ((sub.metadata?.plan ?? 'starter') as string) as PlanKey
      const periodEndTs = sub.current_period_end as number | undefined

      await adminClient
        .from('organizations')
        .update({
          subscription_status:     sub.status,
          subscription_plan:       plan,
          stripe_subscription_id:  sub.id,
          subscription_period_end: periodEndTs ? new Date(periodEndTs * 1000).toISOString() : null,
          max_users:               PLANS[plan]?.maxUsers ?? 15,
        })
        .eq('id', orgId)
      break
    }

    case 'customer.subscription.deleted': {
      const sub   = event.data.object
      const orgId = sub.metadata?.organization_id
      if (!orgId) break

      await adminClient
        .from('organizations')
        .update({
          subscription_status: 'canceled',
          subscription_plan:   'free',
          max_users:           5,
        })
        .eq('id', orgId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
