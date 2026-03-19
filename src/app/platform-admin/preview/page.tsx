import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

type RoleView = 'admin' | 'manager' | 'contributor'

const ROLE_LABELS: Record<RoleView, string> = {
  admin:       'Admin',
  manager:     'Manager',
  contributor: 'Contributor',
}

export default async function OrgPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; role?: string }>
}) {
  const { org: orgId, role: roleParam } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()

  // All orgs (for the org picker)
  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, name')
    .order('name')

  const roleView: RoleView = (['admin', 'manager', 'contributor'] as const).includes(roleParam as RoleView)
    ? (roleParam as RoleView)
    : 'admin'

  // ── Org-specific data (only when an org is selected) ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openActions: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshotKpis: any[] = []
  let recordsByKpi: Record<string, { value: number; date: string }[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeObjectives: any[] = []
  let progressMap: Record<string, { total: number; complete: number }> = {}
  let teamMap: Record<string, string> = {}
  let userMap: Record<string, string> = {}
  let orgName = ''

  if (orgId) {
    const selectedOrg = (orgs ?? []).find(o => o.id === orgId)
    orgName = (selectedOrg?.name as string | undefined) ?? 'Unknown Organisation'

    // 1. ALL open actions for the org (not filtered by user), most overdue first
    const { data: actionsRaw } = await adminClient
      .from('action_items')
      .select('id, action_text, title, due_date, assignee_id, meetings(id, title, purpose)')
      .eq('organization_id', orgId)
      .eq('is_closed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5)

    openActions = actionsRaw ?? []

    // 2. Org users (for assignee names)
    const { data: orgUsers } = await adminClient
      .from('users')
      .select('id, full_name, email')
      .eq('organization_id', orgId)
      .eq('is_anonymised', false)

    userMap = Object.fromEntries(
      (orgUsers ?? []).map(u => [u.id as string, (u.full_name ?? u.email ?? 'Unknown') as string])
    )

    // 3. KPIs with role-based audience filter
    const { data: kpisRaw } = await adminClient
      .from('kpis')
      .select('id, name, unit, category, target_value, audience, team_id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('category')
      .order('display_order')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKpis: any[] = kpisRaw ?? []
    // Contributor view hides management_only KPIs; admin/manager see everything
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredKpis = roleView === 'contributor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? allKpis.filter((k: any) => k.audience !== 'management_only')
      : allKpis

    snapshotKpis = filteredKpis.slice(0, 6)

    // 4. Latest KPI records (batch, up to 2 per KPI)
    if (snapshotKpis.length > 0) {
      const { data: recentRecords } = await adminClient
        .from('kpi_records')
        .select('kpi_id, value, date')
        .eq('organization_id', orgId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in('kpi_id', snapshotKpis.map((k: any) => k.id as string))
        .order('date', { ascending: false })
        .limit(snapshotKpis.length * 2 + 10)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(recentRecords ?? []).forEach((r: any) => {
        const kid = r.kpi_id as string
        if (!recordsByKpi[kid]) recordsByKpi[kid] = []
        if (recordsByKpi[kid]!.length < 2) {
          recordsByKpi[kid]!.push({ value: r.value as number, date: r.date as string })
        }
      })
    }

    // 5. Active objectives (up to 4)
    const { data: objRaw } = await adminClient
      .from('objectives')
      .select('id, title, team_id, end_date, status')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .order('end_date', { ascending: true, nullsFirst: false })
      .limit(4)

    activeObjectives = objRaw ?? []

    // 6. KR counts
    if (activeObjectives.length > 0) {
      const { data: krs } = await adminClient
        .from('key_results')
        .select('objective_id, status')
        .eq('organization_id', orgId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in('objective_id', activeObjectives.map((o: any) => o.id as string))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(krs ?? []).forEach((kr: any) => {
        const oid = kr.objective_id as string
        if (!progressMap[oid]) progressMap[oid] = { total: 0, complete: 0 }
        progressMap[oid]!.total++
        if (kr.status === 'complete') progressMap[oid]!.complete++
      })
    }

    // 7. Teams (for objective team badges)
    const { data: teamsRaw } = await adminClient
      .from('teams')
      .select('id, name')
      .eq('organization_id', orgId)

    teamMap = Object.fromEntries(
      (teamsRaw ?? []).map(t => [t.id as string, t.name as string])
    )
  }

  const now = new Date()
  const isOverdue = (d: string | null) => d != null && new Date(d) < now

  const roleTabStyle = (r: RoleView): React.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    borderRadius: '4px',
    fontSize: '0.8125rem',
    fontWeight: r === roleView ? 600 : 400,
    backgroundColor: r === roleView ? '#111827' : 'white',
    color: r === roleView ? 'white' : '#374151',
    border: `1px solid ${r === roleView ? '#111827' : '#d1d5db'}`,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem', color: '#111827' }}>Org Dashboard Preview</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          Preview how the dashboard appears for users in a specific organisation — switch role to see what each level can see.
        </p>
      </div>

      {/* ── No org selected: show picker ─────────────────────────────────── */}
      {!orgId && (
        <>
          <p style={{ margin: '0 0 0.875rem 0', color: '#374151', fontSize: '0.875rem', fontWeight: 500 }}>
            Select an organisation to preview:
          </p>
          {(orgs ?? []).length === 0 ? (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>No organisations yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
              {(orgs ?? []).map(org => (
                <a
                  key={org.id as string}
                  href={`/platform-admin/preview?org=${org.id as string}&role=admin`}
                  style={{
                    display: 'block',
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '1rem 1.125rem',
                    textDecoration: 'none',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{org.name as string}</p>
                  <p style={{ margin: '0.25rem 0 0 0', color: '#9ca3af', fontSize: '0.8125rem' }}>Preview dashboard →</p>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Org selected: show dashboard preview ────────────────────────── */}
      {orgId && (
        <>
          {/* Org header + role switcher */}
          <div style={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Viewing org</span>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', marginTop: '0.125rem' }}>{orgName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {(['admin', 'manager', 'contributor'] as RoleView[]).map(r => (
                  <a key={r} href={`/platform-admin/preview?org=${orgId}&role=${r}`} style={roleTabStyle(r)}>
                    {ROLE_LABELS[r]}
                  </a>
                ))}
              </div>
              <a href="/platform-admin/preview" style={{ fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none' }}>
                Change org
              </a>
            </div>
          </div>

          {/* Info banner */}
          <div style={{
            padding: '0.625rem 1rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.8125rem',
            color: '#92400e',
          }}>
            ℹ Open actions are shown org-wide (not personal). KPI audience filtering reflects the selected role.
            Team-scoped KPIs are shown regardless of team membership in this preview.
            {roleView === 'contributor' && (
              <span style={{ fontWeight: 600 }}> KPIs marked <span style={{ backgroundColor: '#fef3c7', padding: '0 0.25rem', borderRadius: '3px' }}>mgmt</span> are hidden from contributors.</span>
            )}
          </div>

          {/* ROW 1: Open Actions + OKR Progress */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

            {/* Open Actions widget */}
            <div style={{ flex: '1.2 1 280px', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Open Actions</h3>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#111827', color: 'white' }}>
                  {openActions.length}
                </span>
              </div>

              {openActions.length === 0 ? (
                <div style={{ padding: '0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.875rem', color: '#166534' }}>🎉 No open actions</span>
                </div>
              ) : (
                <div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {openActions.map((action: any, idx: number) => {
                    const overdue     = isOverdue(action.due_date as string | null)
                    const label       = (action.action_text as string | null) ?? (action.title as string | null) ?? 'Untitled action'
                    const assigneeName = action.assignee_id
                      ? (userMap[action.assignee_id as string] ?? 'Unknown')
                      : 'Unassigned'
                    return (
                      <div key={action.id as string}>
                        {idx > 0 && <div style={{ borderTop: '1px solid #f3f4f6', margin: '0.625rem 0' }} />}
                        <div style={{ fontSize: '0.875rem', color: '#111827', lineHeight: 1.45, marginBottom: '0.25rem' }}>
                          {label}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                          {action.due_date && (
                            <span style={{ color: overdue ? '#dc2626' : '#6b7280', fontWeight: overdue ? 600 : 400 }}>
                              {overdue ? '⚠ Overdue · ' : ''}Due {new Date(action.due_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          <span style={{ color: '#9ca3af' }}>{assigneeName}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Showing most overdue/soonest across entire org</span>
              </div>
            </div>

            {/* OKR Progress widget */}
            <div style={{ flex: '1 1 220px', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Goals & OKRs</h3>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                  {activeObjectives.length} active
                </span>
              </div>

              {activeObjectives.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>No active objectives</p>
              ) : (
                <div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {activeObjectives.map((obj: any, idx: number) => {
                    const progress = progressMap[obj.id as string] ?? { total: 0, complete: 0 }
                    const pct      = progress.total > 0 ? Math.round((progress.complete / progress.total) * 100) : 0
                    const tName    = obj.team_id ? (teamMap[obj.team_id as string] ?? null) : null
                    return (
                      <div key={obj.id as string}>
                        {idx > 0 && <div style={{ borderTop: '1px solid #f3f4f6', margin: '0.625rem 0' }} />}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500, flex: 1, lineHeight: 1.4 }}>
                            {obj.title as string}
                          </span>
                          {tName && (
                            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', backgroundColor: '#ecfeff', color: '#0e7490', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {tName}
                            </span>
                          )}
                        </div>
                        {progress.total > 0 ? (
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.2rem' }}>
                              <span>{progress.complete}/{progress.total} KRs</span>
                              <span>{pct}%</span>
                            </div>
                            <div style={{ height: '4px', backgroundColor: '#e5e7eb', borderRadius: '9999px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#166534' : '#2563eb', borderRadius: '9999px' }} />
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No key results yet</span>
                        )}
                        {obj.end_date && (
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                            Due {new Date(obj.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>All org objectives · same for all roles</span>
              </div>
            </div>
          </div>

          {/* ROW 2: KPI Snapshot */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>KPI Snapshot</h3>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#374151' }}>
                  {snapshotKpis.length}
                </span>
              </div>
              {roleView === 'contributor' && (
                <span style={{ fontSize: '0.75rem', color: '#92400e', backgroundColor: '#fef3c7', padding: '0.15rem 0.5rem', borderRadius: '9999px' }}>
                  management_only hidden
                </span>
              )}
            </div>

            {snapshotKpis.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>
                {roleView === 'contributor' ? 'No KPIs visible to contributors in this org' : 'No KPIs assigned to this organisation'}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.75rem' }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {snapshotKpis.map((kpi: any) => {
                  const records  = recordsByKpi[kpi.id as string] ?? []
                  const current  = records[0]?.value ?? null
                  const prev     = records[1]?.value ?? null
                  const target   = kpi.target_value as number | null
                  const unit     = kpi.unit as string | null
                  const isMgmtOnly = kpi.audience === 'management_only'

                  let trendIcon  = '→'
                  let trendColor = '#9ca3af'
                  if (current != null && prev != null) {
                    if (current > prev)      { trendIcon = '↑'; trendColor = '#166534' }
                    else if (current < prev) { trendIcon = '↓'; trendColor = '#dc2626' }
                  }

                  const onTarget = target != null && current != null && current >= target

                  return (
                    <div
                      key={kpi.id as string}
                      style={{
                        backgroundColor: '#f9fafb',
                        border: `1px solid ${isMgmtOnly ? '#fde68a' : '#e5e7eb'}`,
                        borderRadius: '6px',
                        padding: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.25rem', marginBottom: '0.375rem' }}>
                        <div style={{ fontSize: '0.8125rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {kpi.name as string}
                        </div>
                        {isMgmtOnly && (
                          <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', borderRadius: '9999px', backgroundColor: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            mgmt
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                          {current != null ? current.toLocaleString() : '—'}
                        </span>
                        {unit && current != null && (
                          <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>{unit}</span>
                        )}
                        {current != null && (
                          <span style={{ fontSize: '0.9rem', color: trendColor, marginLeft: 'auto', fontWeight: 600 }}>{trendIcon}</span>
                        )}
                      </div>
                      {target != null && current != null && (
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '9999px',
                          backgroundColor: onTarget ? '#f0fdf4' : '#fef2f2',
                          color: onTarget ? '#166534' : '#991b1b',
                        }}>
                          {onTarget ? '✓ on target' : '✗ below target'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
