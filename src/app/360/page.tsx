import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

export default async function My360Page({
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
    .select('id, organization_id, manager_id, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/')

  const adminClient = createAdminClient()

  // Load open review cycles for this org
  const { data: cycles } = await adminClient
    .from('review_cycles')
    .select('id, name, description, opens_at, closes_at')
    .eq('organization_id', profile.organization_id)
    .eq('is_closed', false)
    .order('opens_at', { ascending: true })

  const openCycles = cycles ?? []

  // Load user's completions keyed by cycle_id + manager_id
  const completedKeys = new Set<string>()

  if (openCycles.length > 0) {
    const cycleIds = openCycles.map(c => c.id as string)
    const { data: completions } = await adminClient
      .from('review_completions')
      .select('cycle_id, manager_id')
      .eq('user_id', user.id)
      .in('cycle_id', cycleIds)

    ;(completions ?? []).forEach(c => {
      completedKeys.add(`${c.cycle_id as string}:${c.manager_id as string}`)
    })
  }

  const isSuccess = message != null && (
    message.toLowerCase().includes('thank') ||
    message.toLowerCase().includes('recorded')
  )

  return (
    <PageShell>
      <div style={{ maxWidth: '700px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>360 Reviews</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Provide anonymous feedback on your manager. Individual responses are never linked to you.
          </p>
        </div>

        {message && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`, color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem' }}>
            {message}
          </div>
        )}

        {!profile.manager_id ? (
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>No reporting manager assigned</p>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
              You don&apos;t have a reporting manager assigned. Contact your admin to be added to a reporting line.
            </p>
          </div>
        ) : openCycles.length === 0 ? (
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>No review cycles currently open</p>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
              Check back later — your admin will open a review cycle when it&apos;s time to collect feedback.
            </p>
          </div>
        ) : (
          <>
            {/* All complete banner */}
            {openCycles.every(c => completedKeys.has(`${c.id as string}:${profile.manager_id as string}`)) && (
              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1.25rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '0.9375rem', color: '#166534', fontWeight: 500 }}>🎉 All reviews complete! Thank you for your feedback.</span>
              </div>
            )}

            {/* Pending */}
            {openCycles.filter(c => !completedKeys.has(`${c.id as string}:${profile.manager_id as string}`)).length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Awaiting Response ({openCycles.filter(c => !completedKeys.has(`${c.id as string}:${profile.manager_id as string}`)).length})
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {openCycles
                    .filter(c => !completedKeys.has(`${c.id as string}:${profile.manager_id as string}`))
                    .map(cycle => (
                      <a
                        key={cycle.id as string}
                        href={`/360/${cycle.id as string}`}
                        style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem', marginBottom: '0.25rem' }}>
                              {cycle.name as string}
                            </div>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                              {(cycle.closes_at as string | null)
                                ? `Open until ${new Date(cycle.closes_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                                : 'No closing date'}
                            </div>
                            {(cycle.description as string | null) && (
                              <div style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.25rem' }}>{cycle.description as string}</div>
                            )}
                          </div>
                          <span style={{ flexShrink: 0, fontSize: '0.8125rem', padding: '0.375rem 0.875rem', borderRadius: '4px', backgroundColor: '#111827', color: 'white', whiteSpace: 'nowrap' }}>
                            Start →
                          </span>
                        </div>
                      </a>
                    ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {openCycles.filter(c => completedKeys.has(`${c.id as string}:${profile.manager_id as string}`)).length > 0 && (
              <div>
                <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Completed
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {openCycles
                    .filter(c => completedKeys.has(`${c.id as string}:${profile.manager_id as string}`))
                    .map(cycle => (
                      <div
                        key={cycle.id as string}
                        style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 500, color: '#6b7280', fontSize: '0.9375rem', marginBottom: '0.125rem' }}>{cycle.name as string}</div>
                            <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                              {(cycle.closes_at as string | null)
                                ? `Open until ${new Date(cycle.closes_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                                : 'No closing date'}
                            </div>
                          </div>
                          <span style={{ fontSize: '0.875rem', color: '#166534', fontWeight: 500 }}>✓ Submitted</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}
