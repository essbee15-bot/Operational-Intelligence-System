import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const previousYear = new Date().getFullYear() - 1
  const yearStart = `${previousYear}-01-01`
  const yearEnd = `${previousYear}-12-31`

  const { data: orgs } = await admin.from('organizations').select('id')
  if (!orgs) return NextResponse.json({ message: 'No orgs' })

  let archived = 0
  let deleted = 0

  for (const org of orgs) {
    const orgId = org.id as string

    // Get all snapshots for the previous year
    const { data: snapshots } = await admin
      .from('score_snapshots')
      .select('user_id, dimension_key, score, band_key, snapshot_date')
      .eq('organization_id', orgId)
      .gte('snapshot_date', yearStart)
      .lte('snapshot_date', yearEnd)
      .order('snapshot_date', { ascending: true })

    if (!snapshots || snapshots.length === 0) continue

    // Group by user_id + dimension_key
    const groups = new Map<string, typeof snapshots>()
    for (const s of snapshots) {
      const key = `${s.user_id}::${s.dimension_key}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }

    const archives = []
    for (const [key, entries] of groups) {
      const [userId, dimensionKey] = key.split('::')
      const scores = entries.map(e => Number(e.score))
      const first = entries[0]!
      const last = entries[entries.length - 1]!

      archives.push({
        organization_id: orgId,
        user_id: userId,
        dimension_key: dimensionKey,
        year: previousYear,
        start_of_year_score: Number(first.score),
        start_of_year_band: first.band_key,
        end_of_year_score: Number(last.score),
        end_of_year_band: last.band_key,
        avg_score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
        min_score: Math.min(...scores),
        max_score: Math.max(...scores),
        data_points: entries.length,
      })
    }

    if (archives.length > 0) {
      await admin
        .from('score_archives')
        .upsert(archives, { onConflict: 'organization_id,user_id,dimension_key,year' })
      archived += archives.length
    }

    // Delete old snapshots (older than 13 months)
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 13)
    const { count } = await admin
      .from('score_snapshots')
      .delete({ count: 'exact' })
      .eq('organization_id', orgId)
      .lt('snapshot_date', cutoff.toISOString().slice(0, 10))

    deleted += count ?? 0
  }

  return NextResponse.json({ archived, deleted })
}
