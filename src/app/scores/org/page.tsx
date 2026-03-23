import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin:       { bg: '#fef2f2', color: '#991b1b' },
  manager:     { bg: '#eff6ff', color: '#1d4ed8' },
  contributor: { bg: '#f3f4f6', color: '#374151' },
}

export default async function OrgRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; dimension?: string; band?: string }>
}) {
  const { team: teamFilter, dimension: dimFilter, band: bandFilter } = await searchParams

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
  const role = profile.role as string
  if (role !== 'admin') redirect('/scores')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string
  const today = new Date().toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Get all non-anonymised users
  const { data: usersRaw } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', orgId)
    .eq('is_anonymised', false)
    .order('full_name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (usersRaw ?? []) as any[]
  const allUserIds = allUsers.map((u) => u.id as string)

  // Teams for filter
  const { data: teamsRaw } = await adminClient
    .from('teams')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams = (teamsRaw ?? []) as any[]

  // Team members for filtering
  let teamMemberIds: Set<string> | null = null
  if (teamFilter) {
    const { data: tmRaw } = await adminClient
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamFilter)
    teamMemberIds = new Set((tmRaw ?? []).map((tm) => (tm as { user_id: string }).user_id))
  }

  // Dimensions
  const { data: dimensionsRaw } = await adminClient
    .from('score_dimensions')
    .select('key, name')
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

  // Latest snapshots
  const { data: latestSnapshotsRaw } = allUserIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score, band_key, snapshot_date, is_ntr')
        .eq('organization_id', orgId)
        .in('user_id', allUserIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestSnapshots = (latestSnapshotsRaw ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestByUserDim: Record<string, Record<string, any>> = {}
  for (const s of latestSnapshots) {
    const uid = s.user_id as string
    const dk = s.dimension_key as string
    if (!latestByUserDim[uid]) latestByUserDim[uid] = {}
    if (!latestByUserDim[uid]![dk]) latestByUserDim[uid]![dk] = s
  }

  // Older snapshots for trend
  const { data: olderSnapshotsRaw } = allUserIds.length > 0
    ? await adminClient
        .from('score_snapshots')
        .select('user_id, dimension_key, score')
        .eq('organization_id', orgId)
        .in('user_id', allUserIds)
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

  // NTR periods
  const { data: ntrPeriodsRaw } = allUserIds.length > 0
    ? await adminClient
        .from('ntr_periods')
        .select('user_id, reason, reason_note, starts_at, ends_at')
        .eq('organization_id', orgId)
        .in('user_id', allUserIds)
        .lte('starts_at', today)
        .gte('ends_at', today)
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ntrByUser: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const n of (ntrPeriodsRaw ?? []) as any[]) {
    ntrByUser[n.user_id as string] = n
  }

  // Build ranked user list
  interface RankedUser {
    id: string
    name: string
    role: string
    overallScore: number | null
    bandLabel: string | null
    bandKey: string | null
    bandColor: string
    trend: number | null
    isNtr: boolean
    ntrReason: string | null
    ntrMonthsLeft: number | null
  }

  let rankedUsers: RankedUser[] = allUsers.map((u) => {
    const uid = u.id as string
    const userDims = latestByUserDim[uid] ?? {}
    const ntr = ntrByUser[uid]
    const isNtr = !!ntr

    // Calculate score (optionally for a single dimension)
    let overallScore: number | null = null
    let bandKey: string | null = null
    if (dimFilter) {
      const snap = userDims[dimFilter]
      if (snap) {
        overallScore = Math.round((snap.score as number) * 10) / 10
        bandKey = snap.band_key as string | null
      }
    } else {
      const scores: number[] = []
      for (const dim of dimensions) {
        const snap = userDims[dim.key as string]
        if (snap) scores.push(snap.score as number)
      }
      if (scores.length > 0) {
        overallScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      }
    }

    const band = overallScore !== null ? resolveBand(overallScore) : null
    if (band && !bandKey) bandKey = band.band_key as string

    // Trend
    let trend: number | null = null
    if (overallScore !== null) {
      const olderDims = olderByUserDim[uid] ?? {}
      if (dimFilter) {
        const snap = olderDims[dimFilter]
        if (snap) trend = Math.round((overallScore - (snap.score as number)) * 10) / 10
      } else {
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
    }

    let ntrMonthsLeft: number | null = null
    if (ntr) {
      const end = new Date(ntr.ends_at as string)
      const now = new Date()
      ntrMonthsLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
    }

    return {
      id: uid,
      name: (u.full_name as string) || (u.email as string),
      role: u.role as string,
      overallScore,
      bandLabel: band ? (band.label as string) : null,
      bandKey,
      bandColor: band ? (band.color as string) : '#9ca3af',
      trend,
      isNtr,
      ntrReason: ntr ? ((ntr.reason_note as string) || (ntr.reason as string)) : null,
      ntrMonthsLeft,
    }
  })

  // Apply filters
  if (teamMemberIds) {
    rankedUsers = rankedUsers.filter(u => teamMemberIds!.has(u.id))
  }
  if (bandFilter) {
    rankedUsers = rankedUsers.filter(u => u.bandKey === bandFilter)
  }

  const ranked = rankedUsers.filter(u => !u.isNtr).sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
  const ntrUsers = rankedUsers.filter(u => u.isNtr)

  const totalCount = allUsers.length
  const rankedCount = ranked.length
  const ntrCount = ntrUsers.length

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }

  return (
    <PageShell>
      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Organisation Rankings</h1>
            <p className="page-subtitle">
              {totalCount} people · {rankedCount} in rankings · {ntrCount} in NTR
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <form method="GET" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <select
            name="team"
            defaultValue={teamFilter ?? ''}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'white' }}
          >
            <option value="">All Teams</option>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {teams.map((t: any) => (
              <option key={t.id as string} value={t.id as string}>{t.name as string}</option>
            ))}
          </select>

          <select
            name="dimension"
            defaultValue={dimFilter ?? ''}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'white' }}
          >
            <option value="">All Dimensions</option>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {dimensions.map((d: any) => (
              <option key={d.key as string} value={d.key as string}>{d.name as string}</option>
            ))}
          </select>

          <select
            name="band"
            defaultValue={bandFilter ?? ''}
            style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'white' }}
          >
            <option value="">All Bands</option>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {bands.map((b: any) => (
              <option key={b.band_key as string} value={b.band_key as string}>{b.label as string}</option>
            ))}
          </select>

          <button
            type="submit"
            className="btn btn-secondary"
            style={{ fontSize: '0.875rem' }}
          >
            Filter
          </button>

          {(teamFilter || dimFilter || bandFilter) && (
            <a href="/scores/org" className="link" style={{ alignSelf: 'center', fontSize: '0.875rem' }}>
              Clear
            </a>
          )}
        </form>

        {/* Ranked list */}
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem' }}>
          {ranked.length === 0 && ntrUsers.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
              No users match the current filters.
            </div>
          )}

          {ranked.map((u, idx) => {
            const rc = ROLE_COLORS[u.role] ?? { bg: '#f3f4f6', color: '#374151' }
            return (
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

                {/* Role pill */}
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '9999px',
                  backgroundColor: rc.bg,
                  color: rc.color,
                  fontWeight: 500,
                  flexShrink: 0,
                }}>
                  {u.role}
                </span>

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
            )
          })}

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
                  <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#d1d5db', width: '1.5rem', textAlign: 'right', flexShrink: 0 }}>—</span>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 500, fontSize: '0.9375rem', color: '#111827' }}>{u.name}</span>
                  </div>
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
      </div>
    </PageShell>
  )
}
