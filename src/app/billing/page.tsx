import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createCheckoutSession, createPortalSession } from './actions'
import { PLANS } from '@/utils/stripe'

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  active:            { bg: '#f0fdf4', color: '#166534', label: 'Active' },
  trialing:          { bg: '#eff6ff', color: '#1d4ed8', label: 'Trial' },
  past_due:          { bg: '#fef2f2', color: '#991b1b', label: 'Past Due' },
  canceled:          { bg: '#f9fafb', color: '#6b7280', label: 'Cancelled' },
  incomplete:        { bg: '#fefce8', color: '#92400e', label: 'Incomplete' },
  incomplete_expired:{ bg: '#fef2f2', color: '#991b1b', label: 'Expired' },
  free:              { bg: '#f3f4f6', color: '#374151', label: 'Free' },
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/')
  if (profile.role !== 'admin') {
    redirect('/?message=Only org admins can access billing.')
  }

  const adminClient = createAdminClient()
  const { data: org } = await adminClient
    .from('organizations')
    .select('id, name, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, subscription_period_end, max_users')
    .eq('id', profile.organization_id as string)
    .single()

  if (!org) redirect('/')

  // User count
  const { count: userCount } = await adminClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id as string)

  const plan            = (org.subscription_plan as string | null) ?? 'free'
  const status          = (org.subscription_status as string | null) ?? 'free'
  const maxUsers        = (org.max_users as number | null) ?? 5
  const periodEnd       = org.subscription_period_end as string | null
  const hasStripeCustomer = !!(org.stripe_customer_id)
  const isActive        = status === 'active' || status === 'trialing'
  const sc              = STATUS_COLORS[status] ?? STATUS_COLORS['free']!

  const isSuccess = message?.toLowerCase().includes('activated') || message?.toLowerCase().includes('success')
  const isError   = message && !isSuccess

  const stripeConfigured = !!(process.env.STRIPE_STARTER_PRICE_ID)

  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>Billing & Subscription</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Manage your plan for <strong>{org.name as string}</strong>
      </p>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem', backgroundColor: isError ? '#fef2f2' : '#f0fdf4', border: `1px solid ${isError ? '#fca5a5' : '#86efac'}`, color: isError ? '#991b1b' : '#166534', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {/* Current plan card */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>
              Current Plan
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                {plan.charAt(0).toUpperCase() + plan.slice(1)}
              </span>
              <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '9999px', backgroundColor: sc.bg, color: sc.color, fontWeight: 500 }}>
                {sc.label}
              </span>
            </div>
          </div>

          {/* Manage / portal button */}
          {hasStripeCustomer && isActive && (
            <form action={createPortalSession}>
              <button
                type="submit"
                style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'white', cursor: 'pointer', color: '#374151' }}
              >
                Manage Billing →
              </button>
            </form>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f3f4f6' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.2rem' }}>Users</div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: (userCount ?? 0) >= maxUsers ? '#dc2626' : '#111827' }}>
              {userCount ?? 0} / {maxUsers === 9999 ? 'Unlimited' : maxUsers}
              {(userCount ?? 0) >= maxUsers && maxUsers !== 9999 && (
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#dc2626', marginLeft: '0.375rem' }}>⚠ At limit</span>
              )}
            </div>
          </div>
          {periodEnd && (
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.2rem' }}>
                {status === 'canceled' ? 'Access Until' : 'Renews'}
              </div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#111827' }}>
                {new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Plans */}
      {!stripeConfigured && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: '6px', marginBottom: '1.25rem', backgroundColor: '#fefce8', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.8125rem' }}>
          <strong>Stripe not yet configured.</strong> Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_STARTER_PRICE_ID</code>, <code>STRIPE_PRO_PRICE_ID</code>, and <code>STRIPE_WEBHOOK_SECRET</code> in your <code>.env.local</code> to enable live billing.
        </div>
      )}

      <h2 style={{ margin: '0 0 0.875rem 0', fontSize: '1rem', fontWeight: 600 }}>Available Plans</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
        {(Object.entries(PLANS) as [string, typeof PLANS[keyof typeof PLANS]][]).map(([key, p]) => {
          const isCurrent = plan === key
          return (
            <div
              key={key}
              style={{
                backgroundColor: 'white',
                border: `2px solid ${isCurrent ? '#111827' : '#e5e7eb'}`,
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#111827' }}>{p.name}</span>
                {isCurrent && (
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '9999px', backgroundColor: '#111827', color: 'white', fontWeight: 600 }}>
                    Current
                  </span>
                )}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>{p.price}</div>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.5 }}>{p.description}</p>

              {!isCurrent && key !== 'enterprise' && (
                <form action={createCheckoutSession}>
                  <input type="hidden" name="plan" value={key} />
                  <button
                    type="submit"
                    disabled={!stripeConfigured}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      backgroundColor: stripeConfigured ? '#111827' : '#e5e7eb',
                      color: stripeConfigured ? 'white' : '#9ca3af',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      cursor: stripeConfigured ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {plan === 'free' ? 'Upgrade' : (key > plan ? 'Upgrade' : 'Downgrade')}
                  </button>
                </form>
              )}

              {!isCurrent && key === 'enterprise' && (
                <a
                  href="mailto:hello@leadershiphub.io?subject=Enterprise enquiry"
                  style={{ display: 'block', width: '100%', padding: '0.5rem', backgroundColor: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box' }}
                >
                  Contact Us
                </a>
              )}
            </div>
          )
        })}
      </div>

      {/* Setup guide for admins */}
      {!stripeConfigured && (
        <details style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem' }}>
          <summary style={{ fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            Developer Setup — Stripe Integration
          </summary>
          <div style={{ marginTop: '0.875rem', fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 0.5rem 0' }}>Add these to your <code>.env.local</code>:</p>
            <pre style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '0.75rem', overflow: 'auto', fontSize: '0.8125rem' }}>{`STRIPE_SECRET_KEY=sk_test_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3000`}</pre>
            <p style={{ margin: '0.5rem 0 0 0' }}>
              Then set up the webhook in the Stripe dashboard pointing to <code>/api/webhooks/stripe</code> listening for: <code>checkout.session.completed</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>.
            </p>
          </div>
        </details>
      )}
    </div>
  )
}
