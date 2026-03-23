import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

/** Builds an SVG path string for a sparkline from an array of values (oldest->newest). */
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

export default async function ScoresPage({
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
  if (!profile || !profile.organization_id) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id
  const userId = user.id
  const today = new Date().toISOString().slice(0, 10)

  // 1. Active dimensions (system + org custom, ordered by display_order)
  const { data: dimensionsRaw } = await adminClient
    .from('score_dimensions')
    .select('key, name, description, source, display_order')
    .eq('is_active', true)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order('display_order', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dimensions = dimensionsRaw ?? [] as any[]

  // 2. Latest snapshot per dimension for this user
  const { data: latestSnapshots } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, band_key, snapshot_date, is_ntr, data_points')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestByDim: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (latestSnapshots ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!latestByDim[dk]) latestByDim[dk] = s
  }

  // 3. Snapshot from ~90 days ago per dimension (for quarterly trend)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: olderSnapshots } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, snapshot_date')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .lte('snapshot_date', ninetyDaysAgo)
    .order('snapshot_date', { ascending: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olderByDim: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (olderSnapshots ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!olderByDim[dk]) olderByDim[dk] = s
  }

  // 4. Last 12 weekly snapshots per dimension (for sparklines)
  const { data: recentSnapshots } = await adminClient
    .from('score_snapshots')
    .select('dimension_key, score, snapshot_date')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(dimensions.length * 20)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sparklineByDim: Record<string, number[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (recentSnapshots ?? []) as any[]) {
    const dk = s.dimension_key as string
    if (!sparklineByDim[dk]) sparklineByDim[dk] = []
    if (sparklineByDim[dk]!.length < 12) sparklineByDim[dk]!.push(s.score as number)
  }
  // Reverse so oldest is first for sparkline rendering
  for (const dk of Object.keys(sparklineByDim)) {
    sparklineByDim[dk] = sparklineByDim[dk]!.reverse()
  }

  // 5. Active NTR period for this user
  const { data: ntrPeriods } = await adminClient
    .from('ntr_periods')
    .select('reason, reason_note, starts_at, ends_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .lte('starts_at', today)
    .gte('ends_at', today)
    .limit(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeNtr = (ntrPeriods ?? [])[0] as any | undefined

  // 6. Score bands (system + org custom)
  const { data: bandsRaw } = await adminClient
    .from('score_bands')
    .select('band_key, label, min_score, max_score, color, display_order')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order('display_order', { ascending: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bands = bandsRaw ?? [] as any[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function resolveBand(score: number): any | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bands.find((b: any) => score >= (b.min_score as number) && score <= (b.max_score as number)) ?? null
  }

  // Calculate overall band
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredDimensions = dimensions.filter((d: any) => latestByDim[d.key as string])
  let overallBand: { label: string; color: string } | null = null
  let overallScore: number | null = null
  if (scoredDimensions.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avg = scoredDimensions.reduce((sum: number, d: any) => sum + (latestByDim[d.key as string].score as number), 0) / scoredDimensions.length
    overallScore = Math.round(avg * 10) / 10
    const band = resolveBand(overallScore)
    if (band) overallBand = { label: band.label as string, color: band.color as string }
  }

  // NTR months remaining
  let ntrMonthsRemaining: number | null = null
  if (activeNtr) {
    const end = new Date(activeNtr.ends_at as string)
    const now = new Date()
    ntrMonthsRemaining = Math.max(0, Math.round((end.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
  }

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }

  return (
    <PageShell>
      <div className="page-content">
        <div className="page-header">
          <h1 className="page-title">My Scores</h1>
          <p className="page-subtitle">
            {overallBand
              ? <>Overall: <span style={{ color: overallBand.color, fontWeight: 600 }}>{overallScore}</span> &middot; {overallBand.label}</>
              : 'Building profile\u2026'}
          </p>
        </div>

        {message && (
          <div style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem', color: '#92400e' }}>
            {message}
          </div>
        )}

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
            No score dimensions configured yet. Check back once your organisation has set up scoring.
          </div>
        )}

        <div style={{ marginTop: '0.5rem' }}>
          <a href="/scores/history" className="link" style={{ fontSize: '0.875rem' }}>
            View detailed score history &rarr;
          </a>
        </div>
      </div>
    </PageShell>
  )
}
