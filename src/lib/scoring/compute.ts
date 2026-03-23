import { createAdminClient } from '@/utils/supabase/admin'
import type { Band, DimensionScore, ScoreConfig } from './types'
import { resolveBand } from './bands'
import {
  computeExecution,
  computeReliability,
  computeCollaboration,
  type OrgMedians,
} from './system-scores'
import { computeHumanDimension } from './human-scores'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function median(values: number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

// ---------------------------------------------------------------------------
// Org medians helper (not exported)
// ---------------------------------------------------------------------------

async function computeOrgMedians(
  orgId: string,
  windowStart: string,
): Promise<OrgMedians> {
  const supabase = createAdminClient()

  // Get all active non-anonymised users
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_anonymised', false)

  if (!users || users.length === 0) {
    return { projects: 1, meetings: 1, delegated: 1 }
  }

  const projectCounts: number[] = []
  const meetingCounts: number[] = []
  const delegatedCounts: number[] = []

  for (const user of users) {
    // Projects owned
    const { count: projCount } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('owner_id', user.id)
      .gte('created_at', windowStart)

    projectCounts.push(projCount ?? 0)

    // Meetings involved in
    const { count: mtgCount } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .or(`organizer_id.eq.${user.id},attendee_id.eq.${user.id}`)
      .gte('date', windowStart)

    meetingCounts.push(mtgCount ?? 0)

    // Actions delegated: meetings organised by user, actions assigned to others
    const { data: orgMeetings } = await supabase
      .from('meetings')
      .select('id')
      .eq('organization_id', orgId)
      .eq('organizer_id', user.id)
      .gte('date', windowStart)

    let delCount = 0
    if (orgMeetings && orgMeetings.length > 0) {
      const mIds = orgMeetings.map((m) => m.id)
      const { count } = await supabase
        .from('action_items')
        .select('id', { count: 'exact', head: true })
        .in('meeting_id', mIds)
        .neq('assignee_id', user.id)

      delCount = count ?? 0
    }
    delegatedCounts.push(delCount)
  }

  return {
    projects: median(projectCounts) || 1,
    meetings: median(meetingCounts) || 1,
    delegated: median(delegatedCounts) || 1,
  }
}

// ---------------------------------------------------------------------------
// System dimension key mapping
// ---------------------------------------------------------------------------

const SYSTEM_DIMENSION_MAP: Record<string, string> = {
  execution: 'execution',
  reliability: 'reliability',
  collaboration: 'collaboration',
  team_development: 'team_development',
}

// ---------------------------------------------------------------------------
// computeTeamDevelopment
// ---------------------------------------------------------------------------

export async function computeTeamDevelopment(
  managerId: string,
  orgId: string,
  windowStart: string,
  bands: Band[],
): Promise<{ score: number; dataPoints: number } | null> {
  const supabase = createAdminClient()

  // Get direct reports (non-anonymised)
  const { data: reports } = await supabase
    .from('users')
    .select('id')
    .eq('organization_id', orgId)
    .eq('manager_id', managerId)
    .eq('is_anonymised', false)

  if (!reports || reports.length < 2) return null

  const deltas: number[] = []

  for (const report of reports) {
    // Oldest snapshot in window
    const { data: oldest } = await supabase
      .from('score_snapshots')
      .select('score')
      .eq('organization_id', orgId)
      .eq('user_id', report.id)
      .gte('snapshot_date', windowStart)
      .order('snapshot_date', { ascending: true })
      .limit(1)

    // Newest snapshot in window
    const { data: newest } = await supabase
      .from('score_snapshots')
      .select('score')
      .eq('organization_id', orgId)
      .eq('user_id', report.id)
      .gte('snapshot_date', windowStart)
      .order('snapshot_date', { ascending: false })
      .limit(1)

    if (
      oldest &&
      oldest.length > 0 &&
      newest &&
      newest.length > 0 &&
      oldest[0].score != null &&
      newest[0].score != null
    ) {
      deltas.push(newest[0].score - oldest[0].score)
    }
  }

  if (deltas.length === 0) return null

  const avgDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length
  const score = clamp(5.0 + avgDelta, 1, 9)

  return { score: round2(score), dataPoints: deltas.length }
}

// ---------------------------------------------------------------------------
// computeOrgScores — main orchestrator
// ---------------------------------------------------------------------------

export async function computeOrgScores(orgId: string): Promise<void> {
  const supabase = createAdminClient()

  // 1. Load score_config (or defaults)
  const { data: configRow } = await supabase
    .from('score_config')
    .select('rolling_window_months, min_meetings_human, min_actions_system')
    .eq('organization_id', orgId)
    .limit(1)
    .single()

  const config: ScoreConfig = {
    rolling_window_months: configRow?.rolling_window_months ?? 12,
    min_meetings_human: configRow?.min_meetings_human ?? 3,
    min_actions_system: configRow?.min_actions_system ?? 5,
  }

  // 2. Calculate windowStart
  const now = new Date()
  const windowStart = new Date(now)
  windowStart.setMonth(windowStart.getMonth() - config.rolling_window_months)
  const windowStartStr = windowStart.toISOString()
  const windowDays = Math.round(
    (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60 * 24),
  )

  // 3. Load active dimensions (system defaults where org is null + org custom)
  const { data: dimensions } = await supabase
    .from('score_dimensions')
    .select('key, source')
    .eq('is_active', true)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)

  if (!dimensions || dimensions.length === 0) return

  // 4. Load bands (system defaults where org is null + org custom)
  const { data: bandsData } = await supabase
    .from('score_bands')
    .select('band_key, label, min_score, max_score, color')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)

  const bands: Band[] = (bandsData ?? []).map((b) => ({
    band_key: b.band_key,
    label: b.label,
    min_score: b.min_score,
    max_score: b.max_score,
    color: b.color,
  }))

  // 5. Load active non-anonymised users
  const { data: users } = await supabase
    .from('users')
    .select('id, manager_id')
    .eq('organization_id', orgId)
    .eq('is_anonymised', false)

  if (!users || users.length === 0) return

  // 6. Load active NTR periods
  const nowStr = now.toISOString()
  const { data: ntrPeriods } = await supabase
    .from('ntr_periods')
    .select('user_id')
    .eq('organization_id', orgId)
    .lte('starts_at', nowStr)
    .gte('ends_at', nowStr)

  const ntrUserIds = new Set((ntrPeriods ?? []).map((n) => n.user_id))

  // 7. Compute org medians for collaboration
  const orgMedians = await computeOrgMedians(orgId, windowStartStr)

  // 8. For each user, for each dimension, compute scores
  const today = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const snapshots: Array<{
    organization_id: string
    user_id: string
    dimension_key: string
    score: number
    band_key: string | null
    snapshot_date: string
    is_ntr: boolean
    data_points: number
  }> = []

  for (const user of users) {
    const isNtr = ntrUserIds.has(user.id)

    for (const dim of dimensions) {
      let result: { score: number; dataPoints: number } | null = null

      if (dim.source === 'system') {
        switch (dim.key) {
          case 'execution':
            result = await computeExecution(
              user.id,
              orgId,
              windowStartStr,
              config,
            )
            break
          case 'reliability':
            result = await computeReliability(
              user.id,
              orgId,
              windowStartStr,
              config,
            )
            break
          case 'collaboration':
            result = await computeCollaboration(
              user.id,
              orgId,
              windowStartStr,
              config,
              orgMedians,
            )
            break
          case 'team_development':
            result = await computeTeamDevelopment(
              user.id,
              orgId,
              windowStartStr,
              bands,
            )
            break
        }
      } else if (dim.source === 'human') {
        result = await computeHumanDimension(
          user.id,
          orgId,
          dim.key,
          windowStartStr,
          windowDays,
          config,
        )
      }

      if (result) {
        snapshots.push({
          organization_id: orgId,
          user_id: user.id,
          dimension_key: dim.key,
          score: result.score,
          band_key: resolveBand(result.score, bands),
          snapshot_date: today,
          is_ntr: isNtr,
          data_points: result.dataPoints,
        })
      }
    }
  }

  // 9. Upsert all snapshots
  if (snapshots.length > 0) {
    const { error } = await supabase.from('score_snapshots').upsert(snapshots, {
      onConflict: 'organization_id,user_id,dimension_key,snapshot_date',
    })

    if (error) throw error
  }
}
