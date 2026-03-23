import { createAdminClient } from '@/utils/supabase/admin'
import type { ScoreConfig } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Compute a human-rated dimension score for a user.
 *
 * Uses adjusted_score from meeting_dimension_scores, weighted by recency:
 *   weight = 1.0 - (days_ago / windowDays) * 0.5, floored at 0.5
 */
export async function computeHumanDimension(
  userId: string,
  orgId: string,
  dimensionKey: string,
  windowStart: string,
  windowDays: number,
  config: ScoreConfig,
): Promise<{ score: number; dataPoints: number } | null> {
  const supabase = createAdminClient()

  // Fetch meetings where user is the attendee, within the window
  const { data: meetings, error: mErr } = await supabase
    .from('meetings')
    .select('id, date')
    .eq('organization_id', orgId)
    .eq('attendee_id', userId)
    .gte('date', windowStart)

  if (mErr) throw mErr
  if (!meetings || meetings.length === 0) return null

  const meetingIds = meetings.map((m) => m.id)
  const meetingDateMap = new Map<string, string>()
  for (const m of meetings) {
    meetingDateMap.set(m.id, m.date)
  }

  // Fetch dimension scores for those meetings
  const { data: scores, error: sErr } = await supabase
    .from('meeting_dimension_scores')
    .select('meeting_id, adjusted_score')
    .in('meeting_id', meetingIds)
    .eq('dimension_key', dimensionKey)
    .not('adjusted_score', 'is', null)

  if (sErr) throw sErr
  if (!scores || scores.length < config.min_meetings_human) return null

  const now = Date.now()
  let weightedSum = 0
  let totalWeight = 0

  for (const s of scores) {
    const meetingDate = meetingDateMap.get(s.meeting_id)
    if (!meetingDate) continue

    const daysAgo =
      (now - new Date(meetingDate).getTime()) / (1000 * 60 * 60 * 24)
    const weight = Math.max(0.5, 1.0 - (daysAgo / windowDays) * 0.5)

    weightedSum += s.adjusted_score * weight
    totalWeight += weight
  }

  if (totalWeight === 0) return null

  const score = clamp(weightedSum / totalWeight, 1, 9)

  return { score: round2(score), dataPoints: scores.length }
}
