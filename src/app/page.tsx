import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { signout } from '@/app/login/actions'
import { redirect } from 'next/navigation'

export default async function HomePage({
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
    .select('id, full_name, role, is_platform_admin, organization_id')
    .eq('id', user.id)
    .single()

  const isPlatformAdmin = profile?.is_platform_admin ?? false
  const role = profile?.role ?? 'contributor'
  const isAdmin   = role === 'admin'
  const isManager = isAdmin || role === 'manager'
  const name = profile?.full_name ?? user.email

  // ── Widget data (org users only) ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openActions: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshotKpis: any[] = []
  let recordsByKpi: Record<string, { value: number; date: string }[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeObjectives: any[] = []
  let progressMap: Record<string, { total: number; complete: number }> = {}
  let teamMap: Record<string, string> = {}

  // Pulse surveys widget data
  let pendingSurveyCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pulseAdminStats: { bestTeam: string | null; worstTeam: string | null; responseCount: number; periodLabel: string } | null = null
  let hasPulseSurveys = false

  // Projects widget data
  let activeProjectCount = 0
  let overdueProjectCount = 0

  if (!isPlatformAdmin && profile?.organization_id) {
    const adminClient = createAdminClient()

    // 1. My open actions (up to 5, soonest due first)
    const { data: actionsRaw } = await adminClient
      .from('action_items')
      .select('id, action_text, title, due_date, meeting_id, meetings(id, title, purpose, meeting_type)')
      .eq('organization_id', profile.organization_id)
      .eq('assignee_id', user.id)
      .eq('is_closed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5)

    openActions = actionsRaw ?? []

    // 2. Visible KPIs (audience + team filtered)
    const { data: kpisRaw } = await adminClient
      .from('kpis')
      .select('id, name, unit, category, target_value, audience, team_id')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .order('category')
      .order('display_order')

    const { data: myMemberships } = await adminClient
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)

    const myTeamIds = new Set((myMemberships ?? []).map(m => m.team_id as string))

    // All users see all KPIs; contributors only filtered by team membership
    const allVisible = isManager
      ? (kpisRaw ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (kpisRaw ?? []).filter((k: any) =>
          k.team_id == null || myTeamIds.has(k.team_id as string)
        )

    snapshotKpis = allVisible.slice(0, 6)

    // 3. Latest KPI records (batch, up to 2 per KPI, grouped client-side)
    if (snapshotKpis.length > 0) {
      const { data: recentRecords } = await adminClient
        .from('kpi_records')
        .select('kpi_id, value, date')
        .eq('organization_id', profile.organization_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in('kpi_id', snapshotKpis.map((k: any) => k.id as string))
        .order('date', { ascending: false })
        .limit(snapshotKpis.length * 2 + 10)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(recentRecords ?? []).forEach((r: any) => {
        const kid = r.kpi_id as string
        if (!recordsByKpi[kid]) recordsByKpi[kid] = []
        if (recordsByKpi[kid]!.length < 2) {
          recordsByKpi[kid]!.push({ value: r.value as number, date: r.date as string })
        }
      })
    }

    // 4. Active objectives (up to 4, soonest end_date first)
    const { data: objRaw } = await adminClient
      .from('objectives')
      .select('id, title, team_id, end_date, status')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'active')
      .order('end_date', { ascending: true, nullsFirst: false })
      .limit(4)

    activeObjectives = objRaw ?? []

    // 5. KR counts for those objectives
    if (activeObjectives.length > 0) {
      const { data: krs } = await adminClient
        .from('key_results')
        .select('objective_id, status')
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

    // 6. Teams (for objective team badges)
    const { data: teamsRaw } = await adminClient
      .from('teams')
      .select('id, name')
      .eq('organization_id', profile.organization_id)

    teamMap = Object.fromEntries(
      (teamsRaw ?? []).map(t => [t.id as string, t.name as string])
    )

    // 7. Pulse surveys widget
    const { data: activeSurveys } = await adminClient
      .from('pulse_surveys')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .limit(1)

    hasPulseSurveys = (activeSurveys ?? []).length > 0

    if (hasPulseSurveys) {
      // Open periods for org
      const { data: openPeriodsRaw } = await adminClient
        .from('pulse_periods')
        .select('id, period_label, survey_id')
        .eq('organization_id', profile.organization_id)
        .eq('is_closed', false)

      const openPeriodIds = (openPeriodsRaw ?? []).map(p => p.id as string)

      if (openPeriodIds.length > 0) {
        // User's completions for open periods
        const { data: myTeamMemberships } = await adminClient
          .from('team_members')
          .select('team_id')
          .eq('user_id', user.id)
          .eq('organization_id', profile.organization_id)

        const myTids = (myTeamMemberships ?? []).map(m => m.team_id as string)
        const completedKeys = new Set<string>()

        if (myTids.length > 0) {
          const { data: completionsRaw } = await adminClient
            .from('pulse_completions')
            .select('period_id, team_id')
            .eq('user_id', user.id)
            .in('period_id', openPeriodIds)

          ;(completionsRaw ?? []).forEach(c => {
            completedKeys.add(`${c.period_id as string}:${c.team_id as string}`)
          })

          // Count pending: (period × team) where not completed
          for (const p of openPeriodsRaw ?? []) {
            for (const tid of myTids) {
              if (!completedKeys.has(`${p.id as string}:${tid}`)) {
                pendingSurveyCount++
              }
            }
          }
        }
      }

      // Admin: best/worst team from most recent closed period
      if (isAdmin) {
        const { data: recentClosed } = await adminClient
          .from('pulse_periods')
          .select('id, period_label')
          .eq('organization_id', profile.organization_id)
          .eq('is_closed', true)
          .order('closes_at', { ascending: false })
          .limit(1)

        const recentPeriod = (recentClosed ?? [])[0] ?? null

        if (recentPeriod) {
          const { data: closedResponses } = await adminClient
            .from('pulse_responses')
            .select('team_id')
            .eq('period_id', recentPeriod.id as string)
            .eq('organization_id', profile.organization_id)

          const countByTeam: Record<string, number> = {}
          ;(closedResponses ?? []).forEach(r => {
            const tid = r.team_id as string
            countByTeam[tid] = (countByTeam[tid] ?? 0) + 1
          })

          const eligible = Object.entries(countByTeam)
            .filter(([, c]) => c >= 3)
            .sort(([, a], [, b]) => b - a)

          pulseAdminStats = {
            bestTeam:     eligible.length >= 2 ? (teamMap[eligible[0]![0]] ?? null) : null,
            worstTeam:    eligible.length >= 2 ? (teamMap[eligible[eligible.length - 1]![0]] ?? null) : null,
            responseCount: (closedResponses ?? []).length,
            periodLabel:  recentPeriod.period_label as string,
          }
        }
      }
    }

    // 8. Projects widget — count active/planning projects visible to this user
    {
      const today = new Date().toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let visibleProjects: any[] = []

      if (isAdmin) {
        const { data } = await adminClient
          .from('projects')
          .select('id, status, end_date')
          .eq('organization_id', profile.organization_id)
          .in('status', ['planning', 'active', 'on_hold'])
        visibleProjects = data ?? []
      } else if (isManager) {
        const { data: ledTeams } = await adminClient
          .from('teams')
          .select('id')
          .eq('organization_id', profile.organization_id)
          .eq('lead_id', user.id)
        const ledTeamIds = (ledTeams ?? []).map(t => t.id as string)

        const { data: ownedP } = await adminClient
          .from('projects')
          .select('id, status, end_date')
          .eq('organization_id', profile.organization_id)
          .eq('owner_id', user.id)
          .in('status', ['planning', 'active', 'on_hold'])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let teamP: any[] = []
        if (ledTeamIds.length > 0) {
          const { data: tp } = await adminClient
            .from('projects')
            .select('id, status, end_date')
            .eq('organization_id', profile.organization_id)
            .in('team_id', ledTeamIds)
            .in('status', ['planning', 'active', 'on_hold'])
          teamP = tp ?? []
        }
        const seen = new Set<string>()
        for (const p of [...(ownedP ?? []), ...teamP]) {
          if (!seen.has(p.id as string)) { seen.add(p.id as string); visibleProjects.push(p) }
        }
      } else {
        const { data: ownedP } = await adminClient
          .from('projects')
          .select('id, status, end_date')
          .eq('organization_id', profile.organization_id)
          .eq('owner_id', user.id)
          .in('status', ['planning', 'active', 'on_hold'])

        const { data: actionProjects } = await adminClient
          .from('action_items')
          .select('project_id')
          .eq('organization_id', profile.organization_id)
          .eq('assignee_id', user.id)
          .not('project_id', 'is', null)

        const apIds = [...new Set((actionProjects ?? []).map(a => a.project_id as string))]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ap: any[] = []
        if (apIds.length > 0) {
          const { data: apData } = await adminClient
            .from('projects')
            .select('id, status, end_date')
            .eq('organization_id', profile.organization_id)
            .in('id', apIds)
            .in('status', ['planning', 'active', 'on_hold'])
          ap = apData ?? []
        }
        const seen = new Set<string>()
        for (const p of [...(ownedP ?? []), ...ap]) {
          if (!seen.has(p.id as string)) { seen.add(p.id as string); visibleProjects.push(p) }
        }
      }

      activeProjectCount = visibleProjects.length
      overdueProjectCount = visibleProjects.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => p.end_date != null && (p.end_date as string) < today && (p.status as string) === 'active'
      ).length
    }
  }

  const now = new Date()
  const isOverdue = (dueDateStr: string | null) =>
    dueDateStr != null && new Date(dueDateStr) < now

  // ── Nav items (role-filtered) ─────────────────────────────────────────────
  const navItems: { label: string; href: string; description: string }[] = []

  if (isPlatformAdmin) {
    navItems.push({ label: 'Platform Administration', href: '/platform-admin', description: 'Create and manage client organisations and their admin accounts.' })
    navItems.push({ label: 'Meetings Overview', href: '/platform-admin/meetings', description: 'View all meetings across every organisation for consistency oversight.' })
    navItems.push({ label: 'System Options', href: '/platform-admin/options', description: 'Manage system-wide default dropdown options available to all organisations.' })
    navItems.push({ label: 'KPI Catalogue', href: '/platform-admin/kpis', description: 'Manage the system KPI library and pre-load KPIs for organisations at onboarding.' })
    navItems.push({ label: 'View All Users', href: '/platform-admin/users', description: 'Browse, edit and remove users across all organisations.' })
    navItems.push({ label: 'Platform Team', href: '/platform-admin/team', description: 'Manage platform administrators who maintain the system.' })
    navItems.push({ label: 'Audit Log', href: '/platform-admin/audit', description: 'Full change history across all organisations and platform actions.' })
    navItems.push({ label: 'Org Dashboard Preview', href: '/platform-admin/preview', description: 'Preview the dashboard as any org — switch role view to see what each level can and can\'t see.' })
  }

  if (isAdmin && !isPlatformAdmin) {
    navItems.push({ label: 'User Management', href: '/admin/users', description: 'Add, edit and manage users in your organisation.' })
    navItems.push({ label: 'Audit Log', href: '/admin/audit', description: 'View a record of all user management changes in your organisation.' })
    navItems.push({ label: 'Custom Fields', href: '/admin/fields', description: 'Define extra fields to capture on meetings, projects, KPIs and users.' })
    navItems.push({ label: 'Dropdown Options', href: '/admin/options', description: 'Manage the predefined options available in meeting and review dropdowns.' })
    navItems.push({ label: 'KPI Management', href: '/admin/kpis', description: 'Assign KPIs to your organisation, set targets and control visibility.' })
    navItems.push({ label: 'Teams', href: '/admin/teams', description: 'Create teams, assign members and scope KPIs to specific teams.' })
    navItems.push({ label: 'Pulse Surveys', href: '/admin/surveys', description: 'Create anonymous team pulse surveys and view aggregated results. Individual responses are never linked to anyone.' })
  }

  if (!isPlatformAdmin) {
    navItems.push({ label: 'My Meetings', href: '/meetings', description: 'View, create and manage your 1:1s, team meetings and project meetings.' })
    navItems.push({ label: 'My Actions', href: '/actions', description: 'Track all actions agreed in your meetings.' })
    navItems.push({ label: 'Projects', href: '/projects', description: 'Track active projects, outcomes, and their impact on team capacity.' })
    navItems.push({ label: 'My KPIs', href: '/kpis', description: 'View your organisation\'s KPIs and track performance over time.' })
    navItems.push({ label: 'Goals & OKRs', href: '/goals', description: 'Track objectives and key results aligned to your organisation\'s KPIs.' })
    navItems.push({ label: 'My Surveys', href: '/surveys', description: 'Respond to your team\'s pulse surveys anonymously. Your answers are never linked to you.' })
  }

  navItems.push({ label: 'Change Password', href: '/account/change-password', description: 'Update your login password.' })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '3.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '1rem', color: '#111827' }}>Leadership Hub</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{name}</span>
            <form>
              <button
                formAction={signout}
                style={{ fontSize: '0.8rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1.5rem' }}>
        {message && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1.5rem',
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            fontSize: '0.875rem',
          }}>
            {message}
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#111827' }}>Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
          <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
            {isPlatformAdmin ? 'Platform Administrator' : `${role.charAt(0).toUpperCase() + role.slice(1)}`}
          </p>
        </div>

        {/* ── Dashboard widgets (org users only) ──────────────────────────── */}
        {!isPlatformAdmin && (
          <>
            {/* ROW 1: Open Actions + OKR Progress */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

              {/* Open Actions widget */}
              <div style={{ flex: '1.2 1 280px', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Open Actions</h3>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#111827', color: 'white' }}>
                    {openActions.length}
                  </span>
                </div>

                {openActions.length === 0 ? (
                  <div style={{ padding: '0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.875rem', color: '#166534' }}>🎉 No open actions</span>
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
                        <div key={action.id as string}>
                          {idx > 0 && <div style={{ borderTop: '1px solid #f3f4f6', margin: '0.625rem 0' }} />}
                          <div style={{ fontSize: '0.875rem', color: '#111827', lineHeight: 1.45, marginBottom: '0.25rem' }}>
                            {label}
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                            {action.due_date && (
                              <span style={{ color: overdue ? '#dc2626' : '#6b7280', fontWeight: overdue ? 600 : 400 }}>
                                {overdue ? '⚠ Overdue · ' : ''}Due {new Date(action.due_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            {meetingTitle && (
                              <span style={{ color: '#9ca3af' }}>from {meetingTitle}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                  <a href="/actions?filter=open" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>
                    View all open actions →
                  </a>
                </div>
              </div>

              {/* OKR Progress widget */}
              <div style={{ flex: '1 1 220px', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Goals & OKRs</h3>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                    {activeObjectives.length} active
                  </span>
                </div>

                {activeObjectives.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>No active objectives</p>
                ) : (
                  <div>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {activeObjectives.map((obj: any, idx: number) => {
                      const progress = progressMap[obj.id as string] ?? { total: 0, complete: 0 }
                      const pct = progress.total > 0 ? Math.round((progress.complete / progress.total) * 100) : 0
                      const tName = obj.team_id ? (teamMap[obj.team_id as string] ?? null) : null
                      return (
                        <div key={obj.id as string}>
                          {idx > 0 && <div style={{ borderTop: '1px solid #f3f4f6', margin: '0.625rem 0' }} />}
                          <a href={`/goals/${obj.id as string}`} style={{ textDecoration: 'none', display: 'block' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginBottom: '0.3rem' }}>
                              <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500, flex: 1, lineHeight: 1.4 }}>
                                {obj.title as string}
                              </span>
                              {tName && (
                                <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', backgroundColor: '#ecfeff', color: '#0e7490', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {tName}
                                </span>
                              )}
                            </div>
                            {progress.total > 0 ? (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.2rem' }}>
                                  <span>{progress.complete}/{progress.total} KRs</span>
                                  <span>{pct}%</span>
                                </div>
                                <div style={{ height: '4px', backgroundColor: '#e5e7eb', borderRadius: '9999px', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#166534' : '#2563eb', borderRadius: '9999px' }} />
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No key results yet</span>
                            )}
                            {obj.end_date && (
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                                Due {new Date(obj.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </a>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                  <a href="/goals" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>
                    View all goals →
                  </a>
                </div>
              </div>
            </div>

            {/* ROW 2: Pulse Surveys widget (shown only when org has active surveys) */}
            {hasPulseSurveys && (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Pulse Surveys</h3>
                  <a href={isAdmin ? '/admin/surveys' : '/surveys'} style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>
                    {isAdmin ? 'Manage →' : 'View all →'}
                  </a>
                </div>

                {/* Contributor / Manager view: pending count */}
                {!isAdmin && (
                  pendingSurveyCount > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fefce8', border: '1px solid #fde68a', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                      <span style={{ fontSize: '0.875rem', color: '#92400e' }}>
                        📋 <strong>{pendingSurveyCount}</strong> survey{pendingSurveyCount !== 1 ? 's' : ''} awaiting your response
                      </span>
                      <a href="/surveys" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem', backgroundColor: '#92400e', color: 'white', borderRadius: '4px', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        Complete →
                      </a>
                    </div>
                  ) : (
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', padding: '0.75rem 1rem' }}>
                      <span style={{ fontSize: '0.875rem', color: '#166534' }}>✓ All surveys complete — thank you for your feedback!</span>
                    </div>
                  )
                )}

                {/* Admin view: best/worst team from last closed period */}
                {isAdmin && (
                  pulseAdminStats ? (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>Last period: <strong>{pulseAdminStats.periodLabel}</strong> · {pulseAdminStats.responseCount} responses</span>
                      {pulseAdminStats.bestTeam && (
                        <span style={{ fontSize: '0.8125rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #86efac' }}>
                          🏆 Best: {pulseAdminStats.bestTeam}
                        </span>
                      )}
                      {pulseAdminStats.worstTeam && (
                        <span style={{ fontSize: '0.8125rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>
                          ⚠ Attention: {pulseAdminStats.worstTeam}
                        </span>
                      )}
                      {pendingSurveyCount > 0 && (
                        <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>+ {pendingSurveyCount} open survey{pendingSurveyCount !== 1 ? 's' : ''} active</span>
                      )}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>
                      No closed periods yet. <a href="/admin/surveys" style={{ color: '#2563eb' }}>Open a period</a> to start collecting responses.
                    </p>
                  )
                )}
              </div>
            )}

            {/* ROW 3: Projects widget */}
            {activeProjectCount > 0 && (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Projects</h3>
                  <a href="/projects" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>View all →</a>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                    <strong>{activeProjectCount}</strong> active project{activeProjectCount !== 1 ? 's' : ''} in progress
                  </span>
                  {overdueProjectCount > 0 && (
                    <span style={{ fontSize: '0.8125rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5', fontWeight: 500 }}>
                      ⚠ {overdueProjectCount} overdue
                    </span>
                  )}
                  {overdueProjectCount === 0 && (
                    <span style={{ fontSize: '0.8125rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #86efac' }}>
                      ✓ None overdue
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ROW 4: KPI Snapshot (full width) */}
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>KPI Snapshot</h3>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: '#f3f4f6', color: '#374151' }}>
                    {snapshotKpis.length}
                  </span>
                </div>
                <a href="/kpis" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>View all →</a>
              </div>

              {snapshotKpis.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>No KPIs assigned to your organisation yet</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.75rem' }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {snapshotKpis.map((kpi: any) => {
                    const records  = recordsByKpi[kpi.id as string] ?? []
                    const current  = records[0]?.value ?? null
                    const prev     = records[1]?.value ?? null
                    const target   = kpi.target_value as number | null
                    const unit     = kpi.unit as string | null

                    let trendIcon  = '→'
                    let trendColor = '#9ca3af'
                    if (current != null && prev != null) {
                      if (current > prev)      { trendIcon = '↑'; trendColor = '#166534' }
                      else if (current < prev) { trendIcon = '↓'; trendColor = '#dc2626' }
                    }

                    const onTarget = target != null && current != null && current >= target

                    return (
                      <a
                        key={kpi.id as string}
                        href={`/kpis/${kpi.id as string}`}
                        style={{
                          display: 'block',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          padding: '0.75rem',
                          textDecoration: 'none',
                        }}
                      >
                        <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {kpi.name as string}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                            {current != null ? current.toLocaleString() : '—'}
                          </span>
                          {unit && current != null && (
                            <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>{unit}</span>
                          )}
                          {current != null && (
                            <span style={{ fontSize: '0.9rem', color: trendColor, marginLeft: 'auto', fontWeight: 600 }}>{trendIcon}</span>
                          )}
                        </div>
                        {target != null && current != null && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '0.1rem 0.35rem',
                            borderRadius: '9999px',
                            backgroundColor: onTarget ? '#f0fdf4' : '#fef2f2',
                            color: onTarget ? '#166534' : '#991b1b',
                          }}>
                            {onTarget ? '✓ on target' : '✗ below target'}
                          </span>
                        )}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Quick Access ──────────────────────────────────────────────────── */}
        {!isPlatformAdmin && (
          <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick Access
          </h2>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
                textDecoration: 'none',
                transition: 'border-color 0.15s',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{item.label}</p>
              <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem', lineHeight: 1.5 }}>{item.description}</p>
            </a>
          ))}
        </div>

        {navItems.length === 1 && (
          <p style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.875rem' }}>
            More modules are coming soon.
          </p>
        )}
      </main>
    </div>
  )
}
