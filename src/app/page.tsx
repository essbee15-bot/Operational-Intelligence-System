import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

/** Builds an SVG path string for a sparkline from an array of values (oldest→newest). */
function buildSparklinePath(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 60, H = 20
  return values.map((v, i) => {
    const x = ((i / (values.length - 1)) * W).toFixed(1)
    const y = (H - ((v - min) / range) * H).toFixed(1)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tab?: string }>
}) {
  const { message, tab } = await searchParams
  const activeTab = tab === 'platform' ? 'platform' : tab === 'team' ? 'team' : 'overview'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, role, is_platform_admin, organization_id, manager_id')
    .eq('id', user.id)
    .single()

  const isPlatformAdmin = profile?.is_platform_admin ?? false
  const role = profile?.role ?? 'contributor'
  const isAdmin   = role === 'admin'
  const isManager = isAdmin || role === 'manager'
  const name = profile?.full_name ?? user.email ?? 'there'
  const firstName = name.split(' ')[0] ?? name

  // ── Widget data (org users only) ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openActions: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshotKpis: any[] = []
  let recordsByKpi: Record<string, number[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeObjectives: any[] = []
  let progressMap: Record<string, { total: number; complete: number }> = {}
  let teamMap: Record<string, string> = {}
  let activeProjectCount = 0
  let overdueProjectCount = 0
  let pendingSurveyCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let directReports: any[] = []
  let actionCountByReport: Record<string, number> = {}
  let overdueCountByReport: Record<string, number> = {}
  let scoresByReport: Record<string, number[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let kpisByReport: Record<string, { name: string; value: number | null; target: number | null; onTarget: boolean }[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pulseAdminStats: { bestTeam: string | null; worstTeam: string | null; responseCount: number; periodLabel: string } | null = null
  let hasPulseSurveys = false
  let pending360Count = 0
  let has360Cycles = false
  let admin360Stats: { bestManager: string | null; worstManager: string | null; responseCount: number; cycleName: string } | null = null

  if (profile?.organization_id) {
    const adminClient = createAdminClient()

    // 1. Open actions (up to 5)
    const { data: actionsRaw } = await adminClient
      .from('action_items')
      .select('id, action_text, title, due_date, meeting_id, meetings(id, title, purpose, meeting_type)')
      .eq('organization_id', profile.organization_id)
      .eq('assignee_id', user.id)
      .eq('is_closed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5)
    openActions = actionsRaw ?? []

    // 2. KPIs
    const { data: kpisRaw } = await adminClient
      .from('kpis')
      .select('id, name, unit, category, target_value, audience, team_id')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .order('category').order('display_order')

    const { data: myMemberships } = await adminClient
      .from('team_members').select('team_id').eq('user_id', user.id)
    const myTeamIds = new Set((myMemberships ?? []).map(m => m.team_id as string))

    const allVisible = isManager
      ? (kpisRaw ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (kpisRaw ?? []).filter((k: any) => k.team_id == null || myTeamIds.has(k.team_id as string))
    snapshotKpis = allVisible.slice(0, 6)

    // 3. KPI records (last 2 per KPI for trend)
    if (snapshotKpis.length > 0) {
      const { data: recentRecords } = await adminClient
        .from('kpi_records').select('kpi_id, value, date')
        .eq('organization_id', profile.organization_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in('kpi_id', snapshotKpis.map((k: any) => k.id as string))
        .order('date', { ascending: false })
        .limit(snapshotKpis.length * 6 + 10)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(recentRecords ?? []).forEach((r: any) => {
        const kid = r.kpi_id as string
        if (!recordsByKpi[kid]) recordsByKpi[kid] = []
        if (recordsByKpi[kid]!.length < 6) recordsByKpi[kid]!.push(r.value as number)
      })
    }

    // 4. Active objectives
    const { data: objRaw } = await adminClient
      .from('objectives').select('id, title, team_id, end_date, status')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'active').order('end_date', { ascending: true, nullsFirst: false }).limit(4)
    activeObjectives = objRaw ?? []

    // 5. KR counts
    if (activeObjectives.length > 0) {
      const { data: krs } = await adminClient
        .from('key_results').select('objective_id, status')
        .eq('organization_id', profile.organization_id)
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

    // 6. Teams
    const { data: teamsRaw } = await adminClient
      .from('teams').select('id, name').eq('organization_id', profile.organization_id)
    teamMap = Object.fromEntries((teamsRaw ?? []).map(t => [t.id as string, t.name as string]))

    // 7. Pulse surveys
    const { data: activeSurveys } = await adminClient
      .from('pulse_surveys').select('id')
      .eq('organization_id', profile.organization_id).eq('is_active', true).limit(1)
    hasPulseSurveys = (activeSurveys ?? []).length > 0

    if (hasPulseSurveys) {
      const { data: openPeriodsRaw } = await adminClient
        .from('pulse_periods').select('id, period_label, survey_id')
        .eq('organization_id', profile.organization_id).eq('is_closed', false)
      const openPeriodIds = (openPeriodsRaw ?? []).map(p => p.id as string)

      if (openPeriodIds.length > 0) {
        const { data: myTeamMemberships } = await adminClient
          .from('team_members').select('team_id')
          .eq('user_id', user.id).eq('organization_id', profile.organization_id)
        const myTids = (myTeamMemberships ?? []).map(m => m.team_id as string)
        const completedKeys = new Set<string>()
        if (myTids.length > 0) {
          const { data: completionsRaw } = await adminClient
            .from('pulse_completions').select('period_id, team_id')
            .eq('user_id', user.id).in('period_id', openPeriodIds)
          ;(completionsRaw ?? []).forEach(c => completedKeys.add(`${c.period_id as string}:${c.team_id as string}`))
          for (const p of openPeriodsRaw ?? []) {
            for (const tid of myTids) {
              if (!completedKeys.has(`${p.id as string}:${tid}`)) pendingSurveyCount++
            }
          }
        }
      }

      if (isAdmin) {
        const { data: recentClosed } = await adminClient
          .from('pulse_periods').select('id, period_label')
          .eq('organization_id', profile.organization_id).eq('is_closed', true)
          .order('closes_at', { ascending: false }).limit(1)
        const recentPeriod = (recentClosed ?? [])[0] ?? null
        if (recentPeriod) {
          const { data: closedResponses } = await adminClient
            .from('pulse_responses').select('team_id')
            .eq('period_id', recentPeriod.id as string).eq('organization_id', profile.organization_id)
          const countByTeam: Record<string, number> = {}
          ;(closedResponses ?? []).forEach(r => {
            const tid = r.team_id as string
            countByTeam[tid] = (countByTeam[tid] ?? 0) + 1
          })
          const eligible = Object.entries(countByTeam).filter(([, c]) => c >= 3).sort(([, a], [, b]) => b - a)
          pulseAdminStats = {
            bestTeam: eligible.length >= 2 ? (teamMap[eligible[0]![0]] ?? null) : null,
            worstTeam: eligible.length >= 2 ? (teamMap[eligible[eligible.length - 1]![0]] ?? null) : null,
            responseCount: (closedResponses ?? []).length,
            periodLabel: recentPeriod.period_label as string,
          }
        }
      }
    }

    // 8. 360 Feedback
    const { data: open360Cycles } = await adminClient
      .from('review_cycles').select('id')
      .eq('organization_id', profile.organization_id)
      .eq('is_closed', false)

    has360Cycles = (open360Cycles ?? []).length > 0

    if (has360Cycles && profile.manager_id) {
      for (const cycle of open360Cycles ?? []) {
        const { data: comp } = await adminClient
          .from('review_completions')
          .select('cycle_id')
          .eq('cycle_id', cycle.id as string)
          .eq('user_id', profile.id)
          .eq('manager_id', profile.manager_id as string)
          .maybeSingle()
        if (!comp) pending360Count++
      }
    }

    if (isAdmin) {
      const { data: latestClosed } = await adminClient
        .from('review_cycles')
        .select('id, name')
        .eq('organization_id', profile.organization_id)
        .eq('is_closed', true)
        .order('closes_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestClosed) {
        const { data: responses } = await adminClient
          .from('review_responses')
          .select('manager_id, answers')
          .eq('cycle_id', latestClosed.id as string)
          .eq('organization_id', profile.organization_id)

        if (responses && responses.length > 0) {
          const byManager = new Map<string, number[]>()
          for (const r of responses) {
            const mid = r.manager_id as string
            if (!byManager.has(mid)) byManager.set(mid, [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nums = ((r.answers as any[]) ?? [])
              .filter((a: { value: unknown }) => typeof a.value === 'number')
              .map((a: { value: number }) => a.value)
            byManager.get(mid)!.push(...nums)
          }

          let best: { id: string; avg: number } | null = null
          let worst: { id: string; avg: number } | null = null
          for (const [mid, scores] of byManager) {
            if (scores.length < 3) continue
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length
            if (!best || avg > best.avg) best = { id: mid, avg }
            if (!worst || avg < worst.avg) worst = { id: mid, avg }
          }

          const ids = [best?.id, worst?.id].filter((x): x is string => x != null)
          const { data: managers } = ids.length > 0
            ? await adminClient.from('users').select('id, full_name').in('id', ids)
            : { data: [] }
          const nameMap = new Map((managers ?? []).map(m => [m.id as string, m.full_name as string]))

          admin360Stats = {
            bestManager:  best ? (nameMap.get(best.id) ?? null) : null,
            worstManager: worst && worst.id !== best?.id ? (nameMap.get(worst.id) ?? null) : null,
            responseCount: responses.length,
            cycleName: latestClosed.name as string,
          }
        }
      }
    }

    // 8b. My Team (direct reports) — for managers
    if (isManager) {
      const { data: reportsRaw } = await adminClient
        .from('users')
        .select('id, full_name, email, role')
        .eq('organization_id', profile.organization_id)
        .eq('manager_id', user.id)
        .eq('is_anonymised', false)
        .order('full_name')
      directReports = reportsRaw ?? []

      if (directReports.length > 0) {
        const reportIds = directReports.map((r: { id: string }) => r.id as string)

        // Action counts
        const { data: teamActionItems } = await adminClient
          .from('action_items')
          .select('assignee_id, due_date')
          .eq('organization_id', profile.organization_id)
          .eq('is_closed', false)
          .in('assignee_id', reportIds)
        const todayStr = new Date().toISOString()
        ;(teamActionItems ?? []).forEach((a: { assignee_id: string; due_date: string | null }) => {
          const aid = a.assignee_id as string
          actionCountByReport[aid] = (actionCountByReport[aid] ?? 0) + 1
          if (a.due_date && a.due_date < todayStr) {
            overdueCountByReport[aid] = (overdueCountByReport[aid] ?? 0) + 1
          }
        })

        // Score sparklines: recent 1:1 adjusted scores per report
        const { data: recentOooMeetings } = await adminClient
          .from('meetings')
          .select('id, attendee_id')
          .eq('organization_id', profile.organization_id)
          .eq('meeting_type', 'one_on_one')
          .eq('organizer_id', user.id)
          .in('attendee_id', reportIds)
          .order('date', { ascending: false })
          .limit(reportIds.length * 6)

        if ((recentOooMeetings ?? []).length > 0) {
          const ooMeetingIds = (recentOooMeetings ?? []).map(m => m.id as string)
          const { data: scoresRaw } = await adminClient
            .from('one_on_one_scores')
            .select('meeting_id, adjusted_score')
            .in('meeting_id', ooMeetingIds)
            .not('adjusted_score', 'is', null)

          const scoreByMeeting: Record<string, number> = {}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(scoresRaw ?? []).forEach((s: any) => {
            if (s.adjusted_score != null) scoreByMeeting[s.meeting_id as string] = s.adjusted_score as number
          })

          // Build scores per report (newest → oldest from query, so we push then reverse)
          for (const m of (recentOooMeetings ?? [])) {
            const aid = m.attendee_id as string
            const score = scoreByMeeting[m.id as string]
            if (score != null) {
              if (!scoresByReport[aid]) scoresByReport[aid] = []
              if (scoresByReport[aid]!.length < 6) scoresByReport[aid]!.push(score)
            }
          }
          // Reverse each so it's oldest-first for sparkline display
          for (const aid of Object.keys(scoresByReport)) {
            scoresByReport[aid] = scoresByReport[aid]!.reverse()
          }
        }

        // KPI data per report: org KPIs mapped by team membership
        const [{ data: allOrgKpis }, { data: reportMemberships }] = await Promise.all([
          adminClient.from('kpis').select('id, name, team_id, target_value')
            .eq('organization_id', profile.organization_id).eq('is_active', true),
          adminClient.from('team_members').select('user_id, team_id')
            .in('user_id', reportIds),
        ])

        if ((allOrgKpis ?? []).length > 0) {
          const { data: latestKpiRecs } = await adminClient
            .from('kpi_records').select('kpi_id, value')
            .eq('organization_id', profile.organization_id)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .in('kpi_id', (allOrgKpis ?? []).map((k: any) => k.id as string))
            .order('date', { ascending: false })
            .limit((allOrgKpis ?? []).length * 2)

          const latestByKpi: Record<string, number> = {}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(latestKpiRecs ?? []).forEach((r: any) => {
            if (!(r.kpi_id as string in latestByKpi)) latestByKpi[r.kpi_id as string] = r.value as number
          })

          const teamsByReport: Record<string, Set<string>> = {}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(reportMemberships ?? []).forEach((m: any) => {
            const uid = m.user_id as string
            if (!teamsByReport[uid]) teamsByReport[uid] = new Set()
            teamsByReport[uid]!.add(m.team_id as string)
          })

          for (const report of directReports) {
            const rid = report.id as string
            const reportTeams = teamsByReport[rid] ?? new Set()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const visibleKpis = (allOrgKpis ?? []).filter((k: any) =>
              k.team_id == null || reportTeams.has(k.team_id as string)
            ).slice(0, 3)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            kpisByReport[rid] = visibleKpis.map((k: any) => {
              const val = latestByKpi[k.id as string] ?? null
              const target = k.target_value as number | null
              return { name: k.name as string, value: val, target, onTarget: val != null && target != null && val >= target }
            })
          }
        }
      }
    }

    // 8. Projects
    const today = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let visibleProjects: any[] = []
    if (isAdmin) {
      const { data } = await adminClient.from('projects').select('id, status, end_date')
        .eq('organization_id', profile.organization_id).in('status', ['planning', 'active', 'on_hold'])
      visibleProjects = data ?? []
    } else if (isManager) {
      const { data: ledTeams } = await adminClient.from('teams').select('id')
        .eq('organization_id', profile.organization_id).eq('lead_id', user.id)
      const ledTeamIds = (ledTeams ?? []).map(t => t.id as string)
      const { data: ownedP } = await adminClient.from('projects').select('id, status, end_date')
        .eq('organization_id', profile.organization_id).eq('owner_id', user.id).in('status', ['planning', 'active', 'on_hold'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let teamP: any[] = []
      if (ledTeamIds.length > 0) {
        const { data: tp } = await adminClient.from('projects').select('id, status, end_date')
          .eq('organization_id', profile.organization_id).in('team_id', ledTeamIds).in('status', ['planning', 'active', 'on_hold'])
        teamP = tp ?? []
      }
      const seen = new Set<string>()
      for (const p of [...(ownedP ?? []), ...teamP]) {
        if (!seen.has(p.id as string)) { seen.add(p.id as string); visibleProjects.push(p) }
      }
    } else {
      const { data: ownedP } = await adminClient.from('projects').select('id, status, end_date')
        .eq('organization_id', profile.organization_id).eq('owner_id', user.id).in('status', ['planning', 'active', 'on_hold'])
      const { data: actionProjects } = await adminClient.from('action_items').select('project_id')
        .eq('organization_id', profile.organization_id).eq('assignee_id', user.id).not('project_id', 'is', null)
      const apIds = [...new Set((actionProjects ?? []).map(a => a.project_id as string))]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ap: any[] = []
      if (apIds.length > 0) {
        const { data: apData } = await adminClient.from('projects').select('id, status, end_date')
          .eq('organization_id', profile.organization_id).in('id', apIds).in('status', ['planning', 'active', 'on_hold'])
        ap = apData ?? []
      }
      const seen = new Set<string>()
      for (const p of [...(ownedP ?? []), ...ap]) {
        if (!seen.has(p.id as string)) { seen.add(p.id as string); visibleProjects.push(p) }
      }
    }
    activeProjectCount = visibleProjects.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overdueProjectCount = visibleProjects.filter((p: any) =>
      p.end_date != null && (p.end_date as string) < today && (p.status as string) === 'active'
    ).length
  }

  // ── Platform metrics (platform admin only) ──────────────────────────────────
  interface OrgRow {
    id: string
    name: string
    subscription_status: string | null
    created_at: string
  }
  interface OrgMetric {
    id: string
    name: string
    subscription_status: string | null
    created_at: string
    userCount: number
    meetingsLast30: number
    activeProjects: number
    lastActivityDate: string | null
  }

  let platformOrgs: OrgMetric[] = []
  let platformTotals = { orgs: 0, users: 0, meetings: 0, activeProjects: 0 }
  let quietOrgs: { id: string; name: string }[] = []
  let newOrgsLast30 = 0

  if (isPlatformAdmin) {
    const adminClient = createAdminClient()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: orgsRaw } = await adminClient
      .from('organizations')
      .select('id, name, subscription_status, created_at')
      .order('created_at', { ascending: false })

    const orgs: OrgRow[] = (orgsRaw ?? []).map(o => ({
      id: o.id as string,
      name: o.name as string,
      subscription_status: o.subscription_status as string | null,
      created_at: o.created_at as string,
    }))
    platformTotals.orgs = orgs.length
    newOrgsLast30 = orgs.filter(o => o.created_at >= thirtyDaysAgo).length

    const { data: usersRaw } = await adminClient
      .from('users')
      .select('organization_id')
      .limit(10000)
    const userCountByOrg: Record<string, number> = {}
    ;(usersRaw ?? []).forEach(u => {
      const oid = u.organization_id as string | null
      if (oid) userCountByOrg[oid] = (userCountByOrg[oid] ?? 0) + 1
    })
    platformTotals.users = Object.values(userCountByOrg).reduce((s, c) => s + c, 0)

    const { data: meetingsRaw } = await adminClient
      .from('meetings')
      .select('organization_id, date')
      .gte('date', thirtyDaysAgo)
      .limit(10000)
    const meetingCountByOrg: Record<string, number> = {}
    const lastMeetingByOrg: Record<string, string> = {}
    ;(meetingsRaw ?? []).forEach(m => {
      const oid = m.organization_id as string | null
      const d = m.date as string | null
      if (oid && d) {
        meetingCountByOrg[oid] = (meetingCountByOrg[oid] ?? 0) + 1
        if (!lastMeetingByOrg[oid] || d > lastMeetingByOrg[oid]!) lastMeetingByOrg[oid] = d
      }
    })
    platformTotals.meetings = Object.values(meetingCountByOrg).reduce((s, c) => s + c, 0)

    // All-time last meeting date per org (for the Last Meeting column)
    const { data: allTimeMeetingsRaw } = await adminClient
      .from('meetings')
      .select('organization_id, date')
      .order('date', { ascending: false })
      .limit(10000)
    const allTimeLastMeetingByOrg: Record<string, string> = {}
    ;(allTimeMeetingsRaw ?? []).forEach(m => {
      const oid = m.organization_id as string | null
      const d = m.date as string | null
      if (oid && d && !allTimeLastMeetingByOrg[oid]) {
        allTimeLastMeetingByOrg[oid] = d
      }
    })

    const { data: projectsRaw } = await adminClient
      .from('projects')
      .select('organization_id, status')
      .eq('status', 'active')
      .limit(10000)
    const projectCountByOrg: Record<string, number> = {}
    ;(projectsRaw ?? []).forEach(p => {
      const oid = p.organization_id as string | null
      if (oid) projectCountByOrg[oid] = (projectCountByOrg[oid] ?? 0) + 1
    })
    platformTotals.activeProjects = Object.values(projectCountByOrg).reduce((s, c) => s + c, 0)

    platformOrgs = orgs.map(o => ({
      ...o,
      userCount: userCountByOrg[o.id] ?? 0,
      meetingsLast30: meetingCountByOrg[o.id] ?? 0,
      activeProjects: projectCountByOrg[o.id] ?? 0,
      lastActivityDate: allTimeLastMeetingByOrg[o.id] ?? null,
    }))

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    quietOrgs = platformOrgs
      .filter(o => o.meetingsLast30 === 0 && o.created_at < sevenDaysAgo)
      .map(o => ({ id: o.id, name: o.name }))
  }

  const now = new Date()
  const isOverdue = (d: string | null) => d != null && new Date(d) < now

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const widgetCount = [activeProjectCount > 0, hasPulseSurveys, has360Cycles].filter(Boolean).length

  return (
    <PageShell>
      <div className="page-content">

        {message && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', backgroundColor: 'var(--green-bg)', border: '1px solid var(--green-border)', color: '#166534', fontSize: '0.875rem' }}>
            {message}
          </div>
        )}

        {/* Page heading */}
        <div className="page-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h1 className="page-title">{greeting}, {firstName}</h1>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{role}</p>
          </div>
        </div>

        {/* ── Tabs (managers see Overview + My Team; platform admins see Platform) ── */}
        {(isManager || isPlatformAdmin) && (
          <div className="tab-nav" style={{ marginBottom: '1.25rem' }}>
            <a href="/" className={`tab-item${activeTab === 'overview' ? ' active' : ''}`}>Overview</a>
            {isManager && (
              <a href="/?tab=team" className={`tab-item${activeTab === 'team' ? ' active' : ''}`}>
                My Team
                {directReports.length > 0 && (
                  <span className="badge badge-gray" style={{ marginLeft: '0.375rem', fontSize: '0.7rem' }}>{directReports.length}</span>
                )}
              </a>
            )}
            {isPlatformAdmin && (
              <a href="/?tab=platform" className={`tab-item${activeTab === 'platform' ? ' active' : ''}`}>
                Platform
              </a>
            )}
          </div>
        )}

        {/* ── My Team tab ── */}
        {activeTab === 'team' && isManager && (
          <div>
            {directReports.length === 0 ? (
              <div className="card">
                <div className="card-body">
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-subtle)' }}>
                    No direct reports found. Reporting lines can be set under Admin → User Management.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.875rem' }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {directReports.map((member: any) => {
                  const openActions  = actionCountByReport[member.id as string] ?? 0
                  const overdue      = overdueCountByReport[member.id as string] ?? 0
                  const scores       = scoresByReport[member.id as string] ?? []
                  const memberKpis   = kpisByReport[member.id as string] ?? []
                  const latestScore  = scores.length > 0 ? scores[scores.length - 1] : null
                  const scorePath    = buildSparklinePath(scores)
                  const initials     = ((member.full_name ?? member.email) as string)
                    .split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
                  return (
                    <div key={member.id as string} className="card" style={{ padding: '0' }}>
                      {/* Header strip */}
                      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          width: '2.25rem', height: '2.25rem', borderRadius: '9999px',
                          background: 'var(--brand-light)', color: 'var(--brand-dark)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: '0.875rem', flexShrink: 0,
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {member.full_name ?? member.email}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{member.role}</p>
                        </div>
                      </div>

                      {/* Actions + Score row */}
                      <div style={{ padding: '0.875rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', borderBottom: memberKpis.length > 0 ? '1px solid var(--border)' : 'none' }}>
                        {/* Open actions */}
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{openActions}</p>
                          <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.7rem', color: 'var(--text-subtle)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>open actions</p>
                          {overdue > 0 && <span className="badge badge-red" style={{ marginTop: '0.35rem', display: 'inline-block' }}>⚠ {overdue} overdue</span>}
                          {openActions === 0 && <span className="badge badge-green" style={{ marginTop: '0.35rem', display: 'inline-block' }}>✓ All clear</span>}
                          {openActions > 0 && overdue === 0 && <span className="badge badge-gray" style={{ marginTop: '0.35rem', display: 'inline-block', fontSize: '0.7rem' }}>on track</span>}
                        </div>
                        {/* Score sparkline */}
                        {latestScore != null && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: latestScore >= 7 ? 'var(--green)' : latestScore >= 4 ? 'var(--text)' : 'var(--red)', lineHeight: 1 }}>{latestScore}</p>
                            <p style={{ margin: '0.15rem 0 0.25rem 0', fontSize: '0.7rem', color: 'var(--text-subtle)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>adj. score</p>
                            {scorePath && (
                              <svg width="52" height="18" viewBox="0 0 60 20" preserveAspectRatio="none">
                                <path d={scorePath} fill="none"
                                  stroke={latestScore >= 7 ? 'var(--green)' : latestScore >= 4 ? 'var(--brand)' : 'var(--red)'}
                                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        )}
                      </div>

                      {/* KPI mini-row */}
                      {memberKpis.length > 0 && (
                        <div style={{ padding: '0.625rem 1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                          {memberKpis.map(kpi => (
                            <div key={kpi.name} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                              <span style={{
                                width: '7px', height: '7px', borderRadius: '9999px', flexShrink: 0,
                                background: kpi.value == null ? 'var(--border)' : kpi.onTarget ? 'var(--green)' : 'var(--red)',
                              }} />
                              <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }} title={kpi.name}>{kpi.name}</span>
                              {kpi.value != null && (
                                <span style={{ fontWeight: 600, color: kpi.onTarget ? 'var(--green)' : 'var(--text)' }}>{kpi.value.toLocaleString()}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Footer links */}
                      <div style={{ padding: '0.625rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem' }}>
                        <a href={`/actions?viewing=${member.id as string}&from=team`} className="link" style={{ fontSize: '0.8rem' }}>Actions →</a>
                        <a href="/reporting?from=team" className="link" style={{ fontSize: '0.8rem' }}>Reporting →</a>
                        <a href={`/meetings/new?type=one_on_one&attendee=${member.id as string}`} className="link" style={{ fontSize: '0.8rem', marginLeft: 'auto' }}>+ 1:1</a>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Platform tab ── */}
        {activeTab === 'platform' && isPlatformAdmin && (
          <div>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
              {[
                { label: 'Organisations', value: platformTotals.orgs },
                { label: 'Total Users', value: platformTotals.users },
                { label: 'Meetings (30d)', value: platformTotals.meetings },
                { label: 'Active Projects', value: platformTotals.activeProjects },
              ].map(card => (
                <div key={card.label} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Health alerts */}
            {(quietOrgs.length > 0 || newOrgsLast30 > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                {quietOrgs.length > 0 && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem' }}>
                    <p style={{ margin: 0, fontWeight: 600, color: '#991b1b', fontSize: '0.875rem' }}>⚠ Going quiet ({quietOrgs.length})</p>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#7f1d1d' }}>No meetings in 30+ days</p>
                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem', color: '#991b1b' }}>
                      {quietOrgs.map(org => <li key={org.id}>{org.name}</li>)}
                    </ul>
                  </div>
                )}
                {newOrgsLast30 > 0 && (
                  <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1rem' }}>
                    <p style={{ margin: 0, fontWeight: 600, color: '#166534', fontSize: '0.875rem' }}>✓ New this month</p>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '2rem', fontWeight: 700, color: '#166534' }}>{newOrgsLast30}</p>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#166534' }}>organisations joined in the last 30 days</p>
                  </div>
                )}
              </div>
            )}

            {/* Per-org table */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>All Organisations</h3>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    {['Organisation', 'Status', 'Users', 'Meetings (30d)', 'Active Projects', 'Last Meeting'].map(h => (
                      <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 500, color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {platformOrgs.map((org, i) => (
                    <tr key={org.id} style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{org.name}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          display: 'inline-block', padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 500,
                          backgroundColor: org.subscription_status === 'active' ? '#dcfce7' : org.subscription_status === 'trial' ? '#fef9c3' : '#f3f4f6',
                          color: org.subscription_status === 'active' ? '#166534' : org.subscription_status === 'trial' ? '#854d0e' : '#6b7280',
                        }}>
                          {org.subscription_status ?? 'unknown'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>{org.userCount}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ color: org.meetingsLast30 === 0 ? '#dc2626' : '#111827' }}>{org.meetingsLast30}</span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>{org.activeProjects}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>
                        {org.lastActivityDate
                          ? new Date(org.lastActivityDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {platformOrgs.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>No organisations yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Overview tab (default) ── */}
        {activeTab === 'overview' && (
        <div>

        {/* ── Row 1: Actions + Goals side-by-side ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

          {/* Open Actions */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                Open Actions
                <span className="badge badge-dark" style={{ marginLeft: '0.25rem' }}>{openActions.length}</span>
              </h3>
              <a href="/actions?filter=open" className="link">View all →</a>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              {openActions.length === 0 ? (
                <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1rem' }}>🎉</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--green)', fontWeight: 500 }}>All clear — no open actions</span>
                </div>
              ) : (
                <div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {openActions.map((action: any, idx: number) => {
                    const overdue = isOverdue(action.due_date as string | null)
                    const meeting = action.meetings as { title?: string; purpose?: string } | null
                    const label = (action.action_text as string | null) ?? (action.title as string | null) ?? 'Untitled action'
                    const meetingTitle = meeting?.title ?? meeting?.purpose ?? null
                    return (
                      <div key={action.id as string} style={{
                        padding: '0.75rem 1.25rem',
                        borderTop: idx > 0 ? '1px solid var(--border)' : undefined,
                      }}>
                        <div style={{ fontSize: '0.8375rem', color: 'var(--text)', lineHeight: 1.5, marginBottom: '0.25rem' }}>
                          {label}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {action.due_date && (
                            <span style={{ color: overdue ? 'var(--red)' : 'var(--text-muted)', fontWeight: overdue ? 600 : 400 }}>
                              {overdue && '⚠ '}Due {new Date(action.due_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          {meetingTitle && <span style={{ color: 'var(--text-subtle)' }}>· from {meetingTitle}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Goals & OKRs */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                Goals & OKRs
                {activeObjectives.length > 0 && (
                  <span className="badge badge-blue" style={{ marginLeft: '0.25rem' }}>{activeObjectives.length} active</span>
                )}
              </h3>
              <a href="/goals" className="link">View all →</a>
            </div>
            <div className="card-body" style={{ padding: '0' }}>
              {activeObjectives.length === 0 ? (
                <div style={{ padding: '1rem 1.25rem' }}>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-subtle)' }}>No active objectives</p>
                </div>
              ) : (
                <div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {activeObjectives.map((obj: any, idx: number) => {
                    const progress = progressMap[obj.id as string] ?? { total: 0, complete: 0 }
                    const pct = progress.total > 0 ? Math.round((progress.complete / progress.total) * 100) : 0
                    const tName = obj.team_id ? (teamMap[obj.team_id as string] ?? null) : null
                    return (
                      <a key={obj.id as string} href={`/goals/${obj.id as string}`} style={{
                        display: 'block',
                        padding: '0.75rem 1.25rem',
                        borderTop: idx > 0 ? '1px solid var(--border)' : undefined,
                        textDecoration: 'none',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.375rem' }}>
                          <span style={{ fontSize: '0.8375rem', color: 'var(--text)', fontWeight: 500, flex: 1, lineHeight: 1.4 }}>
                            {obj.title as string}
                          </span>
                          {tName && <span className="badge badge-teal">{tName}</span>}
                        </div>
                        {progress.total > 0 ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-subtle)', marginBottom: '0.25rem' }}>
                              <span>{progress.complete}/{progress.total} KRs</span>
                              <span>{pct}%</span>
                            </div>
                            <div style={{ height: '3px', backgroundColor: 'var(--border)', borderRadius: '9999px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? 'var(--green)' : 'var(--brand)', borderRadius: '9999px' }} />
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>No key results yet</span>
                        )}
                        {obj.end_date && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '0.3rem' }}>
                            Due {new Date(obj.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Row 2: Projects + Pulse + 360 (conditionally shown) ── */}
        {(activeProjectCount > 0 || hasPulseSurveys || has360Cycles) && (
          <div style={{ display: 'grid', gridTemplateColumns: widgetCount === 3 ? '1fr 1fr 1fr' : widgetCount === 2 ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1rem' }}>

            {activeProjectCount > 0 && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Projects</h3>
                  <a href="/projects" className="link">View all →</a>
                </div>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{activeProjectCount}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>active project{activeProjectCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ height: '2.5rem', width: '1px', background: 'var(--border)' }} />
                  {overdueProjectCount > 0 ? (
                    <div>
                      <span className="badge badge-red" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                        ⚠ {overdueProjectCount} overdue
                      </span>
                    </div>
                  ) : (
                    <span className="badge badge-green" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>✓ None overdue</span>
                  )}
                </div>
              </div>
            )}

            {hasPulseSurveys && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Pulse Surveys</h3>
                  <a href={isAdmin ? '/admin/surveys' : '/surveys'} className="link">{isAdmin ? 'Manage →' : 'View all →'}</a>
                </div>
                <div className="card-body">
                  {!isAdmin && (
                    pendingSurveyCount > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                        <span style={{ fontSize: '0.875rem', color: 'var(--amber)', fontWeight: 500 }}>
                          📋 {pendingSurveyCount} survey{pendingSurveyCount !== 1 ? 's' : ''} awaiting response
                        </span>
                        <a href="/surveys" style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem', backgroundColor: 'var(--text)', color: 'white', borderRadius: 'var(--radius-sm)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Complete →
                        </a>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.875rem', color: 'var(--green)', fontWeight: 500 }}>✓ All surveys complete</span>
                    )
                  )}
                  {isAdmin && (
                    pulseAdminStats ? (
                      <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Last: <strong style={{ color: 'var(--text)' }}>{pulseAdminStats.periodLabel}</strong> · {pulseAdminStats.responseCount} responses</span>
                        {pulseAdminStats.bestTeam && <span className="badge badge-green">🏆 {pulseAdminStats.bestTeam}</span>}
                        {pulseAdminStats.worstTeam && <span className="badge badge-red">⚠ {pulseAdminStats.worstTeam}</span>}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-subtle)' }}>No closed periods yet.</p>
                    )
                  )}
                </div>
              </div>
            )}

            {has360Cycles && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">360 Feedback</h3>
                  <a href={isAdmin ? '/admin/360' : '/360'} className="link">{isAdmin ? 'Manage →' : 'View all →'}</a>
                </div>
                <div className="card-body">
                  {!isAdmin && profile?.manager_id && (
                    pending360Count > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                        <span style={{ fontSize: '0.875rem', color: 'var(--amber)', fontWeight: 500 }}>
                          📋 {pending360Count} review{pending360Count !== 1 ? 's' : ''} awaiting submission
                        </span>
                        <a href="/360" style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem', backgroundColor: 'var(--text)', color: 'white', borderRadius: 'var(--radius-sm)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Review →
                        </a>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.875rem', color: 'var(--green)', fontWeight: 500 }}>✓ All reviews submitted</span>
                    )
                  )}
                  {!isAdmin && !profile?.manager_id && (
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No manager assigned yet.</span>
                  )}
                  {isAdmin && (
                    admin360Stats ? (
                      <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Last: <strong style={{ color: 'var(--text)' }}>{admin360Stats.cycleName}</strong> · {admin360Stats.responseCount} responses</span>
                        {admin360Stats.bestManager && <span className="badge badge-green">🏆 {admin360Stats.bestManager}</span>}
                        {admin360Stats.worstManager && <span className="badge badge-red">⚠ {admin360Stats.worstManager}</span>}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-subtle)' }}>No closed cycles yet.</p>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Row 3: KPI Snapshot ── */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              KPI Snapshot
              {snapshotKpis.length > 0 && (
                <span className="badge badge-gray" style={{ marginLeft: '0.25rem' }}>{snapshotKpis.length}</span>
              )}
            </h3>
            <a href="/kpis" className="link">View all →</a>
          </div>
          <div className="card-body">
            {snapshotKpis.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-subtle)' }}>No KPIs assigned to your organisation yet</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {snapshotKpis.map((kpi: any) => {
                  const records = recordsByKpi[kpi.id as string] ?? []  // number[], newest first
                  const current = records[0] ?? null
                  const prev    = records[1] ?? null
                  const target  = kpi.target_value as number | null
                  const unit    = kpi.unit as string | null

                  const onTarget = target != null && current != null && current >= target

                  // Sparkline colour: on-target status takes priority over trend direction
                  let sparkColor = 'var(--text-subtle)'
                  if (target != null && current != null) {
                    sparkColor = onTarget ? 'var(--green)' : 'var(--red)'
                  } else if (current != null && prev != null) {
                    sparkColor = current > prev ? 'var(--green)' : current < prev ? 'var(--red)' : 'var(--text-subtle)'
                  }

                  // Oldest-first for sparkline display
                  const sparkValues = [...records].reverse()
                  const sparkPath = buildSparklinePath(sparkValues)

                  return (
                    <a
                      key={kpi.id as string}
                      href={`/kpis/${kpi.id as string}`}
                      style={{
                        display: 'block',
                        background: 'var(--surface-muted)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.875rem',
                        border: '1px solid var(--border)',
                        borderLeftWidth: '3px',
                        borderLeftColor: onTarget ? 'var(--green)' : current == null ? 'var(--border-strong)' : 'var(--red)',
                        textDecoration: 'none',
                        transition: 'box-shadow 0.12s',
                      }}
                    >
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginBottom: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {kpi.name as string}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
                          {current != null ? current.toLocaleString() : '—'}
                        </span>
                        {unit && current != null && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{unit}</span>
                        )}
                      </div>
                      {/* Sparkline */}
                      {sparkPath ? (
                        <svg width="100%" height="22" viewBox="0 0 60 20" preserveAspectRatio="none" style={{ display: 'block', marginBottom: '0.25rem' }}>
                          <path d={sparkPath} fill="none" stroke={sparkColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <div style={{ height: '22px', marginBottom: '0.25rem' }} />
                      )}
                      {target != null && current != null && (
                        <div style={{ fontSize: '0.6875rem', color: onTarget ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                          {onTarget ? '✓ on target' : '✗ below target'}
                        </div>
                      )}
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        </div>
        )}

      </div>
    </PageShell>
  )
}
