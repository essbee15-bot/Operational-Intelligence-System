import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { closeCycle, reopenCycle, addCustomQuestion, removeCustomQuestion } from '../actions'
import PageShell from '@/components/PageShell'

const CORE_QUESTIONS = [
  { key: 'communication',       label: 'Communication',         description: 'How effectively does this manager communicate expectations and feedback?' },
  { key: 'support_development', label: 'Support & Development', description: 'How well does this manager support your growth and development?' },
  { key: 'decision_making',     label: 'Decision Making',       description: 'How confident are you in this manager\'s decision-making?' },
  { key: 'vision_direction',    label: 'Vision & Direction',    description: 'How clearly does this manager set direction for the team?' },
  { key: 'trust_safety',        label: 'Trust & Safety',        description: 'How safe do you feel raising concerns or disagreements?' },
]
const OPEN_TEXT_KEY = 'open_text'

const QUESTION_TYPE_LABELS: Record<string, string> = {
  rating_5: 'Rating 1–5',
  text:     'Text',
}

export default async function Admin360DetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; message?: string }>
}) {
  const { id: cycleId } = await params
  const { tab: tabParam, message } = await searchParams

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
  const orgId = profile.organization_id as string

  // Load cycle
  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('*')
    .eq('id', cycleId)
    .eq('organization_id', orgId)
    .single()

  if (!cycle) redirect('/admin/360?message=Cycle not found')

  const activeTab = tabParam === 'results' ? 'results' : 'setup'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let responses: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let completions: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let managers: any[] = []

  // Load responses and completions (always needed for results summary counts)
  const [respResult, compResult] = await Promise.all([
    adminClient
      .from('review_responses')
      .select('manager_id, answers')
      .eq('cycle_id', cycleId),
    adminClient
      .from('review_completions')
      .select('user_id, manager_id')
      .eq('cycle_id', cycleId),
  ])
  responses   = respResult.data ?? []
  completions = compResult.data ?? []

  // Load managers: users in this org whose id appears as manager_id on another user
  const [allUsersResult, managerIdResult] = await Promise.all([
    adminClient
      .from('users')
      .select('id, full_name')
      .eq('organization_id', orgId),
    adminClient
      .from('users')
      .select('manager_id')
      .eq('organization_id', orgId)
      .not('manager_id', 'is', null),
  ])

  const managerIdSet = new Set(
    (managerIdResult.data ?? []).map((r: { manager_id: string }) => r.manager_id as string)
  )
  managers = (allUsersResult.data ?? []).filter((u: { id: string }) => managerIdSet.has(u.id))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customQuestions = (cycle.custom_questions as Array<{ key: string; label: string; type: string }>) ?? []

  // ── Aggregate results by manager ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responsesByManager: Record<string, any[]> = {}
  responses.forEach(r => {
    const mid = r.manager_id as string
    if (!responsesByManager[mid]) responsesByManager[mid] = []
    responsesByManager[mid].push(r)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const managerMap: Record<string, string> = Object.fromEntries(managers.map((m: any) => [m.id as string, m.full_name as string]))

  // Only include managers who have at least one response
  const managerStats = Object.keys(responsesByManager).map(mid => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const managerResponses: any[] = responsesByManager[mid] ?? []
    const count = managerResponses.length
    const hasEnough = count >= 3

    let coreAvgs: Record<string, number | null> = {}
    let overallAvg: number | null = null
    let customRatingAvgs: Record<string, number | null> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let customTextPools: Record<string, string[]> = {}
    let openTextPool: string[] = []

    if (hasEnough) {
      // Core question averages
      CORE_QUESTIONS.forEach(q => {
        const vals = managerResponses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(r => (r.answers as any[]).find((a: any) => a.key === q.key)?.value)
          .filter((v): v is string | number => v != null && v !== '')
          .map(v => parseFloat(String(v)))
          .filter(v => !isNaN(v))
        coreAvgs[q.key] = vals.length > 0
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : null
      })

      // Overall average across all 5 core questions
      const coreVals = Object.values(coreAvgs).filter((v): v is number => v != null)
      overallAvg = coreVals.length > 0
        ? Math.round((coreVals.reduce((a, b) => a + b, 0) / coreVals.length) * 10) / 10
        : null

      // Custom questions
      customQuestions.forEach(q => {
        const vals = managerResponses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(r => (r.answers as any[]).find((a: any) => a.key === q.key)?.value)
          .filter((v): v is string | number => v != null && v !== '')

        if (q.type === 'rating_5') {
          const numVals = vals.map(v => parseFloat(String(v))).filter(v => !isNaN(v))
          customRatingAvgs[q.key] = numVals.length > 0
            ? Math.round((numVals.reduce((a, b) => a + b, 0) / numVals.length) * 10) / 10
            : null
        } else if (q.type === 'text') {
          customTextPools[q.key] = vals as string[]
        }
      })

      // Open text pool
      openTextPool = managerResponses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map(r => (r.answers as any[]).find((a: any) => a.key === OPEN_TEXT_KEY)?.value)
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    }

    return {
      mid,
      name: managerMap[mid] ?? 'Unknown Manager',
      count,
      hasEnough,
      coreAvgs,
      overallAvg,
      customRatingAvgs,
      customTextPools,
      openTextPool,
    }
  }).sort((a, b) => (b.overallAvg ?? -Infinity) - (a.overallAvg ?? -Infinity))

  const eligibleManagers = managerStats.filter(m => m.overallAvg != null)
  const bestManager  = eligibleManagers.length >= 2 ? eligibleManagers[0] : null
  const worstManager = eligibleManagers.length >= 2 ? eligibleManagers[eligibleManagers.length - 1] : null

  const totalResponses = responses.length

  const isSuccess = message != null && (
    message.toLowerCase().includes('added')   ||
    message.toLowerCase().includes('removed') ||
    message.toLowerCase().includes('closed')  ||
    message.toLowerCase().includes('reopened') ||
    message.toLowerCase().includes('created') ||
    message.toLowerCase().includes('updated')
  )

  const isClosed = cycle.is_closed as boolean
  const opensAt  = cycle.opens_at  ? new Date(cycle.opens_at  as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const closesAt = cycle.closes_at ? new Date(cycle.closes_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <a href="/admin/360" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← 360 Review Cycles</a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{cycle.name as string}</h1>
            <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
              {(cycle.description as string | null) ?? ''}
            </p>
          </div>
          <form>
            <input type="hidden" name="cycle_id" value={cycleId} />
            <button
              formAction={isClosed ? reopenCycle : closeCycle}
              style={{ padding: '0.5rem 0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '0.8125rem', color: '#374151' }}
            >
              {isClosed ? 'Reopen Cycle' : 'Close Cycle'}
            </button>
          </form>
        </div>

        {message && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`, color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem' }}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: '1.5rem' }}>
          {(['setup', 'results'] as const).map(t => (
            <a
              key={t}
              href={`/admin/360/${cycleId}?tab=${t}`}
              style={{ padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? '#111827' : '#6b7280', textDecoration: 'none', borderBottom: activeTab === t ? '2px solid #111827' : '2px solid transparent', marginBottom: '-2px' }}
            >
              {t === 'setup' ? 'Setup' : 'Results'}
            </a>
          ))}
        </div>

        {/* ── SETUP TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Cycle details */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Cycle Details</h2>
                <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: isClosed ? '#f3f4f6' : '#f0fdf4', color: isClosed ? '#6b7280' : '#166534', fontWeight: 500 }}>
                  {isClosed ? 'Closed' : 'Open'}
                </span>
              </div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1.5rem', fontSize: '0.875rem' }}>
                <dt style={{ color: '#6b7280', fontWeight: 500 }}>Name</dt>
                <dd style={{ margin: 0, color: '#111827' }}>{cycle.name as string}</dd>
                {(cycle.description as string | null) && (
                  <>
                    <dt style={{ color: '#6b7280', fontWeight: 500 }}>Description</dt>
                    <dd style={{ margin: 0, color: '#111827' }}>{cycle.description as string}</dd>
                  </>
                )}
                <dt style={{ color: '#6b7280', fontWeight: 500 }}>Opens</dt>
                <dd style={{ margin: 0, color: '#111827' }}>{opensAt}</dd>
                <dt style={{ color: '#6b7280', fontWeight: 500 }}>Closes</dt>
                <dd style={{ margin: 0, color: '#111827' }}>{isClosed ? closesAt : '—'}</dd>
              </dl>
            </div>

            {/* Fixed Core Questions */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Fixed Core Questions (always included)</h2>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.8125rem', color: '#9ca3af' }}>These 5 questions are asked for every review cycle and cannot be modified.</p>
              <div>
                {CORE_QUESTIONS.map((q, idx) => (
                  <div key={q.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem 0', borderBottom: idx < CORE_QUESTIONS.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>{q.label}</div>
                      <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.125rem' }}>{q.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                      Rating 1–5
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Questions */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Custom Questions ({customQuestions.length}/3)</h2>

              {customQuestions.length === 0 ? (
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#9ca3af' }}>No custom questions added.</p>
              ) : (
                <div style={{ marginBottom: '1rem' }}>
                  {customQuestions.map((q, idx) => (
                    <div key={q.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0', borderBottom: idx < customQuestions.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>{q.label}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#374151' }}>
                        {QUESTION_TYPE_LABELS[q.type] ?? q.type}
                      </span>
                      <form style={{ display: 'inline' }}>
                        <input type="hidden" name="cycle_id" value={cycleId} />
                        <input type="hidden" name="question_key" value={q.key} />
                        <button formAction={removeCustomQuestion} style={{ padding: '0.25rem 0.625rem', border: '1px solid #fca5a5', borderRadius: '4px', backgroundColor: 'white', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem' }}>
                          Remove
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}

              {/* Add custom question — only when open and under limit */}
              {!isClosed && customQuestions.length < 3 && (
                <div style={{ borderTop: customQuestions.length > 0 ? '1px solid #e5e7eb' : 'none', paddingTop: customQuestions.length > 0 ? '1rem' : '0' }}>
                  <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: 600 }}>Add Custom Question</h3>
                  <form style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    <input type="hidden" name="cycle_id" value={cycleId} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        <label htmlFor="q_label" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Question text <span style={{ color: '#dc2626' }}>*</span></label>
                        <input
                          id="q_label" name="label" type="text" required maxLength={300}
                          placeholder="e.g. How well does this manager handle conflict?"
                          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        <label htmlFor="q_type" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Type</label>
                        <select id="q_type" name="type" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                          <option value="rating_5">Rating 1–5</option>
                          <option value="text">Text</option>
                        </select>
                      </div>
                    </div>
                    <button formAction={addCustomQuestion} style={{ alignSelf: 'flex-start', padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                      Add Question
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── RESULTS TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'results' && (
          <div>
            {totalResponses === 0 ? (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>No responses yet</p>
                <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
                  Results will appear here once reviewers start submitting responses.
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: 'Total Responses', value: String(totalResponses) },
                    { label: 'Managers Reviewed', value: String(managerStats.length) },
                  ].map(stat => (
                    <div key={stat.label} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                      <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.25rem' }}>{stat.label}</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Best / Needs Attention highlights */}
                {eligibleManagers.length >= 2 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {bestManager && (
                      <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Best</div>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{bestManager.name}</div>
                        <div style={{ fontSize: '0.8125rem', color: '#166534' }}>{bestManager.count} response{bestManager.count !== 1 ? 's' : ''} · avg {bestManager.overallAvg}/5</div>
                      </div>
                    )}
                    {worstManager && (
                      <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#991b1b', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Needs Attention</div>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{worstManager.name}</div>
                        <div style={{ fontSize: '0.8125rem', color: '#991b1b' }}>{worstManager.count} response{worstManager.count !== 1 ? 's' : ''} · avg {worstManager.overallAvg}/5</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Per-manager breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {managerStats.map(manager => {
                    const isBest  = bestManager?.mid  === manager.mid
                    const isWorst = worstManager?.mid === manager.mid
                    return (
                      <div
                        key={manager.mid}
                        style={{ backgroundColor: 'white', border: `1px solid ${isBest ? '#86efac' : isWorst ? '#fca5a5' : '#e5e7eb'}`, borderRadius: '8px', padding: '1.25rem' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: manager.hasEnough ? '1rem' : 0 }}>
                          <div>
                            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{manager.name}</span>
                            <span style={{ marginLeft: '0.625rem', fontSize: '0.8125rem', color: '#6b7280' }}>{manager.count} response{manager.count !== 1 ? 's' : ''}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {isBest  && <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#f0fdf4', color: '#166534', fontWeight: 500 }}>Best</span>}
                            {isWorst && <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#fef2f2', color: '#991b1b', fontWeight: 500 }}>Needs Attention</span>}
                            {manager.hasEnough && manager.overallAvg != null && (
                              <span style={{ fontSize: '1.125rem', fontWeight: 700, color: '#111827' }}>
                                {manager.overallAvg}<span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>/5</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {!manager.hasEnough ? (
                          <p style={{ margin: 0, fontSize: '0.875rem', color: '#d97706' }}>
                            ⚠ Not enough responses yet (minimum 3 required)
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {/* Core questions */}
                            {CORE_QUESTIONS.map(q => {
                              const avg = manager.coreAvgs[q.key]
                              const pct = avg != null ? (avg / 5) * 100 : 0
                              return (
                                <div key={q.key}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{q.label}</span>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>
                                      {avg != null ? `${avg}/5` : '—'}
                                    </span>
                                  </div>
                                  <div style={{ height: '6px', backgroundColor: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#111827', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                                  </div>
                                </div>
                              )
                            })}

                            {/* Custom rating questions */}
                            {customQuestions.filter(q => q.type === 'rating_5').map(q => {
                              const avg = manager.customRatingAvgs[q.key]
                              const pct = avg != null ? (avg / 5) * 100 : 0
                              return (
                                <div key={q.key}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{q.label}</span>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>
                                      {avg != null ? `${avg}/5` : '—'}
                                    </span>
                                  </div>
                                  <div style={{ height: '6px', backgroundColor: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#374151', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                                  </div>
                                </div>
                              )
                            })}

                            {/* Custom text question answers */}
                            {customQuestions.filter(q => q.type === 'text').map(q => {
                              const texts = manager.customTextPools[q.key] ?? []
                              if (texts.length < 3) return null
                              return (
                                <div key={q.key} style={{ marginTop: '0.5rem' }}>
                                  <p style={{ margin: '0 0 0.375rem 0', fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>{q.label}</p>
                                  <ul style={{ margin: 0, padding: '0 0 0 1.25rem' }}>
                                    {texts.map((text, i) => (
                                      <li key={i} style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.25rem' }}>{text}</li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            })}

                            {/* Open text pool */}
                            {manager.openTextPool.length >= 3 && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <p style={{ margin: '0 0 0.375rem 0', fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>Open Comments</p>
                                <ul style={{ margin: 0, padding: '0 0 0 1.25rem' }}>
                                  {manager.openTextPool.map((text, i) => (
                                    <li key={i} style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.25rem' }}>{text}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </PageShell>
  )
}
