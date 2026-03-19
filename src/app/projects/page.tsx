import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

const STATUS_LABELS: Record<string, string> = {
  planning:   'Planning',
  active:     'Active',
  on_hold:    'On Hold',
  completed:  'Completed',
  failed:     'Failed',
  cancelled:  'Cancelled',
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  planning:  { bg: '#eff6ff', color: '#1d4ed8' },
  active:    { bg: '#f0fdf4', color: '#166534' },
  on_hold:   { bg: '#fefce8', color: '#92400e' },
  completed: { bg: '#f0fdf4', color: '#166534' },
  failed:    { bg: '#fef2f2', color: '#991b1b' },
  cancelled: { bg: '#f9fafb', color: '#6b7280' },
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6b7280', medium: '#2563eb', high: '#d97706', critical: '#dc2626',
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string }>
}) {
  const { status: statusFilter, message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string
  const role  = profile.role as string
  const isAdmin   = role === 'admin'
  const isManager = isAdmin || role === 'manager'

  // ── Build visibility-filtered project list ────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let projects: any[] = []

  if (isAdmin) {
    // Admin sees all projects in the org
    const { data } = await adminClient
      .from('projects')
      .select('id, name, description, status, priority, capacity_impact, start_date, end_date, owner_id, team_id, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
    projects = data ?? []

  } else if (isManager) {
    // Manager sees projects they own + projects in teams they lead
    const { data: ledTeams } = await adminClient
      .from('teams')
      .select('id')
      .eq('organization_id', orgId)
      .eq('lead_id', user.id)

    const ledTeamIds = (ledTeams ?? []).map(t => t.id as string)

    const { data: owned } = await adminClient
      .from('projects')
      .select('id, name, description, status, priority, capacity_impact, start_date, end_date, owner_id, team_id, created_at')
      .eq('organization_id', orgId)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let teamProjects: any[] = []
    if (ledTeamIds.length > 0) {
      const { data: tp } = await adminClient
        .from('projects')
        .select('id, name, description, status, priority, capacity_impact, start_date, end_date, owner_id, team_id, created_at')
        .eq('organization_id', orgId)
        .in('team_id', ledTeamIds)
        .order('created_at', { ascending: false })
      teamProjects = tp ?? []
    }

    // Merge, deduplicate
    const seen = new Set<string>()
    const all = [...(owned ?? []), ...teamProjects]
    projects = all.filter(p => {
      if (seen.has(p.id as string)) return false
      seen.add(p.id as string)
      return true
    })

  } else {
    // Contributor: projects they own OR have action items on
    const { data: ownedRaw } = await adminClient
      .from('projects')
      .select('id, name, description, status, priority, capacity_impact, start_date, end_date, owner_id, team_id, created_at')
      .eq('organization_id', orgId)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    const { data: actionsRaw } = await adminClient
      .from('action_items')
      .select('project_id')
      .eq('organization_id', orgId)
      .eq('assignee_id', user.id)
      .not('project_id', 'is', null)

    const projectIdsFromActions = [...new Set(
      (actionsRaw ?? []).map(a => a.project_id as string)
    )]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let actionProjects: any[] = []
    if (projectIdsFromActions.length > 0) {
      const { data: ap } = await adminClient
        .from('projects')
        .select('id, name, description, status, priority, capacity_impact, start_date, end_date, owner_id, team_id, created_at')
        .eq('organization_id', orgId)
        .in('id', projectIdsFromActions)
        .order('created_at', { ascending: false })
      actionProjects = ap ?? []
    }

    const seen = new Set<string>()
    const all = [...(ownedRaw ?? []), ...actionProjects]
    projects = all.filter(p => {
      if (seen.has(p.id as string)) return false
      seen.add(p.id as string)
      return true
    })
  }

  // ── Load owners + teams for display ──────────────────────────────────────
  const ownerIds = [...new Set(projects.map(p => p.owner_id as string).filter(Boolean))]
  const teamIds  = [...new Set(projects.map(p => p.team_id as string).filter(Boolean))]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ownerMap: Record<string, any> = {}
  let teamNameMap: Record<string, string> = {}

  if (ownerIds.length > 0) {
    const { data: owners } = await adminClient
      .from('users')
      .select('id, full_name, email')
      .in('id', ownerIds)
    ;(owners ?? []).forEach(o => { ownerMap[o.id as string] = o })
  }

  if (teamIds.length > 0) {
    const { data: teams } = await adminClient
      .from('teams')
      .select('id, name')
      .in('id', teamIds)
    ;(teams ?? []).forEach(t => { teamNameMap[t.id as string] = t.name as string })
  }

  // ── Status filter ─────────────────────────────────────────────────────────
  const filtered = statusFilter && statusFilter !== 'all'
    ? projects.filter(p => (p.status as string) === statusFilter)
    : projects

  // Counts per status for tab badges
  const countByStatus: Record<string, number> = {}
  projects.forEach(p => {
    const s = p.status as string
    countByStatus[s] = (countByStatus[s] ?? 0) + 1
  })

  const tabs = ['all', 'planning', 'active', 'on_hold', 'completed', 'failed', 'cancelled']

  const isSuccess = message?.toLowerCase().includes('created') || message?.toLowerCase().includes('saved')

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Projects</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Track active projects, outcomes, and capacity impact.
          </p>
        </div>
        {isManager && (
          <a
            href="/projects/new"
            style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}
          >
            + New Project
          </a>
        )}
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem', backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`, color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {tabs.map(tab => {
          const isActive = (statusFilter ?? 'all') === tab
          const count = tab === 'all' ? projects.length : (countByStatus[tab] ?? 0)
          if (tab !== 'all' && count === 0) return null
          return (
            <a
              key={tab}
              href={tab === 'all' ? '/projects' : `/projects?status=${tab}`}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.8125rem',
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                backgroundColor: isActive ? '#111827' : '#f3f4f6',
                color: isActive ? 'white' : '#374151',
              }}
            >
              {tab === 'all' ? 'All' : STATUS_LABELS[tab]} {count > 0 && <span style={{ opacity: 0.75 }}>({count})</span>}
            </a>
          )
        })}
      </div>

      {/* Project list */}
      {filtered.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500 }}>
            {projects.length === 0 ? 'No projects yet' : 'No projects with this status'}
          </p>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
            {projects.length === 0 && isManager
              ? 'Create your first project to start tracking outcomes and capacity.'
              : projects.length === 0
              ? 'Projects you are involved in will appear here.'
              : 'Try a different status filter above.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {filtered.map((project: any) => {
            const status   = project.status as string
            const priority = project.priority as string
            const sc       = STATUS_COLORS[status] ?? { bg: '#f9fafb', color: '#6b7280' }
            const owner    = ownerMap[project.owner_id as string]
            const teamName = project.team_id ? (teamNameMap[project.team_id as string] ?? null) : null
            const isOverdue = project.end_date && new Date(project.end_date as string) < new Date() && status !== 'completed' && status !== 'cancelled' && status !== 'failed'

            return (
              <a
                key={project.id as string}
                href={`/projects/${project.id as string}`}
                style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                      <span style={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
                        {project.name as string}
                      </span>
                      <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: sc.bg, color: sc.color, fontWeight: 500 }}>
                        {STATUS_LABELS[status] ?? status}
                      </span>
                      {priority && priority !== 'medium' && (
                        <span style={{ fontSize: '0.75rem', color: PRIORITY_COLORS[priority] ?? '#6b7280', fontWeight: 500 }}>
                          {PRIORITY_LABELS[priority] ?? priority}
                        </span>
                      )}
                      {isOverdue && (
                        <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>⚠ Overdue</span>
                      )}
                    </div>

                    {project.description && (
                      <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>
                        {project.description as string}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.875rem', fontSize: '0.8125rem', color: '#9ca3af', flexWrap: 'wrap' }}>
                      {owner && (
                        <span>Owner: {(owner.full_name as string | null) ?? (owner.email as string)}</span>
                      )}
                      {teamName && <span>· {teamName}</span>}
                      {project.capacity_impact != null && (
                        <span>· {project.capacity_impact as number}h capacity</span>
                      )}
                      {project.end_date && (
                        <span>· Due {new Date(project.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      )}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.15rem' }}>→</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
