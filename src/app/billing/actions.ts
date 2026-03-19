'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { getStripe, PLANS, type PlanKey } from '@/utils/stripe'
import { redirect } from 'next/navigation'

async function verifyOrgAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    redirect('/billing?message=Only org admins can manage billing.')
  }

  const adminClient = createAdminClient()
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, name, stripe_customer_id, subscription_plan, subscription_status, stripe_subscription_id')
    .eq('id', profile.organization_id as string)
    .single()

  if (!org) redirect('/')

  return { user, profile, org, adminClient }
}

async function getOrCreateStripeCustomer(
  orgId: string,
  orgName: string,
  adminEmail: string,
  existingCustomerId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
) {
  if (existingCustomerId) return existingCustomerId

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email:    adminEmail,
    name:     orgName,
    metadata: { organization_id: orgId },
  })

  await adminClient
    .from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', orgId)

  return customer.id
}

export async function createCheckoutSession(formData: FormData) {
  const { user, profile, org, adminClient } = await verifyOrgAdmin()

  const plan = formData.get('plan') as PlanKey
  if (!PLANS[plan]) redirect('/billing?message=Invalid plan selected.')

  const priceId = PLANS[plan].priceId
  if (!priceId) {
    redirect('/billing?message=Billing is not yet configured. Set STRIPE_STARTER_PRICE_ID / STRIPE_PRO_PRICE_ID in your environment.')
  }

  const { data: adminUser } = await adminClient
    .from('users')
    .select('email')
    .eq('id', user.id)
    .single()

  const customerId = await getOrCreateStripeCustomer(
    profile.organization_id as string,
    org.name as string,
    (adminUser?.email as string) ?? user.email ?? '',
    org.stripe_customer_id as string | null,
    adminClient,
  )

  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const stripe  = getStripe()

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    line_items:           [{ price: priceId, quantity: 1 }],
    success_url:          `${appUrl}/billing?message=Subscription activated successfully.`,
    cancel_url:           `${appUrl}/billing?message=Checkout cancelled.`,
    metadata:             { organization_id: profile.organization_id as string, plan },
    subscription_data:    { metadata: { organization_id: profile.organization_id as string, plan } },
    allow_promotion_codes: true,
  })

  redirect(session.url!)
}

export async function createPortalSession() {
  const { org } = await verifyOrgAdmin()

  if (!org.stripe_customer_id) {
    redirect('/billing?message=No active subscription found.')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const stripe = getStripe()

  const session = await stripe.billingPortal.sessions.create({
    customer:   org.stripe_customer_id as string,
    return_url: `${appUrl}/billing`,
  })

  redirect(session.url)
}
