import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createMeeting } from './actions'
import { AttendeesPicker } from '@/components/AttendeesPicker'
import { ProjectSelector } from '@/components/ProjectSelector'

function toUser(val: unknown): { id: string; full_name: string | null; email: string } | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null
  const u = val as Record<string, unknown>
  if (typeof u.id !== 'string') return null
  return {
    id: u.id,
    full_name: typeof u.full_name === 'string' ? u.full_name : null,
    email: typeof u.email === 'string' ? u.email : '',
  }
}

const MEETING_TYPES = [
  {
    key: 'one_on_one',
    label: '1:1 Meeting',
    description: 'A structured one-to-one between a manager and employee, with scoring, actions and development tracking.',
  },
  {
    key: 'team_meeting',
    label: 'Team Meeting',
    description: 'A general team meeting with agenda, discussion notes and agreed actions.',
  },
  {
    key: 'project_meeting',
    label: 'Project Meeting',
    description: 'A project-focused meeting with milestones, actions and progress tracking.',
  },
  {
    key: 'performance_review',
    label: 'Performance Review',
    description: 'Formal periodic review — strengths, development areas, goals for next period, and overall rating.',
  },
]

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; message?: string; project_id?: string }>
}) {
  const { type: typeParam, message, project_id: projectIdParam } = await searchParams
  const activeType = MEETING_TYPES.find(t => t.key === typeParam)?.key ?? null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Load org users (for attendee selection)
  const { data: orgUsers } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .neq('id', user.id)
    .order('full_name')

  // Direct reports — for 1:1 and performance review selectors
  const { data: directReports } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('manager_id', user.id)
    .eq('is_anonymised', false)
    .order('full_name')

  // Fall back to all org users if manager has no direct reports
  const oneOnOnePool = (directReports && directReports.length > 0)
    ? directReports
    : (orgUsers ?? [])
  const showingAllForOneOnOne = !directReports || directReports.length === 0

  // Team meeting defaults: carry-forward from previous or first-booking smart defaults
  const { data: prevTeamMeeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('meeting_type', 'team_meeting')
    .eq('organizer_id', user.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  let teamDefaults: { id: string; full_name: string | null; email: string }[] = []

  if (prevTeamMeeting) {
    // Carry forward previous attendees
    const { data: prevAttendees } = await supabase
      .from('meeting_attendees')
      .select('users(id, full_name, email)')
      .eq('meeting_id', prevTeamMeeting.id)
    teamDefaults = (prevAttendees ?? [])
      .map(row => toUser(row.users))
      .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
  } else {
    // First booking: direct reports + team members the user belongs to
    const { data: myTeamMemberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)

    const teamIds = (myTeamMemberships ?? []).map(m => m.team_id)

    let teamMates: { id: string; full_name: string | null; email: string }[] = []
    if (teamIds.length > 0) {
      const { data: members } = await supabase
        .from('team_members')
        .select('users(id, full_name, email)')
        .in('team_id', teamIds)
        .neq('user_id', user.id)
      teamMates = (members ?? [])
        .map(row => toUser(row.users))
        .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
    }

    // Merge direct reports + team mates, deduplicate by id
    const seen = new Set<string>()
    teamDefaults = [...(directReports ?? []), ...teamMates].filter(u => {
      if (seen.has(u.id)) return false
      seen.add(u.id)
      return true
    })
  }

  // Org projects for project meeting selector
  const orgProjects = activeType === 'project_meeting'
    ? (await supabase
        .from('projects')
        .select('id, name, team_id')
        .eq('organization_id', profile.organization_id)
        .order('name')
      ).data
    : null

  const UUID_RE_PAGE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validProjectId = projectIdParam && UUID_RE_PAGE.test(projectIdParam)
    ? projectIdParam
    : undefined

  // Project meeting defaults
  let projectDefaults: { id: string; full_name: string | null; email: string }[] = []

  if (activeType === 'project_meeting' && validProjectId) {
    // Check for previous project meeting for this project (carry-forward)
    const { data: prevProjectMeeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('meeting_type', 'project_meeting')
      .eq('project_id', validProjectId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (prevProjectMeeting) {
      const { data: prevAttendees } = await supabase
        .from('meeting_attendees')
        .select('users(id, full_name, email)')
        .eq('meeting_id', prevProjectMeeting.id)
      projectDefaults = (prevAttendees ?? [])
        .map(row => toUser(row.users))
        .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
    } else {
      // First booking: load project team members
      const project = (orgProjects ?? []).find(p => p.id === projectIdParam)
      if (project?.team_id) {
        const { data: members } = await supabase
          .from('team_members')
          .select('users(id, full_name, email)')
          .eq('team_id', project.team_id)
          .neq('user_id', user.id)
        projectDefaults = (members ?? [])
          .map(row => toUser(row.users))
          .filter((u): u is { id: string; full_name: string | null; email: string } => u !== null)
      }
    }
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/meetings" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← My Meetings</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>New Meeting</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Choose a meeting type to get started.
      </p>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Type selector */}
      {!activeType && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {MEETING_TYPES.map(t => (
            <a
              key={t.key}
              href={`/meetings/new?type=${t.key}`}
              style={{
                display: 'block',
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
                textDecoration: 'none',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{t.label}</p>
              <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem', lineHeight: 1.5 }}>{t.description}</p>
            </a>
          ))}
        </div>
      )}

      {/* 1:1 form */}
      {activeType === 'one_on_one' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>1:1 Meeting Details</h2>
          <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
            Open actions from your last 1:1 with this person will carry forward automatically.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="hidden" name="meeting_type" value="one_on_one" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="date" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Date</label>
                <input
                  id="date" name="date" type="date" required
                  defaultValue={today}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="time" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Time</label>
                <input
                  id="time" name="time" type="time" defaultValue="09:00"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="attendee_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Employee</label>
              {showingAllForOneOnOne && (
                <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.8125rem', color: '#9ca3af' }}>
                  No direct reports found — showing all staff.
                </p>
              )}
              <select
                id="attendee_id" name="attendee_id" required
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">Select employee…</option>
                {oneOnOnePool.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                formAction={createMeeting}
                style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Create Meeting
              </button>
              <a
                href="/meetings/new"
                style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                ← Change type
              </a>
            </div>
          </form>
        </div>
      )}

      {/* Performance Review form */}
      {activeType === 'performance_review' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>Performance Review Details</h2>
          <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
            Open actions from the previous review for this person will carry forward automatically.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="hidden" name="meeting_type" value="performance_review" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="date" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Date</label>
                <input
                  id="date" name="date" type="date" required
                  defaultValue={today}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="time" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Time</label>
                <input
                  id="time" name="time" type="time" defaultValue="09:00"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="attendee_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Employee being reviewed</label>
              {showingAllForOneOnOne && (
                <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.8125rem', color: '#9ca3af' }}>
                  No direct reports found — showing all staff.
                </p>
              )}
              <select
                id="attendee_id" name="attendee_id" required
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">Select employee…</option>
                {oneOnOnePool.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="review_period" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Review period <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="review_period" name="review_period" type="text" maxLength={100}
                placeholder="e.g. Q1 2026, Annual 2025"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                formAction={createMeeting}
                style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Create Review
              </button>
              <a
                href="/meetings/new"
                style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                ← Change type
              </a>
            </div>
          </form>
        </div>
      )}

      {/* Team meeting form */}
      {activeType === 'team_meeting' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>Team Meeting Details</h2>
          <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
            Any open actions from your previous team meeting with the same attendees will carry forward automatically.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="hidden" name="meeting_type" value="team_meeting" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="date" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Date</label>
                <input
                  id="date" name="date" type="date" required
                  defaultValue={today}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="time" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Time</label>
                <input
                  id="time" name="time" type="time" defaultValue="09:00"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="purpose" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Purpose / Title</label>
              <input
                id="purpose" name="purpose" type="text" required maxLength={300}
                placeholder="e.g. Q1 Project Review"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Attendees</label>
              {prevTeamMeeting && (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280' }}>
                  Pre-filled from your last team meeting — adjust as needed.
                </p>
              )}
              <AttendeesPicker defaultAttendees={teamDefaults} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                formAction={createMeeting}
                style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Create Meeting
              </button>
              <a
                href="/meetings/new"
                style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                ← Change type
              </a>
            </div>
          </form>
        </div>
      )}

      {/* Project meeting form */}
      {activeType === 'project_meeting' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>Project Meeting Details</h2>
          <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
            Select a project — attendees will pre-fill from your last meeting for that project.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="hidden" name="meeting_type" value="project_meeting" />
            {projectIdParam && <input type="hidden" name="project_id" value={projectIdParam} />}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="project_selector" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Project</label>
              <ProjectSelector projects={orgProjects ?? []} currentProjectId={projectIdParam} />
            </div>

            {projectIdParam && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label htmlFor="date" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Date</label>
                    <input id="date" name="date" type="date" required defaultValue={today}
                      style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label htmlFor="time" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Time</label>
                    <input id="time" name="time" type="time" defaultValue="09:00"
                      style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label htmlFor="purpose" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Purpose / Title</label>
                  <input id="purpose" name="purpose" type="text" required maxLength={300}
                    placeholder="e.g. Sprint Review"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Attendees</label>
                  <AttendeesPicker defaultAttendees={projectDefaults} />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <button formAction={createMeeting}
                    style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    Create Meeting
                  </button>
                  <a href="/meetings/new"
                    style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    ← Change type
                  </a>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
