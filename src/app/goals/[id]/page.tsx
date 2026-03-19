import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import {
  addKeyResult, updateKeyResult, removeKeyResult,
  updateObjectiveStatus, deleteObjective,
} from './actions'

const KR_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  not_started: { label: 'Not started', bg: '#f3f4f6', color: '#374151' },
  on_track:    { label: 'On track',    bg: '#f0fdf4', color: '#166534' },
  at_risk:     { label: 'At risk',     bg: '#fffbeb', color: '#92400e' },
  complete:    { label: 'Complete',    bg: '#eff6ff', color: '#1d4ed8' },
  missed:      { label: 'Missed',      bg: '#fef2f2', color: '#991b1b' },
}

const OBJ_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: 'Active',    bg: '#eff6ff', color: '#1d4ed8' },
  complete:  { label: 'Complete',  bg: '#f0fdf4', color: '#166534' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', color: '#6b7280' },
}

const CATEGORIES: Record<string, string> = {
  sales: 'Sales & Revenue', finance: 'Finance & Costs', operations: 'Operations & Delivery',
  customer: 'Customer & Quality', hr: 'People & HR', projects: 'Projects & Delivery', other: 'Other',
}

export default async function GoalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const { id: objectiveId } = await params
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

  const isManager = profile.role === 'admin' || profile.role === 'manager'
  const isAdmin   = profile.role === 'admin'
  const adminClient = createAdminClient()

  // Load objective (verify org ownership)
  const { data: objective } = await adminClient
    .from('objectives')
    .select('*')
    .eq('id', objectiveId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!objective) redirect('/goals?message=Objective not found')

  // Load key results ordered by display_order
  const { data: keyResults } = await adminClient
    .from('key_results')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('organization_id', profile.organization_id)
    .order('display_order')

  // Org users + teams for display
  const [{ data: orgUsers }, { data: orgTeams }] = await Promise.all([
    adminClient.from('users').select('id, full_name, email').eq('organization_id', profile.organization_id).eq('is_anonymised', false).order('full_name'),
    adminClient.from('teams').select('id, name').eq('organization_id', profile.organization_id).order('name'),
  ])

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )
  const teamMap: Record<string, string> = Object.fromEntries(
    (orgTeams ?? []).map(t => [t.id as string, t.name as string])
  )

  // Org KPIs for the add-KR form (grouped by category)
  const { data: orgKpis } = await adminClient
    .from('kpis')
    .select('id, name, unit, category')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .order('category')
    .order('display_order')

  // For KRs with kpi_id: load latest kpi_records for each
  const kpiIds = (keyResults ?? []).filter(kr => kr.kpi_id).map(kr => kr.kpi_id as string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestKpiRecordMap: Record<string, { value: number; date: string; unit: string | null }> = {}

  if (kpiIds.length > 0) {
    // Load KPI metadata for linked KPIs
    const { data: linkedKpis } = await adminClient
      .from('kpis')
      .select('id, name, unit')
      .in('id', kpiIds)

    const kpiMeta: Record<string, { name: string; unit: string | null }> = Object.fromEntries(
      (linkedKpis ?? []).map(k => [k.id as string, { name: k.name as string, unit: k.unit as string | null }])
    )

    // Load latest record for each linked KPI
    for (const kpiId of kpiIds) {
      const { data: records } = await adminClient
        .from('kpi_records')
        .select('value, date')
        .eq('kpi_id', kpiId)
        .eq('organization_id', profile.organization_id)
        .order('date', { ascending: false })
        .limit(1)

      if (records?.[0]) {
        latestKpiRecordMap[kpiId] = {
          value: records[0].value as number,
          date:  records[0].date as string,
          unit:  kpiMeta[kpiId]?.unit ?? null,
        }
      }
    }

    // Store kpi names for display on KR rows
    // attach to window-like mapping
    Object.assign(latestKpiRecordMap, { __kpiMeta: kpiMeta })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiMeta = (latestKpiRecordMap as any).__kpiMeta as Record<string, { name: string; unit: string | null }> | undefined ?? {}

  // Progress summary
  const total    = (keyResults ?? []).length
  const complete = (keyResults ?? []).filter(kr => kr.status === 'complete').length
  const pct      = total > 0 ? Math.round((complete / total) * 100) : 0

  const objStatusMeta = OBJ_STATUS[objective.status as string] ?? OBJ_STATUS['active']!
  const ownerName     = objective.owner_id ? (userMap[objective.owner_id as string] ?? '—') : '—'
  const teamName      = objective.team_id  ? (teamMap[objective.team_id as string]  ?? '—') : null

  const isSuccess = ['added', 'updated', 'removed', 'deleted', 'created'].some(w => message?.includes(w))

  // Group org KPIs by category for the add-KR form
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpisByCategory: Record<string, any[]> = {}
  ;(orgKpis ?? []).forEach(k => {
    const cat = k.category as string
    if (!kpisByCategory[cat]) kpisByCategory[cat] = []
    kpisByCategory[cat]!.push(k)
  })

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/goals" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Goals & OKRs</a>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* ── Header card ─────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: objStatusMeta.bg, color: objStatusMeta.color }}>
                {objStatusMeta.label}
              </span>
              {teamName && (
                <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: '#ecfeff', color: '#0e7490' }}>
                  {teamName}
                </span>
              )}
            </div>
            <h1 style={{ margin: '0 0 0.375rem 0', fontSize: '1.375rem', color: '#111827' }}>{objective.title as string}</h1>
            {objective.description && (
              <p style={{ margin: '0 0 0.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>{objective.description as string}</p>
            )}
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.5rem' }}>
              <span><strong style={{ color: '#374151' }}>Owner:</strong> {ownerName}</span>
              {objective.period_label && <span><strong style={{ color: '#374151' }}>Period:</strong> {objective.period_label as string}</span>}
              {objective.start_date && <span><strong style={{ color: '#374151' }}>Start:</strong> {new Date(objective.start_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              {objective.end_date && <span><strong style={{ color: '#374151' }}>Due:</strong> {new Date(objective.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
            </div>
          </div>
          {/* Progress circle-ish */}
          {total > 0 && (
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', lineHeight: 1 }}>{pct}%</div>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>{complete}/{total} KRs</div>
            </div>
          )}
        </div>

        {/* Update status + Delete (managers/admins) */}
        {isManager && (
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid #f3f4f6', alignItems: 'center', flexWrap: 'wrap' }}>
            <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="hidden" name="objective_id" value={objectiveId} />
              <label style={{ fontSize: '0.8125rem', color: '#6b7280', whiteSpace: 'nowrap' }}>Status:</label>
              <select name="status" defaultValue={objective.status as string} style={{ padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button formAction={updateObjectiveStatus} style={{ padding: '0.375rem 0.75rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                Update
              </button>
            </form>
            {isAdmin && (
              <form style={{ marginLeft: 'auto' }}>
                <input type="hidden" name="objective_id" value={objectiveId} />
                <button
                  formAction={deleteObjective}
                  style={{ fontSize: '0.8125rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  title="Permanently delete this objective and all its key results"
                >
                  Delete objective
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ── Key Results ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Key Results</h2>
          {total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '120px', height: '6px', backgroundColor: '#e5e7eb', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#166534' : '#2563eb', borderRadius: '9999px' }} />
              </div>
              <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{complete}/{total} complete</span>
            </div>
          )}
        </div>

        {(!keyResults || keyResults.length === 0) ? (
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
            No key results yet.{isManager ? ' Add the first one below.' : ''}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {keyResults.map(kr => {
              const krStatus = KR_STATUS[kr.status as string] ?? KR_STATUS['not_started']!
              const hasTarget = kr.target_value != null
              const latestKpi = kr.kpi_id ? latestKpiRecordMap[kr.kpi_id as string] : null
              const linkedKpiName = kr.kpi_id ? (kpiMeta[kr.kpi_id as string]?.name ?? null) : null

              return (
                <div key={kr.id as string} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.125rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500, color: '#111827', fontSize: '0.9375rem' }}>{kr.title as string}</span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: krStatus.bg, color: krStatus.color }}>
                          {krStatus.label}
                        </span>
                      </div>
                      {kr.description && (
                        <p style={{ margin: '0 0 0.375rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>{kr.description as string}</p>
                      )}
                      {/* Progress values */}
                      <div style={{ fontSize: '0.8125rem', color: '#374151', marginBottom: '0.25rem' }}>
                        {kr.current_value != null ? (
                          <>
                            <strong>{kr.current_value as number}{kr.unit ? ` ${kr.unit as string}` : ''}</strong>
                            {hasTarget && (
                              <span style={{ color: '#9ca3af' }}> / {kr.target_value as number}{kr.unit ? ` ${kr.unit as string}` : ''}</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: '#d1d5db' }}>No progress recorded{hasTarget ? ` — target: ${kr.target_value as number}${kr.unit ? ` ${kr.unit as string}` : ''}` : ''}</span>
                        )}
                      </div>
                      {/* KPI link */}
                      {linkedKpiName && (
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic' }}>
                          Linked KPI: <a href={`/kpis/${kr.kpi_id as string}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{linkedKpiName}</a>
                          {latestKpi ? (
                            <> — Latest reading: <strong style={{ color: '#6b7280' }}>{latestKpi.value}{latestKpi.unit ? ` ${latestKpi.unit}` : ''}</strong> on {new Date(latestKpi.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                          ) : (
                            <> — No readings recorded</>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {isManager && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <form style={{ display: 'inline' }}>
                          <input type="hidden" name="objective_id" value={objectiveId} />
                          <input type="hidden" name="key_result_id" value={kr.id as string} />
                          <button formAction={removeKeyResult} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            Remove
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {/* Update progress form (managers/admins) */}
                  {isManager && (
                    <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6', flexWrap: 'wrap' }}>
                      <input type="hidden" name="objective_id" value={objectiveId} />
                      <input type="hidden" name="key_result_id" value={kr.id as string} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: '#6b7280' }}>Current value{kr.unit ? ` (${kr.unit as string})` : ''}</label>
                        <input
                          name="current_value" type="number" step="any"
                          defaultValue={kr.current_value != null ? String(kr.current_value) : ''}
                          placeholder={hasTarget ? `Target: ${kr.target_value as number}` : 'Enter value'}
                          style={{ padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem', width: '120px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', color: '#6b7280' }}>Status</label>
                        <select name="status" defaultValue={kr.status as string} style={{ padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                          <option value="not_started">Not started</option>
                          <option value="on_track">On track</option>
                          <option value="at_risk">At risk</option>
                          <option value="complete">Complete</option>
                          <option value="missed">Missed</option>
                        </select>
                      </div>
                      <button formAction={updateKeyResult} style={{ padding: '0.375rem 0.875rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem', alignSelf: 'flex-end' }}>
                        Update
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add Key Result form (managers/admins) ──────────────────────────── */}
      {isManager && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
          <h2 style={{ margin: '0 0 0.875rem 0', fontSize: '1rem', fontWeight: 600 }}>Add Key Result</h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="objective_id" value={objectiveId} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Key Result title *</label>
                <input
                  name="title" type="text" required maxLength={300}
                  placeholder="e.g. Increase MRR to £50k"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                <input
                  name="description" type="text" maxLength={300}
                  placeholder="How will you measure this?"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                  Link to KPI <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
                </label>
                <select name="kpi_id" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                  <option value="">— No KPI link —</option>
                  {Object.entries(kpisByCategory).map(([cat, kpis]) => (
                    <optgroup key={cat} label={CATEGORIES[cat] ?? cat}>
                      {kpis.map(k => (
                        <option key={k.id as string} value={k.id as string}>
                          {k.name as string}{k.unit ? ` (${k.unit as string})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Initial status</label>
                <select name="status" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                  <option value="not_started">Not started</option>
                  <option value="on_track">On track</option>
                  <option value="at_risk">At risk</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Target value</label>
                <input
                  name="target_value" type="number" step="any"
                  placeholder="Optional"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Unit</label>
                <input
                  name="unit" type="text" maxLength={50}
                  placeholder="£, %, count…"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
            </div>
            <div>
              <button
                formAction={addKeyResult}
                style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Add Key Result
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
