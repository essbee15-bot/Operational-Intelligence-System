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

export default async function TeamRankingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()
  if (!profile || !profile.organization_id) redirect('/login')

  // Only managers and admins
  const role = profile.role as string
  if (role !== 'manager' && role !== 'admin') redirect('/scores')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string
  const today = new Date().toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Get direct reports
  const { data: reportsRaw } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', orgId)
    .eq('manager_id', user.id)
    .eq('is_anonymised', false)
    .order('full_name')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reports = (reportsRaw ?? []) as any[]
  const reportIds = reports.map((r) => r.id as string)

  // Get dimensions
  const { data: dimensionsRaw } = await adminClient
    .from('score_dimensions')
    .select('key, name')
    .eq('is_active', true)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order('display_order', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dimensions = (dimensionsRaw ?? []) as any[]

  // Get bands
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

  // Get latest snapshots for all reports
  const { data: latestSnapshotsRaw } = reportIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score, band_key, snapshot_date, is_ntr')
        .eq('organization_id', orgId)
        .in('user_id', reportIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestSnapshots = (latestSnapshotsRaw ?? []) as any[]

  // Build latest per user per dimension
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestByUserDim: Record<string, Record<string, any>> = {}
  for (const s of latestSnapshots) {
    const uid = s.user_id as string
    const dk = s.dimension_key as string
    if (!latestByUserDim[uid]) latestByUserDim[uid] = {}
    if (!latestByUserDim[uid]![dk]) latestByUserDim[uid]![dk] = s
  }

  // Get older snapshots (~90 days ago) for trend
  const { data: olderSnapshotsRaw } = reportIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score')
        .eq('organization_id', orgId)
        .in('user_id', reportIds)
        .lte('snapshot_date', ninetyDaysAgo)
        .order('snapshot_date', { ascending: false })
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olderSnapshots = (olderSnapshotsRaw ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olderByUserDim: Record<string, Record<string, any>> = {}
  for (const s of olderSnapshots) {
    const uid = s.user_id as string
    const dk = s.dimension_key as string
    if (!olderByUserDim[uid]) olderByUserDim[uid] = {}
    if (!olderByUserDim[uid]![dk]) olderByUserDim[uid]![dk] = s
  }

  // Get active NTR periods for reports
  const { data: ntrPeriodsRaw } = reportIds.length > 0
    ? await adminClient
        .from('ntr_periods')
        .select('user_id, reason, reason_note, starts_at, ends_at')
        .eq('organization_id', orgId)
        .in('user_id', reportIds)
        .lte('starts_at', today)
        .gte('ends_at', today)
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ntrByUser: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const n of (ntrPeriodsRaw ?? []) as any[]) {
    ntrByUser[n.user_id as string] = n
  }

  // Calculate overall scores
  interface RankedUser {
    id: string
    name: string
    overallScore: number | null
    bandLabel: string | null
    bandColor: string
    trend: number | null
    isNtr: boolean
    ntrReason: string | null
    ntrMonthsLeft: number | null
  }

  const rankedUsers: RankedUser[] = reports.map((r) => {
    const uid = r.id as string
    const userDims = latestByUserDim[uid] ?? {}
    const ntr = ntrByUser[uid]
    const isNtr = !!ntr

    // Calculate overall score
    const scores: number[] = []
    for (const dim of dimensions) {
      const snap = userDims[dim.key as string]
      if (snap) scores.push(snap.score as number)
    }
    const overallScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null

    const band = overallScore !== null ? resolveBand(overallScore) : null

    // Trend: compare to 90 days ago
    let trend: number | null = null
    if (overallScore !== null) {
      const olderDims = olderByUserDim[uid] ?? {}
      const olderScores: number[] = []
      for (const dim of dimensions) {
        const snap = olderDims[dim.key as string]
        if (snap) olderScores.push(snap.score as number)
      }
      if (olderScores.length > 0) {
        const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length
        trend = Math.round((overallScore - olderAvg) * 10) / 10
      }
    }

    let ntrMonthsLeft: number | null = null
    if (ntr) {
      const end = new Date(ntr.ends_at as string)
      const now = new Date()
      ntrMonthsLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
    }

    return {
      id: uid,
      name: (r.full_name as string) || (r.email as string),
      overallScore,
      bandLabel: band ? (band.label as string) : null,
      bandColor: band ? (band.color as string) : '#9ca3af',
      trend,
      isNtr,
      ntrReason: ntr ? ((ntr.reason_note as string) || (ntr.reason as string)) : null,
      ntrMonthsLeft,
    }
  })

  // Sort: non-NTR by score descending, NTR at bottom
  const ranked = rankedUsers.filter(u => !u.isNtr).sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
  const ntrUsers = rankedUsers.filter(u => u.isNtr)

  // Team development score
  const allTrends = rankedUsers.filter(u => u.trend !== null).map(u => u.trend!)
  const avgTrend = allTrends.length > 0
    ? Math.round((allTrends.reduce((a, b) => a + b, 0) / allTrends.length) * 10) / 10
    : null

  const allScores = rankedUsers.filter(u => u.overallScore !== null).map(u => u.overallScore!)
  const teamAvg = allScores.length > 0
    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
    : null
  const teamBand = teamAvg !== null ? resolveBand(teamAvg) : null

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }

  return (
    <PageShell>
      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Team Rankings</h1>
            <p className="page-subtitle">{reports.length} direct report{reports.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {reports.length === 0 ? (
          <div style={{ ...sectionStyle, textAlign: 'center', color: '#6b7280', padding: '2rem' }}>
            You have no direct reports.
          </div>
        ) : (
          <>
            {/* Ranked list */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem' }}>
              {ranked.map((u, idx) => (
                <div
                  key={u.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                  }}
                >
                  {/* Rank */}
                  <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#6b7280', width: '1.5rem', textAlign: 'right', flexShrink: 0 }}>
                    {idx + 1}
                  </span>

                  {/* Avatar */}
                  <div style={{
                    width: '2rem',
                    height: '2rem',
                    borderRadius: '9999px',
                    backgroundColor: u.bandColor + '22',
                    color: u.bandColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {u.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 500, fontSize: '0.9375rem', color: '#111827' }}>{u.name}</span>
                  </div>

                  {/* Band pill */}
                  {u.bandLabel && (
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '9999px',
                      backgroundColor: u.bandColor + '18',
                      color: u.bandColor,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}>
                      {u.bandLabel}
                    </span>
                  )}

                  {/* Score */}
                  {u.overallScore !== null && (
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: u.bandColor, flexShrink: 0 }}>
                      {u.overallScore.toFixed(1)}
                    </span>
                  )}

                  {/* Trend */}
                  {u.trend !== null && (
                    <span style={{
                      fontSize: '0.8rem',
                      color: u.trend > 0 ? '#16a34a' : u.trend < 0 ? '#dc2626' : '#6b7280',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}>
                      {u.trend > 0 ? '\u2191' : u.trend < 0 ? '\u2193' : '\u2192'}{Math.abs(u.trend).toFixed(1)}
                    </span>
                  )}

                  {/* Detail link */}
                  <a
                    href={`/scores/user/${u.id}`}
                    style={{ fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', flexShrink: 0 }}
                  >
                    Detail →
                  </a>
                </div>
              ))}

              {/* NTR users at bottom */}
              {ntrUsers.length > 0 && (
                <>
                  {ranked.length > 0 && (
                    <div style={{ borderTop: '2px solid #f3f4f6', padding: '0.5rem 1rem', backgroundColor: '#fafafa' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        New to Role
                      </span>
                    </div>
                  )}
                  {ntrUsers.map((u) => (
                    <div
                      key={u.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        borderTop: '1px solid #f3f4f6',
                        backgroundColor: '#fafafa',
                      }}
                    >
                      {/* Dash for rank */}
                      <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#d1d5db', width: '1.5rem', textAlign: 'right', flexShrink: 0 }}>
                        —
                      </span>

                      {/* Avatar */}
                      <div style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: '9999px',
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}>
                        {u.name.charAt(0).toUpperCase()}
                      </div>

                      {/* Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 500, fontSize: '0.9375rem', color: '#111827' }}>{u.name}</span>
                      </div>

                      {/* NTR badge */}
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        fontWeight: 500,
                        flexShrink: 0,
                      }}>
                        NTR — {u.ntrReason}{u.ntrMonthsLeft !== null ? `, ${u.ntrMonthsLeft}mo left` : ''}
                      </span>

                      {/* Detail link */}
                      <a
                        href={`/scores/user/${u.id}`}
                        style={{ fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', flexShrink: 0 }}
                      >
                        Detail →
                      </a>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Team Development Score */}
            {teamAvg !== null && (
              <div style={sectionStyle}>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>Your Team Development Score</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.75rem', fontWeight: 700, color: teamBand ? (teamBand.color as string) : '#111827', lineHeight: 1 }}>
                    {teamAvg.toFixed(1)}
                  </span>
                  {teamBand && (
                    <span style={{ fontSize: '0.9rem', color: teamBand.color as string, fontWeight: 500 }}>
                      ({teamBand.label as string})
                    </span>
                  )}
                </div>
                {avgTrend !== null && (
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                    Your reports improved by an average of{' '}
                    <span style={{ fontWeight: 600, color: avgTrend >= 0 ? '#16a34a' : '#dc2626' }}>
                      {avgTrend >= 0 ? '+' : ''}{avgTrend.toFixed(1)}
                    </span>{' '}
                    this quarter
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}
