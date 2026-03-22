import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { updateProject, updateProjectStatus, addProjectAction, closeProjectAction } from './actions'

const STATUS_LABELS: Record<string, string> = {
  planning:  'Planning',
  active:    'Active',
  on_hold:   'On Hold',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  planning:  { bg: '#eff6ff', color: '#1d4ed8' },
  active:    { bg: '#f0fdf4', color: '#166534' },
  on_hold:   { bg: '#fefce8', color: '#92400e' },
  completed: { bg: '#f0fdf4', color: '#166534' },
  failed:    { bg: '#fef2f2', color: '#991b1b' },
  cancelled: { bg: '#f9fafb', color: '#6b7280' },
}

const ACTION_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:     { bg: '#eff6ff', color: '#1d4ed8' },
  in_progress: { bg: '#fefce8', color: '#92400e' },
  completed:   { bg: '#f0fdf4', color: '#166534' },
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; message?: string }>
}) {
  const { id: projectId } = await params
  const { tab: activeTab = 'overview', message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string
  const role  = profile.role as string
  const isManager = role === 'admin' || role === 'manager'

  // Load project
  const { data: project } = await adminClient
    .from('projects')
    .select('id, name, description, status, priority, capacity_impact, start_date, end_date, outcomes, owner_id, team_id, created_at, created_by')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()

  if (!project) redirect('/projects?message=Project not found.')

  // Load org users + teams for edit form
  const [{ data: orgUsers }, { data: teams }] = await Promise.all([
    adminClient.from('users').select('id, full_name, email').eq('organization_id', orgId).order('full_name'),
    adminClient.from('teams').select('id, name').eq('organization_id', orgId).order('name'),
  ])

  // Build user name map
  const userNameMap: Record<string, string> = {}
  ;(orgUsers ?? []).forEach(u => {
    userNameMap[u.id as string] = (u.full_name as string | null) ?? (u.email as string)
  })

  const teamNameMap: Record<string, string> = {}
  ;(teams ?? []).forEach(t => {
    teamNameMap[t.id as string] = t.name as string
  })

  // Load action items for this project
  const { data: actionsRaw } = await adminClient
    .from('action_items')
    .select('id, title, assignee_id, status, due_date, is_closed')
    .eq('project_id', projectId)
    .eq('organization_id', orgId)
    .order('due_date', { ascending: true, nullsFirst: false })

  const openActions   = (actionsRaw ?? []).filter(a => !a.is_closed)
  const closedActions = (actionsRaw ?? []).filter(a => !!a.is_closed)

  const status = project.status as string
  const sc     = STATUS_COLORS[status] ?? { bg: '#f9fafb', color: '#6b7280' }

  const ownerName = project.owner_id ? (userNameMap[project.owner_id as string] ?? 'Unknown') : '—'
  const teamName  = project.team_id  ? (teamNameMap[project.team_id  as string] ?? 'Unknown') : null

  const isSuccess = message != null && (
    message.toLowerCase().includes('saved') ||
    message.toLowerCase().includes('created') ||
    message.toLowerCase().includes('added') ||
    message.toLowerCase().includes('complete') ||
    message.toLowerCase().includes('updated')
  )

  const tabStyle = (t: string) => ({
    padding: '0.5rem 1rem',
    borderBottom: activeTab === t ? '2px solid #111827' : '2px solid transparent',
    fontSize: '0.875rem',
    fontWeight: activeTab === t ? 600 : 400,
    color: activeTab === t ? '#111827' : '#6b7280',
    textDecoration: 'none',
    cursor: 'pointer',
    display: 'inline-block',
  })

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Back */}
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/projects" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Projects</a>
      </div>

      {/* Title + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.3 }}>{project.name as string}</h1>
        <span style={{ fontSize: '0.8125rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: sc.bg, color: sc.color, fontWeight: 500, marginTop: '0.35rem' }}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <span>Owner: <strong>{ownerName}</strong></span>
        {teamName && <span>· Team: <strong>{teamName}</strong></span>}
        {project.capacity_impact != null && (
          <span>· Capacity: <strong>{project.capacity_impact as number}h</strong></span>
        )}
        {project.end_date && (
          <span>· Due: <strong>{new Date(project.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></span>
        )}
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem', backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`, color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1.5rem', display: 'flex', gap: '0' }}>
        <a href={`/projects/${projectId}?tab=overview`} style={tabStyle('overview')}>Overview</a>
        <a href={`/projects/${projectId}?tab=actions`} style={tabStyle('actions')}>
          Actions {openActions.length > 0 && <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: '#111827', color: 'white' }}>{openActions.length}</span>}
        </a>
      </div>

      {/* ── OVERVIEW TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* Status change (managers only) */}
          {isManager && (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Update Status</h3>
              <form action={updateProjectStatus} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="hidden" name="project_id" value={projectId} />
                <select
                  name="status"
                  defaultValue={status}
                  style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
                >
                  {Object.entries(STATUS_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', cursor: 'pointer' }}
                >
                  Update Status
                </button>
              </form>
            </div>
          )}

          {/* Edit form (managers only) */}
          {isManager ? (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Project Details</h3>
              <form action={updateProject} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <input type="hidden" name="project_id" value={projectId} />

                {/* Name */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                    Project Name <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    defaultValue={project.name as string}
                    maxLength={200}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Description */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                    Description
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    defaultValue={(project.description as string | null) ?? ''}
                    maxLength={1000}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                </div>

                {/* Owner + Team */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Owner</label>
                    <select
                      name="owner_id"
                      defaultValue={(project.owner_id as string | null) ?? ''}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    >
                      {(orgUsers ?? []).map(u => (
                        <option key={u.id as string} value={u.id as string}>
                          {(u.full_name as string | null) ?? (u.email as string)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Team</label>
                    <select
                      name="team_id"
                      defaultValue={(project.team_id as string | null) ?? ''}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    >
                      <option value="">— No team —</option>
                      {(teams ?? []).map(t => (
                        <option key={t.id as string} value={t.id as string}>{t.name as string}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Priority + Capacity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Priority</label>
                    <select
                      name="priority"
                      defaultValue={(project.priority as string | null) ?? 'medium'}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Capacity Impact (hours)</label>
                    <input
                      type="number"
                      name="capacity_impact"
                      min="0"
                      max="10000"
                      defaultValue={(project.capacity_impact as number | null) ?? ''}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Start + End date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Start Date</label>
                    <input
                      type="date"
                      name="start_date"
                      defaultValue={project.start_date ? new Date(project.start_date as string).toISOString().split('T')[0] : ''}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>End Date</label>
                    <input
                      type="date"
                      name="end_date"
                      defaultValue={project.end_date ? new Date(project.end_date as string).toISOString().split('T')[0] : ''}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Outcomes */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                    Outcomes / Learnings
                  </label>
                  <textarea
                    name="outcomes"
                    rows={4}
                    defaultValue={(project.outcomes as string | null) ?? ''}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
                    placeholder="What worked, what didn't — useful for future AI prediction and retrospectives."
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>

          ) : (
            /* Read-only view for contributors */
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {project.description && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>Description</div>
                  <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151', lineHeight: 1.6 }}>{project.description as string}</p>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {[
                  { label: 'Priority', value: (project.priority as string | null) ?? 'medium' },
                  { label: 'Capacity', value: project.capacity_impact != null ? `${project.capacity_impact as number}h` : '—' },
                  { label: 'Start', value: project.start_date ? new Date(project.start_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                  { label: 'End', value: project.end_date ? new Date(project.end_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ backgroundColor: '#f9fafb', borderRadius: '6px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.2rem' }}>{label}</div>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#111827' }}>{value}</div>
                  </div>
                ))}
              </div>
              {project.outcomes && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>Outcomes / Learnings</div>
                  <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151', lineHeight: 1.6 }}>{project.outcomes as string}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── ACTIONS TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'actions' && (
        <>
          {/* Add action form */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Add Action</h3>
            <form action={addProjectAction}>
              <input type="hidden" name="project_id" value={projectId} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                    Action <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    name="title"
                    required
                    maxLength={300}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    placeholder="What needs to happen?"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Assignee</label>
                    <select
                      name="assignee_id"
                      defaultValue={user.id}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    >
                      {(orgUsers ?? []).map(u => (
                        <option key={u.id as string} value={u.id as string}>
                          {(u.full_name as string | null) ?? (u.email as string)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Due Date</label>
                    <input
                      type="date"
                      name="due_date"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
                  >
                    Add Action
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Open actions */}
          {openActions.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Open ({openActions.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {openActions.map((action: any) => {
                  const as_ = action.status as string
                  const asc = ACTION_STATUS_COLORS[as_] ?? { bg: '#f3f4f6', color: '#374151' }
                  const assigneeName = action.assignee_id ? (userNameMap[action.assignee_id as string] ?? 'Unknown') : 'Unassigned'
                  const overdue = action.due_date && new Date(action.due_date as string) < new Date()

                  return (
                    <div
                      key={action.id as string}
                      style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.9375rem', color: '#111827', marginBottom: '0.25rem' }}>
                          {action.title as string}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8125rem', flexWrap: 'wrap' }}>
                          <span style={{ color: '#6b7280' }}>{assigneeName}</span>
                          {action.due_date && (
                            <span style={{ color: overdue ? '#dc2626' : '#9ca3af', fontWeight: overdue ? 600 : 400 }}>
                              {overdue ? '⚠ Overdue · ' : ''}Due {new Date(action.due_date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: asc.bg, color: asc.color }}>
                            {(as_ ?? '').replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      <form action={closeProjectAction}>
                        <input type="hidden" name="action_id" value={action.id as string} />
                        <input type="hidden" name="project_id" value={projectId} />
                        <button
                          type="submit"
                          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem', color: '#374151', backgroundColor: 'white', cursor: 'pointer' }}
                        >
                          ✓ Complete
                        </button>
                      </form>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Completed actions */}
          {closedActions.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Completed ({closedActions.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {closedActions.map((action: any) => {
                  const assigneeName = action.assignee_id ? (userNameMap[action.assignee_id as string] ?? 'Unknown') : 'Unassigned'
                  return (
                    <div
                      key={action.id as string}
                      style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}
                    >
                      <div>
                        <div style={{ fontSize: '0.9375rem', color: '#6b7280', textDecoration: 'line-through', marginBottom: '0.2rem' }}>
                          {action.title as string}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>{assigneeName}</div>
                      </div>
                      <span style={{ fontSize: '0.875rem', color: '#166534', fontWeight: 500 }}>✓</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {openActions.length === 0 && closedActions.length === 0 && (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>No actions yet. Add one above to start tracking work.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
