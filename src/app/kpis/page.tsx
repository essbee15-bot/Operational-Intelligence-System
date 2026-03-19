import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

const CATEGORIES = [
  { key: 'sales',      label: 'Sales & Revenue',       bg: '#eff6ff', color: '#1d4ed8' },
  { key: 'finance',    label: 'Finance & Costs',        bg: '#f0fdf4', color: '#166534' },
  { key: 'operations', label: 'Operations & Delivery',  bg: '#fffbeb', color: '#92400e' },
  { key: 'customer',   label: 'Customer & Quality',     bg: '#fff1f2', color: '#9f1239' },
  { key: 'hr',         label: 'People & HR',            bg: '#faf5ff', color: '#6b21a8' },
  { key: 'projects',   label: 'Projects & Delivery',    bg: '#ecfeff', color: '#0e7490' },
  { key: 'other',      label: 'Other',                  bg: '#f3f4f6', color: '#374151' },
]

const FREQUENCIES: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annual: 'Annual', ad_hoc: 'Ad hoc',
}

export default async function KpisPage({
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
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/platform-admin/kpis')

  const isManager = profile.role === 'admin' || profile.role === 'manager'
  const adminClient = createAdminClient()

  // Load all org's active KPIs (audience/team filtering done client-side below)
  const { data: kpisRaw } = await adminClient
    .from('kpis')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .order('category')
    .order('display_order')

  // Load team memberships for current user (needed for contributor filtering)
  const { data: myMemberships } = await adminClient
    .from('team_members')
    .select('team_id')
    .eq('user_id', profile.id)

  const myTeamIds = new Set((myMemberships ?? []).map(m => m.team_id as string))

  // Apply visibility filter: all users see all KPIs, but team-scoped KPIs
  // are only visible to members of that team (or managers/admins)
  const kpis = isManager
    ? (kpisRaw ?? [])
    : (kpisRaw ?? []).filter(k =>
        k.team_id == null || myTeamIds.has(k.team_id as string)
      )

  // For each KPI, get the two most recent records (to compute current value + trend)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiWithRecords: Array<{ kpi: any; latest: any | null; previous: any | null }> = []

  if (kpis && kpis.length > 0) {
    for (const kpi of kpis) {
      const { data: records } = await adminClient
        .from('kpi_records')
        .select('id, value, date')
        .eq('kpi_id', kpi.id as string)
        .eq('organization_id', profile.organization_id)
        .order('date', { ascending: false })
        .limit(2)

      kpiWithRecords.push({
        kpi,
        latest:   records?.[0] ?? null,
        previous: records?.[1] ?? null,
      })
    }
  }

  // Group by category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCategory: Record<string, Array<{ kpi: any; latest: any | null; previous: any | null }>> = {}
  kpiWithRecords.forEach(row => {
    const cat = row.kpi.category as string
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat]!.push(row)
  })

  const totalKpis = kpiWithRecords.length

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Back */}
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem', color: '#111827' }}>KPIs</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
            {isManager
              ? 'All active KPIs for your organisation. Record values and track trends.'
              : 'All active KPIs for your organisation.'}
          </p>
        </div>
        {isManager && (
          <a href="/admin/kpis" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none', padding: '0.375rem 0.875rem', border: '1px solid #bfdbfe', borderRadius: '6px', whiteSpace: 'nowrap' }}>
            Manage KPIs →
          </a>
        )}
      </div>

      {/* Message banner */}
      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
          color: '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Empty state */}
      {totalKpis === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.5rem 0', color: '#374151', fontWeight: 500 }}>No KPIs available</p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
            {isManager
              ? <><a href="/admin/kpis" style={{ color: '#2563eb' }}>Assign KPIs</a> to your organisation to get started.</>
              : 'Contact your organisation admin to assign KPIs.'}
          </p>
        </div>
      ) : (
        CATEGORIES.map(cat => {
          const rows = byCategory[cat.key] ?? []
          if (rows.length === 0) return null

          return (
            <div key={cat.key} style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
                <span style={{ backgroundColor: cat.bg, color: cat.color, padding: '0.125rem 0.625rem', borderRadius: '9999px' }}>
                  {cat.label}
                </span>
              </h2>

              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>KPI</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Latest</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Target</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Trend</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Updated</th>
                      <th style={{ padding: '0.5rem 0.875rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ kpi, latest, previous }, idx) => {
                      const val      = latest?.value as number | null
                      const target   = kpi.target_value as number | null
                      const met      = val != null && target != null ? val >= target : null
                      const prevVal  = previous?.value as number | null

                      // Trend arrow
                      let trendArrow = '—'
                      let trendColor = '#9ca3af'
                      if (val != null && prevVal != null) {
                        if (val > prevVal)      { trendArrow = '↑'; trendColor = '#16a34a' }
                        else if (val < prevVal) { trendArrow = '↓'; trendColor = '#dc2626' }
                        else                    { trendArrow = '→'; trendColor = '#6b7280' }
                      }

                      const updatedDate = latest?.date
                        ? new Date(latest.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : null

                      return (
                        <tr key={kpi.id as string} style={{ borderBottom: idx < rows.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                          <td style={{ padding: '0.625rem 0.875rem' }}>
                            <div style={{ fontWeight: 500, color: '#111827' }}>{kpi.name as string}</div>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.125rem' }}>
                              {FREQUENCIES[kpi.target_frequency as string] ?? ''}{kpi.unit ? ` · ${kpi.unit as string}` : ''}
                            </div>
                          </td>

                          {/* Latest value */}
                          <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                            {val != null ? (
                              <span style={{ fontWeight: 600, color: met === true ? '#16a34a' : met === false ? '#dc2626' : '#111827' }}>
                                {val}{kpi.unit ? ` ${kpi.unit as string}` : ''}
                              </span>
                            ) : (
                              <span style={{ color: '#d1d5db' }}>—</span>
                            )}
                          </td>

                          {/* Target */}
                          <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: '#6b7280' }}>
                            {target != null ? `${target}${kpi.unit ? ` ${kpi.unit as string}` : ''}` : '—'}
                          </td>

                          {/* Trend */}
                          <td style={{ padding: '0.625rem 0.875rem', fontSize: '1.125rem', color: trendColor, fontWeight: 600 }}>
                            {trendArrow}
                          </td>

                          {/* Updated */}
                          <td style={{ padding: '0.625rem 0.875rem', color: '#9ca3af' }}>
                            {updatedDate ?? 'Never'}
                          </td>

                          {/* Actions */}
                          <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <a href={`/kpis/${kpi.id as string}`} style={{ fontSize: '0.75rem', color: '#374151', textDecoration: 'none', marginRight: isManager ? '0.75rem' : '0' }}>
                              View
                            </a>
                            {isManager && (
                              <a href={`/kpis/${kpi.id as string}?record=1`} style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none' }}>
                                Record
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
