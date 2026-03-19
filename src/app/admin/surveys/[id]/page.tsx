import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { addQuestion, removeQuestion, openPeriod, closePeriod, toggleSurveyActive, updateSurvey } from '../actions'

const QUESTION_TYPE_LABELS: Record<string, string> = {
  rating_5:  'Rating 1–5',
  rating_10: 'Rating 1–10',
  nps:       'NPS (0–10)',
  yes_no:    'Yes / No',
  text:      'Text',
}

const FREQUENCY_LABELS: Record<string, string> = {
  weekly:    'Weekly',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  annual:    'Annual',
  ad_hoc:    'Ad hoc',
}

function calcNps(values: number[]): number | null {
  if (values.length === 0) return null
  const promoters  = values.filter(v => v >= 9).length
  const detractors = values.filter(v => v <= 6).length
  return Math.round(((promoters - detractors) / values.length) * 100)
}

export default async function AdminSurveyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; period?: string; message?: string }>
}) {
  const { id: surveyId } = await params
  const { tab: tabParam, period: periodParam, message } = await searchParams

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

  // Load survey
  const { data: survey } = await adminClient
    .from('pulse_surveys')
    .select('*')
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!survey) redirect('/admin/surveys?message=Survey not found')

  // Load periods
  const { data: periods } = await adminClient
    .from('pulse_periods')
    .select('*')
    .eq('survey_id', surveyId)
    .eq('organization_id', profile.organization_id)
    .order('opens_at', { ascending: false })

  // Load teams
  const { data: teams } = await adminClient
    .from('teams')
    .select('id, name')
    .eq('organization_id', profile.organization_id)
    .order('name')

  const teamMap = Object.fromEntries((teams ?? []).map(t => [t.id as string, t.name as string]))

  const activeTab = tabParam === 'results' ? 'results' : 'setup'
  const allPeriods = periods ?? []

  // Selected period for results tab
  const selectedPeriodId = periodParam ?? (allPeriods[0]?.id as string | undefined) ?? null

  // ── Results data (only load on results tab) ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let responses: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let completions: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orgMembers: any[] = []

  if (activeTab === 'results' && selectedPeriodId) {
    const [respResult, compResult, memberResult] = await Promise.all([
      adminClient
        .from('pulse_responses')
        .select('team_id, answers')
        .eq('period_id', selectedPeriodId)
        .eq('organization_id', profile.organization_id),
      adminClient
        .from('pulse_completions')
        .select('user_id, team_id')
        .eq('period_id', selectedPeriodId),
      adminClient
        .from('team_members')
        .select('team_id, user_id')
        .eq('organization_id', profile.organization_id),
    ])
    responses   = respResult.data ?? []
    completions = compResult.data ?? []
    orgMembers  = memberResult.data ?? []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = (survey.questions as any[]) ?? []
  const questionsArr = questions as Array<{ key: string; label: string; type: string; required: boolean }>

  // ── Aggregate results ─────────────────────────────────────────────────────
  const responsesByTeam: Record<string, typeof responses> = {}
  responses.forEach(r => {
    const tid = r.team_id as string
    if (!responsesByTeam[tid]) responsesByTeam[tid] = []
    responsesByTeam[tid].push(r)
  })

  const membersByTeam: Record<string, number> = {}
  orgMembers.forEach(m => {
    const tid = m.team_id as string
    membersByTeam[tid] = (membersByTeam[tid] ?? 0) + 1
  })

  const completionsByTeam: Record<string, number> = {}
  completions.forEach(c => {
    const tid = c.team_id as string
    completionsByTeam[tid] = (completionsByTeam[tid] ?? 0) + 1
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function aggregateForTeam(teamResponses: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {}
    questionsArr.forEach(q => {
      const vals = teamResponses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map(r => (r.answers as any[]).find((a: any) => a.key === q.key)?.value)
        .filter((v): v is string | number => v != null && v !== '')

      if (q.type === 'text') {
        result[q.key] = { type: 'text', values: vals as string[], count: vals.length }
      } else if (q.type === 'yes_no') {
        const yesCount = vals.filter(v => v === 'yes' || v === 'true').length
        const pctYes = vals.length > 0 ? Math.round((yesCount / vals.length) * 100) : null
        result[q.key] = { type: 'yes_no', pctYes, count: vals.length }
      } else if (q.type === 'nps') {
        const numVals = vals.map(v => parseFloat(String(v))).filter(v => !isNaN(v))
        result[q.key] = { type: 'nps', nps: calcNps(numVals), count: numVals.length }
      } else {
        // rating_5 or rating_10
        const numVals = vals.map(v => parseFloat(String(v))).filter(v => !isNaN(v))
        const avg = numVals.length > 0
          ? Math.round((numVals.reduce((a, b) => a + b, 0) / numVals.length) * 10) / 10
          : null
        const maxVal = q.type === 'rating_5' ? 5 : 10
        const dist: Record<number, number> = {}
        for (let i = 1; i <= maxVal; i++) dist[i] = 0
        numVals.forEach(v => { if (dist[v] !== undefined) dist[v]++ })
        result[q.key] = { type: q.type, avg, count: numVals.length, dist, maxVal }
      }
    })
    return result
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function teamNumericAvg(agg: Record<string, any>): number | null {
    const vals: number[] = []
    questionsArr.forEach(q => {
      const a = agg[q.key]
      if (!a) return
      if ((a.type === 'rating_5' || a.type === 'rating_10') && a.avg != null) {
        vals.push(a.avg / a.maxVal)
      } else if (a.type === 'nps' && a.nps != null) {
        vals.push((a.nps + 100) / 200)
      } else if (a.type === 'yes_no' && a.pctYes != null) {
        vals.push(a.pctYes / 100)
      }
    })
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const teamStats = Object.keys(responsesByTeam).map(tid => {
    const teamResponses = responsesByTeam[tid] ?? []
    const count = teamResponses.length
    const hasEnough = count >= 3
    const agg = hasEnough ? aggregateForTeam(teamResponses) : null
    const numAvg = agg ? teamNumericAvg(agg) : null
    return { tid, count, hasEnough, agg, numAvg, name: teamMap[tid] ?? 'Unknown Team' }
  }).sort((a, b) => (b.numAvg ?? -Infinity) - (a.numAvg ?? -Infinity))

  const eligibleTeams = teamStats.filter(t => t.numAvg != null)
  const bestTeam  = eligibleTeams.length >= 2 ? eligibleTeams[0] : null
  const worstTeam = eligibleTeams.length >= 2 ? eligibleTeams[eligibleTeams.length - 1] : null

  const totalResponses   = responses.length
  const totalCompletions = completions.length
  const totalMembers     = orgMembers.length
  const completionRate   = totalMembers > 0 ? Math.round((totalCompletions / totalMembers) * 100) : 0

  const isSuccess = message != null && (
    message.toLowerCase().includes('added') || message.toLowerCase().includes('removed') ||
    message.toLowerCase().includes('opened') || message.toLowerCase().includes('closed') ||
    message.toLowerCase().includes('saved') || message.toLowerCase().includes('activated') ||
    message.toLowerCase().includes('deactivated') || message.toLowerCase().includes('created') ||
    message.toLowerCase().includes('updated')
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/admin/surveys" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Pulse Surveys</a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{survey.name as string}</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            {FREQUENCY_LABELS[survey.frequency as string] ?? (survey.frequency as string)}
            {(survey.description as string | null) ? ` · ${survey.description as string}` : ''}
            {!(survey.is_active as boolean) && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#6b7280' }}>Inactive</span>
            )}
          </p>
        </div>
        <form>
          <input type="hidden" name="survey_id" value={surveyId} />
          <input type="hidden" name="is_active" value={String(survey.is_active as boolean)} />
          <button formAction={toggleSurveyActive} style={{ padding: '0.5rem 0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '0.8125rem', color: '#374151' }}>
            {survey.is_active ? 'Deactivate' : 'Activate'}
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
            href={`/admin/surveys/${surveyId}?tab=${t}`}
            style={{ padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? '#111827' : '#6b7280', textDecoration: 'none', borderBottom: activeTab === t ? '2px solid #111827' : '2px solid transparent', marginBottom: '-2px' }}
          >
            {t === 'setup' ? 'Setup' : `Results (${allPeriods.length})`}
          </a>
        ))}
      </div>

      {/* ── SETUP TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Survey details */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Survey Details</h2>
            <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input type="hidden" name="survey_id" value={surveyId} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label htmlFor="edit_name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Survey name <span style={{ color: '#dc2626' }}>*</span></label>
                  <input id="edit_name" name="name" type="text" required maxLength={200} defaultValue={survey.name as string}
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label htmlFor="edit_frequency" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Frequency</label>
                  <select id="edit_frequency" name="frequency" defaultValue={survey.frequency as string}
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="ad_hoc">Ad hoc</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="edit_description" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                <input id="edit_description" name="description" type="text" maxLength={300}
                  defaultValue={(survey.description as string | null) ?? ''}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
              </div>
              <button formAction={updateSurvey} style={{ alignSelf: 'flex-start', padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                Save Changes
              </button>
            </form>
          </div>

          {/* Questions */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Questions ({questionsArr.length})</h2>
            {questionsArr.length === 0 ? (
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#9ca3af' }}>No questions yet. Add at least one question before opening a period.</p>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                {questionsArr.map((q, idx) => (
                  <div key={q.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0', borderBottom: idx < questionsArr.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>{q.label}</span>
                      {q.required && <span style={{ marginLeft: '0.375rem', fontSize: '0.7rem', color: '#dc2626' }}>required</span>}
                    </div>
                    <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#374151' }}>
                      {QUESTION_TYPE_LABELS[q.type] ?? q.type}
                    </span>
                    <form>
                      <input type="hidden" name="survey_id" value={surveyId} />
                      <input type="hidden" name="question_key" value={q.key} />
                      <button formAction={removeQuestion} style={{ padding: '0.25rem 0.625rem', border: '1px solid #fca5a5', borderRadius: '4px', backgroundColor: 'white', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem' }}>
                        Remove
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            {/* Add question */}
            <div style={{ borderTop: questionsArr.length > 0 ? '1px solid #e5e7eb' : 'none', paddingTop: questionsArr.length > 0 ? '1rem' : '0' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: 600 }}>Add Question</h3>
              <form style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <input type="hidden" name="survey_id" value={surveyId} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label htmlFor="q_label" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Question text <span style={{ color: '#dc2626' }}>*</span></label>
                    <input id="q_label" name="label" type="text" required maxLength={300}
                      placeholder="e.g. How satisfied are you with team collaboration?"
                      style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label htmlFor="q_type" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Type</label>
                    <select id="q_type" name="type" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                      <option value="rating_5">Rating 1–5</option>
                      <option value="rating_10">Rating 1–10</option>
                      <option value="nps">NPS (0–10)</option>
                      <option value="yes_no">Yes / No</option>
                      <option value="text">Text</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label htmlFor="q_required" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Required</label>
                    <select id="q_required" name="required" defaultValue="true" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                </div>
                <button formAction={addQuestion} style={{ alignSelf: 'flex-start', padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  Add Question
                </button>
              </form>
            </div>
          </div>

          {/* Periods */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Survey Periods</h2>
            {allPeriods.length === 0 ? (
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#9ca3af' }}>No periods yet. Open a period to start collecting responses.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: '1rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Label</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Opened</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Status</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {allPeriods.map((period, idx) => (
                    <tr key={period.id as string} style={{ borderBottom: idx < allPeriods.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                      <td style={{ padding: '0.625rem 0.75rem', color: '#111827', fontWeight: 500 }}>{period.period_label as string}</td>
                      <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280' }}>
                        {new Date(period.opens_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem' }}>
                        <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: period.is_closed ? '#f3f4f6' : '#f0fdf4', color: period.is_closed ? '#6b7280' : '#166534' }}>
                          {period.is_closed ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                        {!(period.is_closed as boolean) && (
                          <form style={{ display: 'inline' }}>
                            <input type="hidden" name="period_id" value={period.id as string} />
                            <input type="hidden" name="survey_id" value={surveyId} />
                            <button formAction={closePeriod} style={{ padding: '0.25rem 0.625rem', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '0.75rem', color: '#374151' }}>
                              Close
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Open new period */}
            <div style={{ borderTop: allPeriods.length > 0 ? '1px solid #e5e7eb' : 'none', paddingTop: allPeriods.length > 0 ? '1rem' : '0' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: 600 }}>Open New Period</h3>
              {questionsArr.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>Add questions to this survey before opening a period.</p>
              ) : (
                <form style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                  <input type="hidden" name="survey_id" value={surveyId} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1, maxWidth: '300px' }}>
                    <label htmlFor="period_label" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Period label <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      id="period_label" name="period_label" type="text" required maxLength={100}
                      placeholder={`e.g. ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
                      style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                    />
                  </div>
                  <button formAction={openPeriod} style={{ padding: '0.5rem 1rem', backgroundColor: '#166534', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    Open Period
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'results' && (
        <div>
          {allPeriods.length === 0 ? (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
              <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>No periods yet</p>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
                <a href={`/admin/surveys/${surveyId}?tab=setup`} style={{ color: '#2563eb' }}>Open a period</a>{' '}
                in the Setup tab to start collecting responses.
              </p>
            </div>
          ) : (
            <>
              {/* Period selector */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                {allPeriods.map(p => (
                  <a
                    key={p.id as string}
                    href={`/admin/surveys/${surveyId}?tab=results&period=${p.id as string}`}
                    style={{ padding: '0.375rem 0.875rem', border: `1px solid ${selectedPeriodId === p.id ? '#111827' : '#d1d5db'}`, borderRadius: '4px', fontSize: '0.8125rem', textDecoration: 'none', backgroundColor: selectedPeriodId === p.id ? '#111827' : 'white', color: selectedPeriodId === p.id ? 'white' : '#374151', fontWeight: selectedPeriodId === p.id ? 600 : 400 }}
                  >
                    {p.period_label as string}
                    {!(p.is_closed as boolean) && (
                      <span style={{ marginLeft: '0.375rem', fontSize: '0.7rem', color: selectedPeriodId === p.id ? '#86efac' : '#166534' }}>●</span>
                    )}
                  </a>
                ))}
              </div>

              {selectedPeriodId && (
                <>
                  {/* Summary stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {[
                      { label: 'Total Responses', value: String(totalResponses) },
                      { label: 'Completion Rate', value: `${completionRate}%` },
                      { label: 'Teams Responded', value: String(teamStats.length) },
                    ].map(stat => (
                      <div key={stat.label} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.25rem' }}>{stat.label}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{stat.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Best / Worst team highlights */}
                  {eligibleTeams.length >= 2 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      {bestTeam && (
                        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1rem' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🏆 Best Team</div>
                          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{bestTeam.name}</div>
                          <div style={{ fontSize: '0.8125rem', color: '#166534' }}>{bestTeam.count} response{bestTeam.count !== 1 ? 's' : ''}</div>
                        </div>
                      )}
                      {worstTeam && (
                        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#991b1b', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚠ Needs Attention</div>
                          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#111827' }}>{worstTeam.name}</div>
                          <div style={{ fontSize: '0.8125rem', color: '#991b1b' }}>{worstTeam.count} response{worstTeam.count !== 1 ? 's' : ''}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Teams table */}
                  {teamStats.length === 0 ? (
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
                      <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>No responses yet for this period.</p>
                    </div>
                  ) : (
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
                        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>Team Results</h3>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#9ca3af' }}>
                          Teams with fewer than 3 responses are hidden to protect anonymity.
                        </p>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Team</th>
                              <th style={{ textAlign: 'right', padding: '0.625rem 0.75rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Responses</th>
                              <th style={{ textAlign: 'right', padding: '0.625rem 0.75rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Members</th>
                              {questionsArr.filter(q => q.type !== 'text').map(q => (
                                <th key={q.key} style={{ textAlign: 'right', padding: '0.625rem 0.75rem', fontWeight: 600, color: '#374151', fontSize: '0.75rem', maxWidth: '120px' }}>
                                  {q.label.length > 22 ? q.label.slice(0, 22) + '…' : q.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {teamStats.map((team, idx) => {
                              const isBest  = bestTeam?.tid === team.tid
                              const isWorst = worstTeam?.tid === team.tid
                              return (
                                <tr key={team.tid} style={{ borderBottom: idx < teamStats.length - 1 ? '1px solid #f3f4f6' : 'none', backgroundColor: isBest ? '#f0fdf4' : isWorst ? '#fff5f5' : 'white' }}>
                                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#111827', whiteSpace: 'nowrap' }}>
                                    {team.name}
                                    {isBest  && <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem' }}>🏆</span>}
                                    {isWorst && <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem' }}>⚠</span>}
                                  </td>
                                  <td style={{ padding: '0.75rem 0.75rem', textAlign: 'right', color: '#374151' }}>{team.count}</td>
                                  <td style={{ padding: '0.75rem 0.75rem', textAlign: 'right', color: '#6b7280' }}>{membersByTeam[team.tid] ?? '—'}</td>
                                  {questionsArr.filter(q => q.type !== 'text').map(q => {
                                    if (!team.hasEnough) {
                                      return (
                                        <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right', color: '#9ca3af', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                          &lt;3 responses
                                        </td>
                                      )
                                    }
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    const a = team.agg?.[q.key] as any
                                    if (!a) return <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right', color: '#9ca3af' }}>—</td>

                                    if (a.type === 'rating_5' || a.type === 'rating_10') {
                                      return (
                                        <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right' }}>
                                          <span style={{ fontWeight: 600, color: '#111827' }}>{a.avg ?? '—'}</span>
                                          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>/{a.maxVal}</span>
                                        </td>
                                      )
                                    }
                                    if (a.type === 'nps') {
                                      const npsColor = a.nps == null ? '#9ca3af' : a.nps >= 50 ? '#166534' : a.nps >= 0 ? '#92400e' : '#991b1b'
                                      return (
                                        <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right' }}>
                                          <span style={{ fontWeight: 600, color: npsColor }}>{a.nps != null ? a.nps : '—'}</span>
                                        </td>
                                      )
                                    }
                                    if (a.type === 'yes_no') {
                                      return (
                                        <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right' }}>
                                          <span style={{ fontWeight: 600, color: '#111827' }}>{a.pctYes != null ? `${a.pctYes}%` : '—'}</span>
                                        </td>
                                      )
                                    }
                                    return <td key={q.key} style={{ padding: '0.75rem 0.75rem', textAlign: 'right', color: '#9ca3af' }}>—</td>
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Text responses section */}
                      {questionsArr.some(q => q.type === 'text') && teamStats.some(t => t.hasEnough) && (
                        <div style={{ borderTop: '1px solid #e5e7eb', padding: '1.25rem' }}>
                          <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Text Responses</h4>
                          {teamStats.filter(t => t.hasEnough).map(team => (
                            <div key={team.tid} style={{ marginBottom: '1.25rem' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}>{team.name}</div>
                              {questionsArr.filter(q => q.type === 'text').map(q => {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const a = team.agg?.[q.key] as any
                                if (!a || (a.count as number) < 3) {
                                  return (
                                    <div key={q.key} style={{ marginBottom: '0.5rem' }}>
                                      <div style={{ fontSize: '0.8125rem', color: '#6b7280', fontStyle: 'italic', marginBottom: '0.25rem' }}>{q.label}</div>
                                      <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>
                                        Not enough responses ({(a?.count as number) ?? 0} — minimum 3 required to protect anonymity)
                                      </p>
                                    </div>
                                  )
                                }
                                return (
                                  <div key={q.key} style={{ marginBottom: '0.75rem' }}>
                                    <div style={{ fontSize: '0.8125rem', color: '#6b7280', fontStyle: 'italic', marginBottom: '0.375rem' }}>{q.label}</div>
                                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                                      {(a.values as string[]).map((v: string, i: number) => (
                                        <li key={i} style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '0.25rem' }}>{v}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
