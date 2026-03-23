import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

export default async function ManagerEffectivenessPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()
  if (!profile || !profile.organization_id) redirect('/login')

  // Admins only
  if ((profile.role as string) !== 'admin') redirect('/scores')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Get all users in org
  const { data: usersRaw } = await adminClient
    .from('users')
    .select('id, full_name, email, role, manager_id')
    .eq('organization_id', orgId)
    .eq('is_anonymised', false)
    .order('full_name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (usersRaw ?? []) as any[]

  // Get managers (role manager or admin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const managers = allUsers.filter((u: any) => u.role === 'manager' || u.role === 'admin')

  // Build reports map
  const reportsByManager: Record<string, string[]> = {}
  for (const u of allUsers) {
    const mid = u.manager_id as string | null
    if (mid) {
      if (!reportsByManager[mid]) reportsByManager[mid] = []
      reportsByManager[mid]!.push(u.id as string)
    }
  }

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

  // Get all user IDs that are reports
  const allReportIds = [...new Set(Object.values(reportsByManager).flat())]

  // Latest snapshots for all reports
  const { data: latestSnapshotsRaw } = allReportIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score')
        .eq('organization_id', orgId)
        .in('user_id', allReportIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestByUserDim: Record<string, Record<string, any>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (latestSnapshotsRaw ?? []) as any[]) {
    const uid = s.user_id as string
    const dk = s.dimension_key as string
    if (!latestByUserDim[uid]) latestByUserDim[uid] = {}
    if (!latestByUserDim[uid]![dk]) latestByUserDim[uid]![dk] = s
  }

  // Older snapshots for trend
  const { data: olderSnapshotsRaw } = allReportIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score')
        .eq('organization_id', orgId)
        .in('user_id', allReportIds)
        .lte('snapshot_date', ninetyDaysAgo)
        .order('snapshot_date', { ascending: false })
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olderByUserDim: Record<string, Record<string, any>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (olderSnapshotsRaw ?? []) as any[]) {
    const uid = s.user_id as string
    const dk = s.dimension_key as string
    if (!olderByUserDim[uid]) olderByUserDim[uid] = {}
    if (!olderByUserDim[uid]![dk]) olderByUserDim[uid]![dk] = s
  }

  // Calculate per-user overall scores and trends
  function getUserOverall(uid: string): { score: number | null; trend: number | null } {
    const userDims = latestByUserDim[uid] ?? {}
    const scores: number[] = []
    for (const dim of dimensions) {
      const snap = userDims[dim.key as string]
      if (snap) scores.push(snap.score as number)
    }
    const score = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null

    let trend: number | null = null
    if (score !== null) {
      const olderDims = olderByUserDim[uid] ?? {}
      const olderScores: number[] = []
      for (const dim of dimensions) {
        const snap = olderDims[dim.key as string]
        if (snap) olderScores.push(snap.score as number)
      }
      if (olderScores.length > 0) {
        const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length
        trend = Math.round((score - olderAvg) * 10) / 10
      }
    }
    return { score, trend }
  }

  // Build manager cards data
  interface ManagerCard {
    id: string
    name: string
    reportCount: number
    teamScore: number | null
    teamBandLabel: string | null
    teamBandColor: string
    avgTrend: number | null
  }

  const managerCards: ManagerCard[] = managers.map((m) => {
    const mid = m.id as string
    const reportIds = reportsByManager[mid] ?? []
    const reportScores: number[] = []
    const reportTrends: number[] = []

    for (const rid of reportIds) {
      const { score, trend } = getUserOverall(rid)
      if (score !== null) reportScores.push(score)
      if (trend !== null) reportTrends.push(trend)
    }

    const teamScore = reportScores.length > 0
      ? Math.round((reportScores.reduce((a, b) => a + b, 0) / reportScores.length) * 10) / 10
      : null

    const teamBand = teamScore !== null ? resolveBand(teamScore) : null
    const avgTrend = reportTrends.length > 0
      ? Math.round((reportTrends.reduce((a, b) => a + b, 0) / reportTrends.length) * 10) / 10
      : null

    return {
      id: mid,
      name: (m.full_name as string) || (m.email as string),
      reportCount: reportIds.length,
      teamScore,
      teamBandLabel: teamBand ? (teamBand.label as string) : null,
      teamBandColor: teamBand ? (teamBand.color as string) : '#9ca3af',
      avgTrend,
    }
  }).sort((a, b) => (b.teamScore ?? 0) - (a.teamScore ?? 0))

  // Reporting line history: find users who changed managers
  const { data: historyRaw } = await adminClient
    .from('reporting_line_history')
    .select('user_id, manager_id, started_at, ended_at')
    .order('started_at', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = (historyRaw ?? []) as any[]

  // Group by user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const historyByUser: Record<string, any[]> = {}
  for (const h of history) {
    const uid = h.user_id as string
    if (!historyByUser[uid]) historyByUser[uid] = []
    historyByUser[uid]!.push(h)
  }

  // Find users with multiple managers (manager changes)
  const userById = new Map(allUsers.map((u) => [u.id as string, u]))
  interface ManagerChangeInsight {
    userName: string
    changes: { fromManager: string; toManager: string; scoreBefore: number | null; scoreAfter: number | null }[]
  }
  const insights: ManagerChangeInsight[] = []

  for (const [uid, records] of Object.entries(historyByUser)) {
    if (records.length < 2) continue
    const targetUser = userById.get(uid)
    if (!targetUser) continue

    const changes: ManagerChangeInsight['changes'] = []
    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1]!
      const curr = records[i]!
      const fromMgr = userById.get(prev.manager_id as string)
      const toMgr = userById.get(curr.manager_id as string)
      if (!fromMgr || !toMgr) continue

      // We use overall scores as a proxy
      const { score: currentScore } = getUserOverall(uid)
      changes.push({
        fromManager: (fromMgr.full_name as string) || (fromMgr.email as string),
        toManager: (toMgr.full_name as string) || (toMgr.email as string),
        scoreBefore: null,
        scoreAfter: currentScore,
      })
    }

    if (changes.length > 0) {
      insights.push({
        userName: (targetUser.full_name as string) || (targetUser.email as string),
        changes,
      })
    }
  }

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }

  return (
    <PageShell>
      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Manager Effectiveness</h1>
            <p className="page-subtitle">How managers impact their teams</p>
          </div>
        </div>

        {/* Manager cards grid */}
        {managerCards.length === 0 ? (
          <div style={{ ...sectionStyle, textAlign: 'center', color: '#6b7280', padding: '2rem' }}>
            No managers found in the organisation.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {managerCards.map((mc) => (
              <div key={mc.id} style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '1rem', color: '#111827' }}>{mc.name}</span>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {mc.reportCount} report{mc.reportCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {mc.teamScore !== null ? (
                  <>
                    <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                      Team Development Score
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '1.5rem', fontWeight: 700, color: mc.teamBandColor, lineHeight: 1 }}>
                        {mc.teamScore.toFixed(1)}
                      </span>
                      {mc.teamBandLabel && (
                        <span style={{ fontSize: '0.85rem', color: mc.teamBandColor, fontWeight: 500 }}>
                          ({mc.teamBandLabel})
                        </span>
                      )}
                    </div>
                    {mc.avgTrend !== null && (
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        Reports improved by avg{' '}
                        <span style={{ fontWeight: 600, color: mc.avgTrend >= 0 ? '#16a34a' : '#dc2626' }}>
                          {mc.avgTrend >= 0 ? '+' : ''}{mc.avgTrend.toFixed(1)}
                        </span>{' '}
                        this quarter
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>
                    {mc.reportCount === 0 ? 'No direct reports' : 'Not enough score data yet'}
                  </div>
                )}

                <div style={{ marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.5rem' }}>
                  <a
                    href={`/scores/user/${mc.id}`}
                    style={{ fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none' }}
                  >
                    View Team →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Manager Impact Insights */}
        {insights.length > 0 && (
          <div style={sectionStyle}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', marginBottom: '0.75rem', marginTop: 0 }}>
              Manager Impact Insights
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {insights.map((insight, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '0.75rem',
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    border: '1px solid #f3f4f6',
                  }}
                >
                  {insight.changes.map((c, ci) => (
                    <div key={ci}>
                      <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500, marginBottom: '0.25rem' }}>
                        {insight.userName} moved from {c.fromManager} to {c.toManager}
                      </div>
                      {c.scoreAfter !== null && (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                          Current score: {c.scoreAfter.toFixed(1)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
