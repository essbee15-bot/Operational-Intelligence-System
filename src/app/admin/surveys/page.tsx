import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createSurvey } from './actions'
import PageShell from '@/components/PageShell'

const FREQUENCY_LABELS: Record<string, string> = {
  weekly:    'Weekly',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  annual:    'Annual',
  ad_hoc:    'Ad hoc',
}

const FREQUENCY_COLOURS: Record<string, { bg: string; color: string }> = {
  weekly:    { bg: '#eff6ff', color: '#1d4ed8' },
  monthly:   { bg: '#f0fdf4', color: '#166534' },
  quarterly: { bg: '#fdf4ff', color: '#7e22ce' },
  annual:    { bg: '#fffbeb', color: '#92400e' },
  ad_hoc:    { bg: '#f3f4f6', color: '#374151' },
}

export default async function AdminSurveysPage({
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
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/?message=Unauthorised')

  const adminClient = createAdminClient()

  // Load surveys with period counts and latest period
  const { data: surveys } = await adminClient
    .from('pulse_surveys')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  // Load all periods for this org (for stats)
  const { data: allPeriods } = await adminClient
    .from('pulse_periods')
    .select('id, survey_id, period_label, is_closed, opens_at')
    .eq('organization_id', profile.organization_id)
    .order('opens_at', { ascending: false })

  // Load response counts per period
  const periodIds = (allPeriods ?? []).map(p => p.id)
  const responseCounts: Record<string, number> = {}
  if (periodIds.length > 0) {
    const { data: respCounts } = await adminClient
      .from('pulse_responses')
      .select('period_id')
      .eq('organization_id', profile.organization_id)
      .in('period_id', periodIds)

    ;(respCounts ?? []).forEach(r => {
      const pid = r.period_id as string
      responseCounts[pid] = (responseCounts[pid] ?? 0) + 1
    })
  }

  const isSuccess = message?.toLowerCase().includes('created') || message?.toLowerCase().includes('updated')

  return (
    <PageShell>
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Pulse Surveys</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Create anonymous team surveys and view aggregated results. Individual responses cannot be linked to any person.
          </p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Create survey form */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Create New Survey</h2>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Survey name <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                id="name" name="name" type="text" required maxLength={200}
                placeholder="e.g. Team Pulse Check, Quarterly 360"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="frequency" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Frequency</label>
              <select
                id="frequency" name="frequency"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="ad_hoc">Ad hoc</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="description" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <input
              id="description" name="description" type="text" maxLength={300}
              placeholder="Brief description of what this survey measures…"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <button
            formAction={createSurvey}
            style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Create Survey →
          </button>
        </form>
      </div>

      {/* Surveys list */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            Your Surveys ({(surveys ?? []).length})
          </h2>
        </div>

        {(surveys ?? []).length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500, fontSize: '0.9375rem' }}>No surveys yet</p>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
              Create your first pulse survey above to start collecting anonymous team feedback.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Survey</th>
                <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Frequency</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Questions</th>
                <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Last Period</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Responses</th>
                <th style={{ padding: '0.625rem 1rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {(surveys ?? []).map((survey, idx) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const qs = (survey.questions as any[]) ?? []
                const surveyPeriods = (allPeriods ?? []).filter(p => p.survey_id === survey.id)
                const latestPeriod = surveyPeriods[0] ?? null
                const latestResponses = latestPeriod ? (responseCounts[latestPeriod.id] ?? 0) : null
                const fc = FREQUENCY_COLOURS[survey.frequency as string] ?? FREQUENCY_COLOURS.ad_hoc

                return (
                  <tr key={survey.id as string} style={{ borderBottom: idx < (surveys ?? []).length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ fontWeight: 500, color: '#111827' }}>{survey.name as string}</div>
                      {(survey.description as string | null) && (
                        <div style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.125rem' }}>{survey.description as string}</div>
                      )}
                      {!(survey.is_active as boolean) && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#6b7280' }}>Inactive</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', backgroundColor: fc.bg, color: fc.color }}>
                        {FREQUENCY_LABELS[survey.frequency as string] ?? survey.frequency as string}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      {qs.length}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>
                      {latestPeriod ? (
                        <span>
                          {latestPeriod.period_label as string}
                          {' '}
                          <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', backgroundColor: latestPeriod.is_closed ? '#f3f4f6' : '#f0fdf4', color: latestPeriod.is_closed ? '#6b7280' : '#166534' }}>
                            {latestPeriod.is_closed ? 'Closed' : 'Open'}
                          </span>
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      {latestResponses !== null ? latestResponses : '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <a href={`/admin/surveys/${survey.id as string}`} style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>
                        Manage →
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </PageShell>
  )
}
