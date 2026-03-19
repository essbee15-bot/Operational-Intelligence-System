import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { submitResponse } from './actions'

export default async function SurveyResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ period_id: string }>
  searchParams: Promise<{ team?: string; message?: string }>
}) {
  const { period_id: periodId } = await params
  const { team: teamParam, message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()

  // Load period + survey questions
  const { data: period } = await adminClient
    .from('pulse_periods')
    .select('id, period_label, is_closed, closes_at, pulse_surveys(id, name, description, questions, is_active)')
    .eq('id', periodId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!period) redirect('/surveys?message=Survey not found')
  if (period.is_closed) redirect('/surveys?message=This survey period has closed')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sv = period.pulse_surveys as unknown as {
    id: string
    name: string
    description: string | null
    questions: Array<{ key: string; label: string; type: string; required: boolean }>
    is_active: boolean
  } | null

  if (!sv || !sv.is_active) redirect('/surveys?message=This survey is no longer active')

  // Load user's team memberships
  const { data: memberships } = await adminClient
    .from('team_members')
    .select('team_id, teams(id, name)')
    .eq('user_id', user.id)
    .eq('organization_id', profile.organization_id)

  const myTeams = (memberships ?? []).map(m => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: ((m.teams as unknown as { id: string; name: string } | null)?.id) ?? (m.team_id as string),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: ((m.teams as unknown as { id: string; name: string } | null)?.name) ?? 'Unknown Team',
  }))

  if (myTeams.length === 0) {
    redirect('/surveys?message=You are not in any team. Contact your admin to be assigned to a team.')
  }

  // Resolve selected team
  const selectedTeam = teamParam
    ? myTeams.find(t => t.id === teamParam) ?? null
    : myTeams.length === 1 ? myTeams[0]! : null

  // Check completion
  if (selectedTeam) {
    const { data: existing } = await adminClient
      .from('pulse_completions')
      .select('period_id')
      .eq('period_id', periodId)
      .eq('user_id', user.id)
      .eq('team_id', selectedTeam.id)
      .maybeSingle()

    if (existing) {
      return (
        <div style={{ maxWidth: '600px', margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Already Submitted</h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', lineHeight: 1.6 }}>
            You have already submitted a response for <strong>{sv.name}</strong> — {period.period_label as string} on behalf of <strong>{selectedTeam.name}</strong>.
          </p>
          <a href="/surveys" style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '0.875rem' }}>
            ← Back to My Surveys
          </a>
        </div>
      )
    }
  }

  // Team selector (multiple teams, none pre-selected)
  if (!selectedTeam) {
    return (
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <a href="/surveys" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← My Surveys</a>
        </div>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.25rem 0' }}>{sv.name}</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{period.period_label as string}</p>
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Which team are you responding on behalf of?</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myTeams.map(team => (
              <a
                key={team.id}
                href={`/surveys/${periodId}?team=${team.id}`}
                style={{ display: 'block', padding: '0.875rem 1rem', border: '1px solid #e5e7eb', borderRadius: '6px', textDecoration: 'none', color: '#111827', fontSize: '0.9375rem', fontWeight: 500 }}
              >
                {team.name} →
              </a>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Survey form
  const questions = sv.questions ?? []
  const isError = message != null && !message.toLowerCase().includes('thank')

  return (
    <div style={{ maxWidth: '680px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/surveys" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← My Surveys</a>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{sv.name}</h1>
        <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
          {selectedTeam.name} · {period.period_label as string}
          {(period.closes_at as string | null) && (
            <span style={{ marginLeft: '0.5rem' }}>
              · Closes {new Date(period.closes_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </p>
        {sv.description && (
          <p style={{ color: '#9ca3af', margin: '0.375rem 0 0 0', fontSize: '0.875rem' }}>{sv.description}</p>
        )}
      </div>

      {/* Anonymity notice */}
      <div style={{ backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '0.875rem 1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
        <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>🔒</span>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#5b21b6', lineHeight: 1.55 }}>
          <strong>This survey is completely anonymous.</strong> Your individual responses cannot be linked to you. Results are shown as team aggregates only — individual answers are never displayed.
        </p>
      </div>

      {message && isError && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {questions.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#9ca3af' }}>This survey has no questions yet.</p>
        </div>
      ) : (
        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <input type="hidden" name="period_id" value={periodId} />
          <input type="hidden" name="team_id" value={selectedTeam.id} />

          {questions.map((q) => (
            <div key={q.key} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.875rem 0', fontWeight: 600, fontSize: '0.9375rem', color: '#111827', lineHeight: 1.45 }}>
                {q.label}
                {q.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
              </p>

              {/* Rating 1–5 */}
              {q.type === 'rating_5' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" name={`answer_${q.key}`} value={String(n)} required={q.required} style={{ cursor: 'pointer' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{n}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span>Poor</span><span>Excellent</span>
                  </div>
                </div>
              )}

              {/* Rating 1–10 */}
              {q.type === 'rating_10' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" name={`answer_${q.key}`} value={String(n)} required={q.required} style={{ cursor: 'pointer' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{n}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span>Poor</span><span>Excellent</span>
                  </div>
                </div>
              )}

              {/* NPS 0–10 */}
              {q.type === 'nps' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" name={`answer_${q.key}`} value={String(n)} required={q.required} style={{ cursor: 'pointer' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{n}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span>Not likely at all</span><span>Extremely likely</span>
                  </div>
                </div>
              )}

              {/* Yes / No */}
              {q.type === 'yes_no' && (
                <div style={{ display: 'flex', gap: '1rem' }}>
                  {[{ val: 'yes', label: 'Yes' }, { val: 'no', label: 'No' }].map(opt => (
                    <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9375rem', fontWeight: 500, color: '#374151' }}>
                      <input type="radio" name={`answer_${q.key}`} value={opt.val} required={q.required} style={{ cursor: 'pointer', width: '1rem', height: '1rem' }} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}

              {/* Text */}
              {q.type === 'text' && (
                <textarea
                  name={`answer_${q.key}`}
                  maxLength={500}
                  required={q.required}
                  placeholder="Your anonymous response…"
                  rows={3}
                  style={{ width: '100%', padding: '0.625rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              )}
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              formAction={submitResponse}
              style={{ padding: '0.75rem 1.5rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9375rem', fontWeight: 600 }}
            >
              Submit Anonymously →
            </button>
            <a href="/surveys" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>Cancel</a>
          </div>
        </form>
      )}
    </div>
  )
}
