import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'
import { submitReview } from './actions'

const CORE_QUESTIONS = [
  { key: 'communication',       label: 'Communication',         description: 'How effectively does this manager communicate expectations and feedback?' },
  { key: 'support_development', label: 'Support & Development', description: 'How well does this manager support your growth and development?' },
  { key: 'decision_making',     label: 'Decision Making',       description: 'How confident are you in this manager\'s decision-making?' },
  { key: 'vision_direction',    label: 'Vision & Direction',    description: 'How clearly does this manager set direction for the team?' },
  { key: 'trust_safety',        label: 'Trust & Safety',        description: 'How safe do you feel raising concerns or disagreements?' },
]

export default async function ReviewFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycle_id: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const { cycle_id: cycleId } = await params
  const { message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, manager_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.organization_id) redirect('/')

  const adminClient = createAdminClient()

  // Load cycle — must belong to user's org
  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('id, name, description, is_closed, closes_at, custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle || cycle.is_closed) redirect('/360?message=This review cycle is not available')

  if (!profile.manager_id) redirect('/360?message=You don\'t have a reporting manager assigned')

  // Load manager's name
  const { data: manager } = await adminClient
    .from('users')
    .select('full_name')
    .eq('id', profile.manager_id)
    .single()

  const managerName = (manager?.full_name as string | null) ?? 'your manager'

  // Check if already completed
  const { data: existing } = await adminClient
    .from('review_completions')
    .select('cycle_id')
    .eq('cycle_id', cycleId)
    .eq('user_id', user.id)
    .eq('manager_id', profile.manager_id)
    .maybeSingle()

  if (existing) {
    return (
      <PageShell>
        <div style={{ maxWidth: '600px', margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✓ Review Submitted</h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', lineHeight: 1.6 }}>
            You have already submitted your review for <strong>{cycle.name as string}</strong>. Thank you!
          </p>
          <a href="/360" style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '0.875rem' }}>
            ← Back to 360 Reviews
          </a>
        </div>
      </PageShell>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customQuestions = (cycle.custom_questions as Array<{ key: string; label: string; type: string; required: boolean }> | null) ?? []
  const isError = message != null && !message.toLowerCase().includes('thank')

  return (
    <PageShell>
      <div style={{ maxWidth: '680px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <a href="/360" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← 360 Reviews</a>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{cycle.name as string}</h1>
          {(cycle.description as string | null) && (
            <p style={{ color: '#9ca3af', margin: '0.375rem 0 0 0', fontSize: '0.875rem' }}>{cycle.description as string}</p>
          )}
          {(cycle.closes_at as string | null) && (
            <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
              Open until {new Date(cycle.closes_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>

        {/* Anonymity notice */}
        <div style={{ backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '0.875rem 1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
          <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>🔒</span>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#5b21b6', lineHeight: 1.55 }}>
            <strong>This review is completely anonymous</strong> — your responses cannot be linked to you.
          </p>
        </div>

        {/* Reviewer context */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.5rem', fontSize: '0.9375rem', color: '#374151' }}>
          You are reviewing: <strong>{managerName}</strong>
        </div>

        {message && isError && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.875rem' }}>
            {message}
          </div>
        )}

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <input type="hidden" name="cycle_id" value={cycleId} />
          <input type="hidden" name="manager_id" value={profile.manager_id as string} />

          {/* Core questions */}
          {CORE_QUESTIONS.map(q => (
            <div key={q.key} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.25rem 0', fontWeight: 600, fontSize: '0.9375rem', color: '#111827' }}>
                {q.label}
                <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>
              </p>
              <p style={{ margin: '0 0 0.875rem 0', fontSize: '0.875rem', color: '#6b7280' }}>{q.description}</p>
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                      <input type="radio" name={q.key} value={String(n)} required style={{ cursor: 'pointer' }} />
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{n}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                  <span>Poor</span><span>Excellent</span>
                </div>
              </div>
            </div>
          ))}

          {/* Custom questions */}
          {customQuestions.map(q => (
            <div key={q.key} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.875rem 0', fontWeight: 600, fontSize: '0.9375rem', color: '#111827', lineHeight: 1.45 }}>
                {q.label}
                {q.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
              </p>

              {q.type === 'rating_5' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <label key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" name={q.key} value={String(n)} required={q.required} style={{ cursor: 'pointer' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{n}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span>Poor</span><span>Excellent</span>
                  </div>
                </div>
              )}

              {q.type === 'text' && (
                <textarea
                  name={q.key}
                  maxLength={500}
                  required={q.required}
                  placeholder="Your anonymous response…"
                  rows={3}
                  style={{ width: '100%', padding: '0.625rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              )}
            </div>
          ))}

          {/* Open text question — always last, always optional */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
            <p style={{ margin: '0 0 0.875rem 0', fontWeight: 600, fontSize: '0.9375rem', color: '#111827' }}>
              What could this manager do differently?
            </p>
            <textarea
              name="open_text"
              maxLength={500}
              placeholder="Your anonymous response… (optional)"
              rows={3}
              style={{ width: '100%', padding: '0.625rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              formAction={submitReview}
              style={{ padding: '0.75rem 1.5rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9375rem', fontWeight: 600 }}
            >
              Submit anonymously →
            </button>
            <a href="/360" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>Cancel</a>
          </div>
        </form>
      </div>
    </PageShell>
  )
}
