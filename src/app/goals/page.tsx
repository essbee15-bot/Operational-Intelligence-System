import PageShell from '@/components/PageShell'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createObjective } from './actions'

const OBJ_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: 'Active',    bg: '#eff6ff', color: '#1d4ed8' },
  complete:  { label: 'Complete',  bg: '#f0fdf4', color: '#166534' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', color: '#6b7280' },
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; create?: string }>
}) {
  const { message, create } = await searchParams
  const showCreateForm = create === '1'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/')

  const isManager = profile.role === 'admin' || profile.role === 'manager'
  const isAdmin   = profile.role === 'admin'
  const adminClient = createAdminClient()

  // All objectives for this org
  const { data: objectives } = await adminClient
    .from('objectives')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('end_date',   { ascending: true,  nullsFirst: false })
    .order('created_at', { ascending: false })

  // All key_results for this org (to compute progress per objective)
  const { data: allKRs } = await adminClient
    .from('key_results')
    .select('objective_id, status')
    .eq('organization_id', profile.organization_id)

  // Org users + teams for display + create form
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .order('full_name')

  const { data: orgTeams } = await adminClient
    .from('teams')
    .select('id, name')
    .eq('organization_id', profile.organization_id)
    .order('name')

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )
  const teamMap: Record<string, string> = Object.fromEntries(
    (orgTeams ?? []).map(t => [t.id as string, t.name as string])
  )

  // Build progress map: objective_id → { total, complete }
  const progressMap: Record<string, { total: number; complete: number }> = {}
  ;(allKRs ?? []).forEach(kr => {
    const oid = kr.objective_id as string
    if (!progressMap[oid]) progressMap[oid] = { total: 0, complete: 0 }
    progressMap[oid]!.total++
    if (kr.status === 'complete') progressMap[oid]!.complete++
  })

  // Group by period_label (null period = "No period")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byPeriod: Record<string, any[]> = {}
  ;(objectives ?? []).forEach(obj => {
    const period = (obj.period_label as string | null) ?? ''
    if (!byPeriod[period]) byPeriod[period] = []
    byPeriod[period]!.push(obj)
  })

  // Sort periods: non-empty periods sorted desc, then empty at end
  const periods = Object.keys(byPeriod).sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (a !== '' && b === '') return -1
    return b.localeCompare(a)
  })

  const isSuccess = ['created', 'deleted', 'updated'].some(w => message?.includes(w))

  return (
    <PageShell>
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Goals &amp; OKRs</h1>
          <p className="page-subtitle">Track objectives and key results aligned to your organisation&apos;s KPIs.</p>
        </div>
        {isManager && !showCreateForm && (
          <a href="/goals?create=1" className="btn btn-primary">+ New Objective</a>
        )}
        {isManager && showCreateForm && (
          <a href="/goals" className="btn btn-secondary">Cancel</a>
        )}
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

      {/* ── Create Objective form (managers/admins — shown when ?create=1) ── */}
      {isManager && showCreateForm && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.875rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>
            New Objective
          </h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Objective *</label>
                <input
                  name="title" type="text" required maxLength={300}
                  placeholder="e.g. Grow recurring revenue by end of Q2"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                <input
                  name="description" type="text" maxLength={500}
                  placeholder="Why does this objective matter?"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Owner</label>
                <select name="owner_id" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                  <option value="">— No owner —</option>
                  {(orgUsers ?? []).map(u => (
                    <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                  Team {!isAdmin && <span style={{ color: '#dc2626' }}>*</span>}
                  {isAdmin && <span style={{ color: '#9ca3af', fontWeight: 400 }}> (optional — leave blank for org-wide)</span>}
                </label>
                <select name="team_id" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                  <option value="">— Org-wide —</option>
                  {(orgTeams ?? []).map(t => (
                    <option key={t.id as string} value={t.id as string}>{t.name as string}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Period label</label>
                <input
                  name="period_label" type="text" maxLength={100}
                  placeholder="e.g. Q2 2026, Annual 2026"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Start date</label>
                  <input name="start_date" type="date" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>End date</label>
                  <input name="end_date" type="date" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
              </div>
            </div>
            <div>
              <button
                formAction={createObjective}
                style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Create Objective
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Objectives list ──────────────────────────────────────────────── */}
      {(objectives ?? []).length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.5rem 0', color: '#374151', fontWeight: 500 }}>No objectives yet</p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
            {isManager ? 'Use the + New Objective button to get started.' : 'Your organisation hasn\'t set any objectives yet.'}
          </p>
        </div>
      ) : (
        periods.map(period => {
          const objs = byPeriod[period] ?? []
          // Sort within period: active first, then complete, then cancelled
          const sorted = [...objs].sort((a, b) => {
            const order: Record<string, number> = { active: 0, complete: 1, cancelled: 2 }
            return (order[a.status as string] ?? 0) - (order[b.status as string] ?? 0)
          })

          return (
            <div key={period || '__no_period__'} style={{ marginBottom: '1.5rem' }}>
              {period && (
                <h2 style={{ margin: '0 0 0.625rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {period}
                </h2>
              )}
              {!period && periods.length > 1 && (
                <h2 style={{ margin: '0 0 0.625rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  No period
                </h2>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {sorted.map(obj => {
                  const progress   = progressMap[obj.id as string] ?? { total: 0, complete: 0 }
                  const pct        = progress.total > 0 ? Math.round((progress.complete / progress.total) * 100) : 0
                  const statusMeta = OBJ_STATUS[obj.status as string] ?? OBJ_STATUS['active']!
                  const teamName   = obj.team_id ? (teamMap[obj.team_id as string] ?? '—') : null
                  const ownerName  = obj.owner_id ? (userMap[obj.owner_id as string] ?? '—') : null
                  const isCancelled = obj.status === 'cancelled'

                  return (
                    <a
                      key={obj.id as string}
                      href={`/goals/${obj.id as string}`}
                      style={{
                        display: 'block',
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        padding: '1rem 1.125rem',
                        textDecoration: 'none',
                        opacity: isCancelled ? 0.6 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{obj.title as string}</span>
                            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: statusMeta.bg, color: statusMeta.color, whiteSpace: 'nowrap' }}>
                              {statusMeta.label}
                            </span>
                            {teamName && (
                              <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: '#ecfeff', color: '#0e7490', whiteSpace: 'nowrap' }}>
                                {teamName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: '#6b7280', display: 'flex', gap: '0.875rem', flexWrap: 'wrap' }}>
                            {ownerName && <span>Owner: {ownerName}</span>}
                            {obj.end_date && (
                              <span>Due: {new Date(obj.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            )}
                          </div>
                        </div>
                        {/* Progress */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>
                            {progress.complete} / {progress.total}
                            <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '0.25rem' }}>KRs</span>
                          </div>
                          {progress.total > 0 && (
                            <div style={{ width: '80px', height: '4px', backgroundColor: '#e5e7eb', borderRadius: '9999px', marginTop: '0.25rem', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#166534' : '#2563eb', borderRadius: '9999px', transition: 'width 0.3s' }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
    </PageShell>
  )
}
