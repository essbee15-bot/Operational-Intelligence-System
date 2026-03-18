import { createAdminClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

const TYPE_LABELS: Record<string, string> = {
  one_on_one:      '1:1 Meeting',
  team_meeting:    'Team Meeting',
  project_meeting: 'Project Meeting',
}

const TYPE_COLOURS: Record<string, { bg: string; color: string }> = {
  one_on_one:      { bg: '#eff6ff', color: '#1d4ed8' },
  team_meeting:    { bg: '#f0fdf4', color: '#166534' },
  project_meeting: { bg: '#faf5ff', color: '#6b21a8' },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
      <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>{title}</h2>
      {children}
    </div>
  )
}

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: '#374151', whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function JsonbField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  let parsed: { selected?: string | null; notes?: string | null } = {}
  try { parsed = JSON.parse(value as string) } catch { return null }
  if (!parsed.selected && !parsed.notes) return null
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      {parsed.selected && <div style={{ fontSize: '0.875rem', color: '#374151' }}>{parsed.selected}</div>}
      {parsed.notes && <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.125rem' }}>{parsed.notes}</div>}
    </div>
  )
}

export default async function PlatformMeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: meetingId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()

  // Load meeting
  const { data: meeting } = await adminClient
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .single()

  if (!meeting) redirect('/platform-admin/meetings?message=Meeting not found')

  // Load org name
  const { data: org } = await adminClient
    .from('organizations')
    .select('name')
    .eq('id', meeting.organization_id)
    .single()

  // Load all users in that org for name resolution
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', meeting.organization_id)

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  // Load attendees (for team/project)
  const { data: attendeeRows } = await adminClient
    .from('meeting_attendees')
    .select('user_id')
    .eq('meeting_id', meetingId)

  // Load agenda items (team/project)
  const { data: agendaItems } = await adminClient
    .from('agenda_items')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('display_order')

  // Load action items
  const { data: actions } = await adminClient
    .from('action_items')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at')

  // Load action reviews for these actions
  const actionIds = (actions ?? []).map(a => a.id as string)
  const { data: reviews } = actionIds.length > 0
    ? await adminClient.from('action_reviews').select('*').in('action_id', actionIds).order('created_at')
    : { data: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviewsByAction = (reviews ?? []).reduce<Record<string, any[]>>((acc, r) => {
    if (!r) return acc
    const aid = r.action_id as string
    if (!acc[aid]) acc[aid] = []
    acc[aid]!.push(r)
    return acc
  }, {})

  // Load 1:1 scores
  const { data: scores } = meeting.meeting_type === 'one_on_one'
    ? await adminClient.from('one_on_one_scores').select('*').eq('meeting_id', meetingId).single()
    : { data: null }

  // Load milestones (project)
  const { data: milestones } = meeting.meeting_type === 'project_meeting'
    ? await adminClient.from('milestones').select('*').eq('meeting_id', meetingId).order('display_order')
    : { data: [] }

  // Also load carry-forward actions from previous meeting
  const { data: prevActions } = meeting.previous_meeting_id
    ? await adminClient
        .from('action_items')
        .select('*')
        .eq('meeting_id', meeting.previous_meeting_id as string)
        .order('created_at')
    : { data: [] }

  const colours = TYPE_COLOURS[meeting.meeting_type] ?? { bg: '#f3f4f6', color: '#374151' }

  const attendeeNames = (attendeeRows ?? []).map(a => userMap[a.user_id] ?? 'Unknown').join(', ')

  const OUTCOME_LABELS: Record<string, string> = { complete: 'Completed', ongoing: 'Ongoing', missed: 'Missed' }

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin/meetings" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Meetings Overview</a>
      </div>

      {/* Header */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ padding: '0.25rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', backgroundColor: colours.bg, color: colours.color, fontWeight: 500 }}>
                {TYPE_LABELS[meeting.meeting_type]}
              </span>
              <span style={{ fontSize: '0.8125rem', color: '#6b7280', fontWeight: 600 }}>
                {org?.name ?? 'Unknown Organisation'}
              </span>
            </div>
            <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.375rem', color: '#111827' }}>
              {meeting.meeting_type === 'one_on_one'
                ? `1:1 — ${meeting.attendee_id ? userMap[meeting.attendee_id as string] ?? 'Unknown' : 'Unknown'}`
                : (meeting.purpose ?? meeting.title)}
            </h1>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
              {new Date(meeting.date as string).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#6b7280', textAlign: 'right' }}>
            <div>Organiser: {userMap[meeting.organizer_id as string] ?? '—'}</div>
            {meeting.meeting_type === 'one_on_one' && meeting.attendee_id && (
              <div>Employee: {userMap[meeting.attendee_id as string] ?? '—'}</div>
            )}
            {attendeeNames && <div>Attendees: {attendeeNames}</div>}
          </div>
        </div>
        <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '4px', fontSize: '0.8125rem', color: '#92400e' }}>
          Read-only view — platform administrators cannot edit meeting content.
        </div>
      </div>

      {/* 1:1 Scoring */}
      {meeting.meeting_type === 'one_on_one' && scores && (
        <Section title="Performance Scores (1–9)">
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1d4ed8' }}>{(scores as { self_score?: number | null }).self_score ?? '—'}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>Self Score</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#059669' }}>{(scores as { manager_score?: number | null }).manager_score ?? '—'}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>Manager Score</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7c3aed' }}>{(scores as { adjusted_score?: number | null }).adjusted_score ?? '—'}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>Adjusted Score</div>
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>1–3 = needs support · 4–6 = owns role · 7–9 = exceeds expectations</div>
        </Section>
      )}

      {/* KPI Notes (1:1 only) */}
      {meeting.meeting_type === 'one_on_one' && meeting.kpi_notes && (
        <Section title="KPI / KRA Context">
          <ReadonlyField label="" value={meeting.kpi_notes as string} />
        </Section>
      )}

      {/* Agenda items (team/project) */}
      {meeting.meeting_type !== 'one_on_one' && (agendaItems ?? []).length > 0 && (
        <Section title="Agenda">
          <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {(agendaItems ?? []).map(item => (
              <li key={item.id as string} style={{ fontSize: '0.875rem', color: '#374151' }}>{item.content as string}</li>
            ))}
          </ol>
        </Section>
      )}

      {/* Carry-forward actions from previous meeting */}
      {(prevActions ?? []).length > 0 && (
        <Section title="Actions Carried Forward from Previous Meeting">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(prevActions ?? []).map(action => {
              const actionReviews = reviewsByAction[action.id as string] ?? []
              const latestReview = actionReviews[actionReviews.length - 1]
              return (
                <div key={action.id as string} style={{
                  padding: '0.75rem',
                  border: '1px solid #e5e7eb',
                  borderLeft: `4px solid ${action.is_closed ? '#86efac' : '#fca5a5'}`,
                  borderRadius: '4px',
                  backgroundColor: '#f9fafb',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111827', marginBottom: '0.25rem' }}>
                    {action.action_text as string ?? action.title as string}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                    {action.assignee_id ? `Assigned to: ${userMap[action.assignee_id as string] ?? 'Unknown'}` : ''}
                    {action.due_date ? ` · Due: ${new Date(action.due_date as string).toLocaleDateString('en-GB')}` : ''}
                    {` · Status: ${action.is_closed ? 'Closed' : 'Open'}`}
                  </div>
                  {latestReview && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.375rem' }}>
                        Review: {OUTCOME_LABELS[latestReview.outcome as string] ?? latestReview.outcome}
                      </div>
                      <JsonbField label="What went well" value={latestReview.went_well as string | null} />
                      <JsonbField label="What went badly" value={latestReview.went_badly as string | null} />
                      <JsonbField label="What was learned" value={latestReview.learned as string | null} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Discussion / General Notes */}
      {(meeting.general_notes || meeting.outcomes) && (
        <Section title="Discussion &amp; Notes">
          <ReadonlyField label="General Notes" value={meeting.general_notes as string | null} />
          <ReadonlyField label="Outcomes" value={meeting.outcomes as string | null} />
        </Section>
      )}

      {/* 1:1 specific sections */}
      {meeting.meeting_type === 'one_on_one' && (meeting.development_requests || meeting.project_involvement_notes || meeting.tests_experiments_notes) && (
        <Section title="Development &amp; Projects">
          <ReadonlyField label="Development" value={meeting.development_requests as string | null} />
          <ReadonlyField label="Project Involvement" value={meeting.project_involvement_notes as string | null} />
          <ReadonlyField label="Tests &amp; Experiments" value={meeting.tests_experiments_notes as string | null} />
        </Section>
      )}

      {meeting.meeting_type === 'one_on_one' && meeting.aob_notes && (
        <Section title="Any Other Business">
          <ReadonlyField label="" value={meeting.aob_notes as string | null} />
        </Section>
      )}

      {/* Milestones (project meeting) */}
      {meeting.meeting_type === 'project_meeting' && (milestones ?? []).length > 0 && (
        <Section title="Milestones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {(milestones ?? []).map(ms => {
              const statusColours: Record<string, { bg: string; color: string }> = {
                not_started: { bg: '#f3f4f6', color: '#374151' },
                in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
                complete:    { bg: '#f0fdf4', color: '#166534' },
                missed:      { bg: '#fef2f2', color: '#991b1b' },
              }
              const sc = statusColours[ms.status as string] ?? { bg: '#f3f4f6', color: '#374151' }
              const statusLabel: Record<string, string> = {
                not_started: 'Not Started', in_progress: 'In Progress', complete: 'Complete', missed: 'Missed',
              }
              return (
                <div key={ms.id as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '4px' }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>{ms.milestone_text as string}</div>
                    <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.125rem' }}>
                      {ms.owner_id ? `Owner: ${userMap[ms.owner_id as string] ?? 'Unknown'}` : ''}
                      {ms.expected_date ? ` · Expected: ${new Date(ms.expected_date as string).toLocaleDateString('en-GB')}` : ''}
                    </div>
                  </div>
                  <span style={{ padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', backgroundColor: sc.bg, color: sc.color }}>
                    {statusLabel[ms.status as string] ?? ms.status as string}
                  </span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* This meeting's actions */}
      {(actions ?? []).length > 0 && (
        <Section title={`Actions Agreed This Meeting (${(actions ?? []).length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(actions ?? []).map(action => (
              <div key={action.id as string} style={{
                padding: '0.75rem',
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${action.is_closed ? '#86efac' : '#e5e7eb'}`,
                borderRadius: '4px',
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111827', marginBottom: '0.25rem' }}>
                  {action.action_text as string ?? action.title as string}
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.375rem' }}>
                  {action.assignee_id ? `Assigned to: ${userMap[action.assignee_id as string] ?? 'Unknown'}` : ''}
                  {action.due_date ? ` · Due: ${new Date(action.due_date as string).toLocaleDateString('en-GB')}` : ''}
                  {` · ${action.is_closed ? 'Closed' : 'Open'}`}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <JsonbField label="Risk Blockers" value={action.risk_blockers as string | null} />
                  <JsonbField label="What Would Help" value={action.risk_support as string | null} />
                  <JsonbField label="Risk Mitigation" value={action.risk_mitigation as string | null} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(actions ?? []).length === 0 && (milestones ?? []).length === 0 && (agendaItems ?? []).length === 0 && !meeting.general_notes && !meeting.outcomes && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>No content has been recorded for this meeting yet.</p>
        </div>
      )}
    </div>
  )
}
