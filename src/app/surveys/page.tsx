import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export default async function MySurveysPage({
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
    .select('id, organization_id, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/')

  const adminClient = createAdminClient()

  // Load user's team memberships
  const { data: memberships } = await adminClient
    .from('team_members')
    .select('team_id, teams(id, name)')
    .eq('user_id', user.id)
    .eq('organization_id', profile.organization_id)

  const myTeams = (memberships ?? []).map(m => ({
    id: ((m.teams as unknown as { id: string; name: string } | null)?.id) ?? (m.team_id as string),
    name: ((m.teams as unknown as { id: string; name: string } | null)?.name) ?? 'Unknown Team',
  }))

  // Load open periods for this org (with survey info)
  const { data: openPeriods } = await adminClient
    .from('pulse_periods')
    .select('id, period_label, closes_at, survey_id, pulse_surveys(id, name, description, is_active)')
    .eq('organization_id', profile.organization_id)
    .eq('is_closed', false)
    .order('opens_at', { ascending: true })

  // Only show periods from active surveys
  const activePeriods = (openPeriods ?? []).filter(p => {
    const sv = p.pulse_surveys as unknown as { id: string; name: string; description: string | null; is_active: boolean } | null
    return sv?.is_active !== false
  })

  // Load user's completions for these open periods
  const openPeriodIds = activePeriods.map(p => p.id as string)
  const completedKeys = new Set<string>()

  if (openPeriodIds.length > 0) {
    const { data: completions } = await adminClient
      .from('pulse_completions')
      .select('period_id, team_id')
      .eq('user_id', user.id)
      .in('period_id', openPeriodIds)

    ;(completions ?? []).forEach(c => {
      completedKeys.add(`${c.period_id as string}:${c.team_id as string}`)
    })
  }

  // Build pending + completed items per (period × team)
  type SurveyItem = {
    periodId: string
    periodLabel: string
    closesAt: string | null
    surveyName: string
    surveyDescription: string | null
    teamId: string
    teamName: string
    completed: boolean
  }

  const items: SurveyItem[] = []

  for (const period of activePeriods) {
    const sv = period.pulse_surveys as unknown as { id: string; name: string; description: string | null; is_active: boolean } | null
    if (!sv) continue

    for (const team of myTeams) {
      const key = `${period.id as string}:${team.id}`
      items.push({
        periodId:        period.id as string,
        periodLabel:     period.period_label as string,
        closesAt:        period.closes_at as string | null,
        surveyName:      sv.name,
        surveyDescription: sv.description,
        teamId:          team.id,
        teamName:        team.name,
        completed:       completedKeys.has(key),
      })
    }
  }

  const pending   = items.filter(i => !i.completed)
  const completed = items.filter(i => i.completed)

  const isSuccess = message != null && (
    message.toLowerCase().includes('thank') ||
    message.toLowerCase().includes('recorded')
  )

  return (
    <div style={{ maxWidth: '700px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>My Surveys</h1>
        <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
          Respond to your team&apos;s pulse surveys anonymously. Individual responses are never linked to you.
        </p>
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`, color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {myTeams.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>Not in any team yet</p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
            Contact your admin to be assigned to a team before you can respond to surveys.
          </p>
        </div>
      ) : activePeriods.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>No surveys currently open</p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
            Check back later — your admin will open surveys when it&apos;s time to collect feedback.
          </p>
        </div>
      ) : (
        <>
          {/* All complete banner */}
          {pending.length === 0 && (
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1.25rem', textAlign: 'center', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '0.9375rem', color: '#166534', fontWeight: 500 }}>🎉 All surveys complete! Thank you for your feedback.</span>
            </div>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Awaiting Response ({pending.length})
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {pending.map(item => (
                  <a
                    key={`${item.periodId}:${item.teamId}`}
                    href={`/surveys/${item.periodId}?team=${item.teamId}`}
                    style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem', marginBottom: '0.25rem' }}>
                          {item.surveyName}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                          {item.teamName} · {item.periodLabel}
                          {item.closesAt && (
                            <span style={{ marginLeft: '0.5rem', color: '#9ca3af' }}>
                              · Closes {new Date(item.closesAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                        {item.surveyDescription && (
                          <div style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.25rem' }}>{item.surveyDescription}</div>
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
          {completed.length > 0 && (
            <div>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Completed
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {completed.map(item => (
                  <div
                    key={`${item.periodId}:${item.teamId}`}
                    style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 500, color: '#6b7280', fontSize: '0.9375rem', marginBottom: '0.125rem' }}>{item.surveyName}</div>
                        <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>{item.teamName} · {item.periodLabel}</div>
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
  )
}
