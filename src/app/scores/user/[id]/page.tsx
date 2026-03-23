import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

function buildSparklinePath(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 60, H = 16
  return values.map((v, i) => {
    const x = ((i / (values.length - 1)) * W).toFixed(1)
    const y = (H - ((v - min) / range) * H).toFixed(1)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

export default async function UserScoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: targetUserId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()
  if (!profile || !profile.organization_id) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string

  // Get target user
  const { data: targetUser } = await adminClient
    .from('users')
    .select('id, full_name, email, role, manager_id, organization_id')
    .eq('id', targetUserId)
    .single()

  if (!targetUser || (targetUser.organization_id as string) !== orgId) redirect('/scores')

  // Access control: must be the user's manager OR an admin
  const viewerRole = profile.role as string
  const isAdmin = viewerRole === 'admin'
  const isManager = (targetUser.manager_id as string | null) === user.id
  if (!isAdmin && !isManager) redirect('/scores')

  const targetName = (targetUser.full_name as string) || (targetUser.email as string)
  const today = new Date().toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Dimensions
  const { data: dimensionsRaw } = await adminClient
    .from('score_dimensions')
    .select('key, name, description, source, display_order')
    .eq('is_active', true)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order('display_order', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dimensions = (dimensionsRaw ?? []) as any[]

  // Bands
  const { data: bandsRaw } = await adminClient
    .from('score_bands')
    .select('band_key, label, min_score, max_score, color, display_order')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order('display_order', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bands = (bandsRaw ?? []) as any[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function resolveBand(score: number): any | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bands.find((b: any) => score >= (b.min_score as number) && score <= (b.max_score as number)) ?? null
  }

  // Latest snapshot per dimension
  const { data: latestSnapshotsRaw } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, band_key, snapshot_date, is_ntr, data_points')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .order('snapshot_date', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestByDim: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (latestSnapshotsRaw ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!latestByDim[dk]) latestByDim[dk] = s
  }

  // 90-day-ago snapshots for trend
  const { data: olderSnapshotsRaw } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, snapshot_date')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .lte('snapshot_date', ninetyDaysAgo)
    .order('snapshot_date', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olderByDim: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (olderSnapshotsRaw ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!olderByDim[dk]) olderByDim[dk] = s
  }

  // Last 12 snapshots per dimension (sparklines)
  const { data: recentSnapshotsRaw } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, snapshot_date')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .order('snapshot_date', { ascending: false })
    .limit(dimensions.length * 20)

  const sparklineByDim: Record<string, number[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (recentSnapshotsRaw ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!sparklineByDim[dk]) sparklineByDim[dk] = []
    if (sparklineByDim[dk]!.length < 12) sparklineByDim[dk]!.push(s.score as number)
  }
  for (const dk of Object.keys(sparklineByDim)) {
    sparklineByDim[dk] = sparklineByDim[dk]!.reverse()
  }

  // Active NTR period
  const { data: ntrPeriodsRaw } = await adminClient
    .from('ntr_periods')
    .select('reason, reason_note, starts_at, ends_at')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .lte('starts_at', today)
    .gte('ends_at', today)
    .limit(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeNtr = ((ntrPeriodsRaw ?? []) as any[])[0] as any | undefined

  let ntrMonthsRemaining: number | null = null
  if (activeNtr) {
    const end = new Date(activeNtr.ends_at as string)
    const now = new Date()
    ntrMonthsRemaining = Math.max(0, Math.round((end.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
  }

  // Overall score and band
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredDimensions = dimensions.filter((d: any) => latestByDim[d.key as string])
  let overallScore: number | null = null
  let overallBand: { label: string; color: string } | null = null
  let overallTrend: number | null = null

  if (scoredDimensions.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avg = scoredDimensions.reduce((sum: number, d: any) => sum + (latestByDim[d.key as string].score as number), 0) / scoredDimensions.length
    overallScore = Math.round(avg * 10) / 10
    const band = resolveBand(overallScore)
    if (band) overallBand = { label: band.label as string, color: band.color as string }

    // Overall trend
    const olderScores: number[] = []
    for (const dim of scoredDimensions) {
      const older = olderByDim[dim.key as string]
      if (older) olderScores.push(older.score as number)
    }
    if (olderScores.length > 0) {
      const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length
      overallTrend = Math.round((overallScore - olderAvg) * 10) / 10
    }
  }

  // Score archives (yearly — group all snapshots by year for start/end)
  const { data: allSnapshotsRaw } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, snapshot_date')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .order('snapshot_date', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSnapshots = (allSnapshotsRaw ?? []) as any[]
  interface YearlyRecord { year: number; startScore: number; endScore: number; change: number; startBand: string | null; endBand: string | null }
  const yearlyMap: Record<number, { scores: number[]; dates: string[] }> = {}
  for (const s of allSnapshots) {
    const year = new Date(s.snapshot_date as string).getFullYear()
    if (!yearlyMap[year]) yearlyMap[year] = { scores: [], dates: [] }
    yearlyMap[year]!.scores.push(s.score as number)
    yearlyMap[year]!.dates.push(s.snapshot_date as string)
  }

  const yearlyRecords: YearlyRecord[] = []
  for (const [yearStr, data] of Object.entries(yearlyMap)) {
    const year = parseInt(yearStr)
    if (data.scores.length < 2) continue
    const startScore = Math.round(data.scores[0]! * 10) / 10
    const endScore = Math.round(data.scores[data.scores.length - 1]! * 10) / 10
    const change = Math.round((endScore - startScore) * 10) / 10
    const startBandObj = resolveBand(startScore)
    const endBandObj = resolveBand(endScore)
    yearlyRecords.push({
      year,
      startScore,
      endScore,
      change,
      startBand: startBandObj ? (startBandObj.label as string) : null,
      endBand: endBandObj ? (endBandObj.label as string) : null,
    })
  }

  // Reporting line history
  const { data: historyRaw } = await adminClient
    .from('reporting_line_history')
    .select('manager_id, started_at, ended_at')
    .eq('user_id', targetUserId)
    .order('started_at', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportingHistory = (historyRaw ?? []) as any[]

  // Get manager names for history
  const historyManagerIds = [...new Set(reportingHistory.map((h) => h.manager_id as string))]
  const { data: historyManagersRaw } = historyManagerIds.length > 0
    ? await adminClient
        .from('users')
        .select('id, full_name, email')
        .in('id', historyManagerIds)
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const managerNameById: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (historyManagersRaw ?? []) as any[]) {
    managerNameById[m.id as string] = (m.full_name as string) || (m.email as string)
  }

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }

  return (
    <PageShell>
      <div className="page-content">
        {/* Breadcrumb */}
        <div style={{ marginBottom: '0.75rem' }}>
          <a href="/scores/team" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>
            ← Back to Team Rankings
          </a>
        </div>

        <div className="page-header">
          <div>
            <h1 className="page-title">{targetName}&apos;s Scores</h1>
            <p className="page-subtitle">
              {overallBand
                ? <>Overall: <span style={{ color: overallBand.color, fontWeight: 600 }}>{overallScore?.toFixed(1)}</span> · {overallBand.label}
                  {overallTrend !== null && (
                    <span style={{ color: overallTrend > 0 ? '#16a34a' : overallTrend < 0 ? '#dc2626' : '#6b7280' }}>
                      {' '} · {overallTrend > 0 ? '\u2191' : overallTrend < 0 ? '\u2193' : '\u2192'} {Math.abs(overallTrend).toFixed(1)} this quarter
                    </span>
                  )}
                </>
                : 'Building profile\u2026'
              }
            </p>
          </div>
        </div>

        {/* NTR banner */}
        {activeNtr && (
          <div style={{ backgroundColor: '#fefce8', border: '1px solid #facc15', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.875rem', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600 }}>New to Role</span>
            <span>&mdash;</span>
            <span>{(activeNtr.reason_note as string) || (activeNtr.reason as string)}</span>
            {ntrMonthsRemaining !== null && (
              <span style={{ marginLeft: 'auto', fontSize: '0.8rem', opacity: 0.8 }}>
                {ntrMonthsRemaining} month{ntrMonthsRemaining !== 1 ? 's' : ''} remaining
              </span>
            )}
          </div>
        )}

        {/* Dimension cards grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {dimensions.map((dim: any) => {
            const dk = dim.key as string
            const latest = latestByDim[dk]
            const older = olderByDim[dk]
            const sparkValues = sparklineByDim[dk] ?? []
            const sparkPath = buildSparklinePath(sparkValues)

            const currentScore = latest ? (latest.score as number) : null
            const bandInfo = currentScore !== null ? resolveBand(currentScore) : null
            const bandColor = bandInfo ? (bandInfo.color as string) : '#9ca3af'
            const bandLabel = bandInfo ? (bandInfo.label as string) : null

            let delta: number | null = null
            let trendArrow = '\u2192'
            let trendColor = '#6b7280'
            if (currentScore !== null && older) {
              delta = Math.round((currentScore - (older.score as number)) * 10) / 10
              if (delta > 0) { trendArrow = '\u2191'; trendColor = '#16a34a' }
              else if (delta < 0) { trendArrow = '\u2193'; trendColor = '#dc2626' }
            }

            const sourceLabel = (dim.source as string) === 'system' ? 'System' : 'Peer Review'

            return (
              <div key={dk} style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>{dim.name as string}</span>
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '9999px',
                    backgroundColor: (dim.source as string) === 'system' ? '#eff6ff' : '#faf5ff',
                    color: (dim.source as string) === 'system' ? '#1d4ed8' : '#7c3aed',
                    fontWeight: 500,
                  }}>
                    {sourceLabel}
                  </span>
                </div>

                {currentScore !== null ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '1.75rem', fontWeight: 700, color: bandColor, lineHeight: 1 }}>
                        {currentScore.toFixed(1)}
                      </span>
                      {delta !== null && (
                        <span style={{ fontSize: '0.8rem', color: trendColor, fontWeight: 500 }}>
                          {trendArrow} {Math.abs(delta).toFixed(1)}
                        </span>
                      )}
                    </div>
                    {bandLabel && (
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>{bandLabel}</div>
                    )}
                    {sparkPath && (
                      <svg width="60" height="16" viewBox="0 0 60 16" style={{ display: 'block' }}>
                        <path d={sparkPath} fill="none" stroke={bandColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic', paddingTop: '0.5rem' }}>
                    Building profile&hellip;
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {dimensions.length === 0 && (
          <div style={{ ...sectionStyle, textAlign: 'center', color: '#6b7280', padding: '2rem' }}>
            No score dimensions configured yet.
          </div>
        )}

        {/* Yearly History */}
        {yearlyRecords.length > 0 && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', marginBottom: '0.75rem', marginTop: 0 }}>
              Yearly History
            </h2>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 500 }}>Year</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 500 }}>Start</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 500 }}>End</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 500 }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {yearlyRecords.map((yr) => (
                    <tr key={yr.year} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{yr.year}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        {yr.startScore.toFixed(1)}
                        {yr.startBand && <span style={{ color: '#6b7280', fontSize: '0.8rem' }}> ({yr.startBand})</span>}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        {yr.endScore.toFixed(1)}
                        {yr.endBand && <span style={{ color: '#6b7280', fontSize: '0.8rem' }}> ({yr.endBand})</span>}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ color: yr.change > 0 ? '#16a34a' : yr.change < 0 ? '#dc2626' : '#6b7280', fontWeight: 600 }}>
                          {yr.change > 0 ? '+' : ''}{yr.change.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Reporting Line History */}
        {reportingHistory.length > 0 && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', marginBottom: '0.75rem', marginTop: 0 }}>
              Reporting Line History
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {reportingHistory.map((h, idx) => {
                const mgrName = managerNameById[h.manager_id as string] ?? 'Unknown'
                const startDate = new Date(h.started_at as string)
                const startStr = startDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                const endStr = h.ended_at
                  ? new Date(h.ended_at as string).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                  : 'present'

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      backgroundColor: h.ended_at ? '#f9fafb' : '#f0fdf4',
                      borderRadius: '6px',
                      border: h.ended_at ? '1px solid #f3f4f6' : '1px solid #bbf7d0',
                    }}
                  >
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '9999px',
                      backgroundColor: h.ended_at ? '#d1d5db' : '#16a34a',
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>
                      {mgrName}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                      — {startStr} to {endStr}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
