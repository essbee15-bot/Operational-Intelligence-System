import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import {
  saveMeetingNotes, saveScores,
  addAction, removeAction, reviewAction,
  addAgendaItem, removeAgendaItem,
  addMilestone, updateMilestoneStatus, removeMilestone,
} from './actions'

const TYPE_LABELS: Record<string, string> = {
  one_on_one: '1:1 Meeting',
  team_meeting: 'Team Meeting',
  project_meeting: 'Project Meeting',
}

const OUTCOME_COLOURS: Record<string, { bg: string; color: string }> = {
  complete: { bg: '#f0fdf4', color: '#166534' },
  ongoing:  { bg: '#fffbeb', color: '#92400e' },
  missed:   { bg: '#fef2f2', color: '#991b1b' },
}

const MILESTONE_STATUSES = ['not_started', 'in_progress', 'complete', 'missed']
const MILESTONE_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  missed: 'Missed',
}

function DropdownNotesField({
  prefix,
  label,
  options,
  required = false,
}: {
  prefix: string
  label: string
  options: string[]
  required?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>{label}</label>
      <select
        name={`${prefix}_selected`}
        style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}
        required={required}
      >
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        name={`${prefix}_notes`}
        type="text"
        maxLength={300}
        placeholder="Additional notes (optional, max 300 chars)"
        style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.8125rem' }}
      />
    </div>
  )
}

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const { id } = await params
  const { message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, full_name, role')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const adminClient = createAdminClient()

  // Load meeting
  const { data: meeting } = await adminClient
    .from('meetings')
    .select('*')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!meeting) redirect('/meetings?message=Meeting not found')

  // Load org users for dropdowns
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .order('full_name')

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  // Load meeting attendees (team/project)
  const { data: attendees } = await adminClient
    .from('meeting_attendees')
    .select('user_id')
    .eq('meeting_id', id)

  // Load carry-forward actions (open from previous meeting)
  const carryForwardActions = meeting.previous_meeting_id ? (() => {
    // Will load below
    return [] as Record<string, unknown>[]
  })() : []

  let prevActions: Record<string, unknown>[] = []
  if (meeting.previous_meeting_id) {
    const { data } = await adminClient
      .from('action_items')
      .select('*')
      .eq('meeting_id', meeting.previous_meeting_id)
      .eq('is_closed', false)
      .order('created_at')
    prevActions = (data ?? []) as Record<string, unknown>[]
  }

  // Check which prev actions have already been reviewed at THIS meeting
  const prevActionIds = prevActions.map(a => a.id as string)
  const { data: existingReviews } = prevActionIds.length > 0
    ? await adminClient
        .from('action_reviews')
        .select('action_id')
        .eq('meeting_id', id)
        .in('action_id', prevActionIds)
    : { data: [] }

  const reviewedActionIds = new Set((existingReviews ?? []).map(r => r.action_id))
  const pendingReviews = prevActions.filter(a => !reviewedActionIds.has(a.id as string))
  const completedReviews = prevActions.filter(a => reviewedActionIds.has(a.id as string))

  // Load this meeting's agreed actions
  const { data: meetingActions } = await adminClient
    .from('action_items')
    .select('*')
    .eq('meeting_id', id)
    .order('created_at')

  // Load agenda items
  const { data: agendaItems } = await adminClient
    .from('agenda_items')
    .select('*')
    .eq('meeting_id', id)
    .order('display_order')

  // Load milestones (project meetings)
  const { data: milestones } = await adminClient
    .from('milestones')
    .select('*')
    .eq('meeting_id', id)
    .order('display_order')

  // Load 1:1 scores
  const { data: scores } = await adminClient
    .from('one_on_one_scores')
    .select('*')
    .eq('meeting_id', id)
    .single()

  // Load predefined options for this org (merge system defaults + org overrides)
  const { data: allOptions } = await adminClient
    .from('predefined_options')
    .select('*')
    .or(`organization_id.is.null,organization_id.eq.${profile.organization_id}`)
    .eq('is_active', true)
    .order('display_order')

  // Build options map by category
  // Org-specific options take precedence. Hidden system options excluded by is_active filter.
  const optionsByCategory: Record<string, string[]> = {}
  for (const opt of allOptions ?? []) {
    if (!optionsByCategory[opt.category]) optionsByCategory[opt.category] = []
    // Deduplicate by label
    if (!optionsByCategory[opt.category].includes(opt.label)) {
      optionsByCategory[opt.category].push(opt.label)
    }
  }

  const isSuccess = message === 'Notes saved' || message === 'Scores saved' ||
    message?.endsWith('added') || message?.endsWith('updated') || message?.endsWith('removed') ||
    message === 'Meeting created' || message === 'Action reviewed'

  const displayDate = new Date(meeting.date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const displayTime = new Date(meeting.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Participant display
  let participantsLine = ''
  if (meeting.meeting_type === 'one_on_one') {
    participantsLine = `${userMap[meeting.organizer_id] ?? 'Unknown'} & ${meeting.attendee_id ? userMap[meeting.attendee_id] ?? 'Unknown' : 'Unknown'}`
  } else {
    const names = (attendees ?? []).map(a => userMap[a.user_id]).filter(Boolean)
    participantsLine = [userMap[meeting.organizer_id], ...names].join(', ')
  }

  const sectionStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.25rem' }
  const h2Style = { margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 as const }
  const labelStyle = { fontSize: '0.875rem', fontWeight: 500 as const, color: '#374151' }
  const textareaStyle = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', width: '100%', resize: 'vertical' as const, fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' as const }
  const btnPrimary = { padding: '0.5rem 1.125rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }
  const btnSecondary = { padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', background: 'white', cursor: 'pointer' }
  const inputStyle = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' as const }
  const selectStyle = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white', width: '100%' }

  return (
    <div style={{ maxWidth: '820px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/meetings" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← My Meetings</a>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
            {meeting.meeting_type === 'one_on_one'
              ? `1:1 — ${meeting.attendee_id ? userMap[meeting.attendee_id] ?? 'Unknown' : 'Unknown'}`
              : meeting.purpose ?? meeting.title}
          </h1>
          <span style={{ padding: '0.125rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', backgroundColor: '#f3f4f6', color: '#374151' }}>
            {TYPE_LABELS[meeting.meeting_type]}
          </span>
        </div>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          {displayDate} at {displayTime} · {participantsLine}
        </p>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* ── 1:1 only: KPI Notes ──────────────────────────────────────── */}
      {meeting.meeting_type === 'one_on_one' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>KPI / KRA Context</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#6b7280', fontSize: '0.8125rem' }}>
            Note any KPI or KRA context ahead of the review. Full KPI tracking is coming in a future release.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <textarea
              name="kpi_notes"
              defaultValue={meeting.kpi_notes ?? ''}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Sales target 85%, projects on track…"
              style={textareaStyle}
            />
            <button formAction={saveMeetingNotes} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save</button>
          </form>
        </div>
      )}

      {/* ── Agenda (team/project) ─────────────────────────────────────── */}
      {(meeting.meeting_type === 'team_meeting' || meeting.meeting_type === 'project_meeting') && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Agenda ({(agendaItems ?? []).length})</h2>
          {(agendaItems ?? []).length === 0 && (
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 0.75rem 0' }}>No agenda items yet.</p>
          )}
          {(agendaItems ?? []).map((item, i) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: '0.875rem', color: '#374151' }}>{i + 1}. {item.content}</span>
              <form style={{ display: 'inline' }}>
                <input type="hidden" name="meeting_id" value={id} />
                <input type="hidden" name="item_id" value={item.id} />
                <button formAction={removeAgendaItem} style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Remove
                </button>
              </form>
            </div>
          ))}
          <form style={{ display: 'flex', gap: '0.75rem', marginTop: '0.875rem', alignItems: 'flex-end' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <div style={{ flex: 1 }}>
              <input
                name="content" type="text" maxLength={300} required
                placeholder="Add agenda item…"
                style={inputStyle}
              />
            </div>
            <button formAction={addAgendaItem} style={{ ...btnPrimary, whiteSpace: 'nowrap' }}>Add Item</button>
          </form>
        </div>
      )}

      {/* ── Actions from last month (carry-forward) ───────────────────── */}
      {meeting.previous_meeting_id && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>
            Actions from Last Meeting
            {completedReviews.length > 0 && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>
                ({completedReviews.length} reviewed, {pendingReviews.length} pending)
              </span>
            )}
          </h2>

          {prevActions.length === 0 && (
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No open actions carried forward from the previous meeting.</p>
          )}

          {/* Already reviewed */}
          {completedReviews.map(action => (
            <div key={action.id as string} style={{ padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '6px', marginBottom: '0.5rem', opacity: 0.7 }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}>
                ✓ <strong>{action.action_text as string ?? action.title as string}</strong>
                <span style={{ marginLeft: '0.5rem', color: '#9ca3af', fontWeight: 400 }}>— reviewed</span>
              </p>
            </div>
          ))}

          {/* Pending review */}
          {pendingReviews.map((action) => (
            <div key={action.id as string} style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem', marginBottom: '0.875rem' }}>
              <p style={{ margin: '0 0 0.75rem 0', fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>
                {action.action_text as string ?? action.title as string}
              </p>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                Owner: {action.assignee_id ? userMap[action.assignee_id as string] ?? 'Unknown' : 'Unassigned'}
                {(action.due_date as string | null) && ` · Due: ${new Date(action.due_date as string).toLocaleDateString('en-GB')}`}
              </p>
              <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input type="hidden" name="meeting_id" value={id} />
                <input type="hidden" name="action_id" value={action.id as string} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={labelStyle}>Outcome <span style={{ color: '#dc2626' }}>*</span></label>
                  <select name="outcome" required style={selectStyle}>
                    <option value="">Select outcome…</option>
                    <option value="complete">✓ Complete</option>
                    <option value="ongoing">→ Ongoing</option>
                    <option value="missed">✗ Missed</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <DropdownNotesField prefix="went_well" label="What went well" options={optionsByCategory['went_well'] ?? []} />
                  <DropdownNotesField prefix="went_badly" label="What went badly" options={optionsByCategory['went_badly'] ?? []} />
                  <DropdownNotesField prefix="learned" label="What was learned" options={optionsByCategory['learned'] ?? []} />
                </div>

                <button formAction={reviewAction} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>
                  Save Review
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {/* ── 1:1 only: Scoring ─────────────────────────────────────────── */}
      {meeting.meeting_type === 'one_on_one' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Score Last Month</h2>
          <p style={{ margin: '0 0 0.875rem 0', color: '#6b7280', fontSize: '0.8125rem' }}>
            1–3 = needs support &nbsp;·&nbsp; 4–6 = owning role &nbsp;·&nbsp; 7–9 = exceeding expectations
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              {[
                { name: 'self_score', label: 'Self Score', value: scores?.self_score },
                { name: 'manager_score', label: 'Manager Score', value: scores?.manager_score },
                { name: 'adjusted_score', label: 'Adjusted (agreed)', value: scores?.adjusted_score },
              ].map(s => (
                <div key={s.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={labelStyle}>{s.label}</label>
                  <select name={s.name} defaultValue={s.value?.toString() ?? ''} style={selectStyle}>
                    <option value="">—</option>
                    {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button formAction={saveScores} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save Scores</button>
          </form>
        </div>
      )}

      {/* ── Discussion notes ─────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Discussion Notes</h2>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input type="hidden" name="meeting_id" value={id} />
          <textarea
            name="general_notes"
            defaultValue={meeting.general_notes ?? ''}
            maxLength={2000}
            rows={5}
            placeholder="Record key discussion points… (max 2000 characters)"
            style={textareaStyle}
          />
          <button formAction={saveMeetingNotes} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save Notes</button>
        </form>
      </div>

      {/* ── 1:1 only: Development ────────────────────────────────────── */}
      {meeting.meeting_type === 'one_on_one' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Development</h2>
          <p style={{ margin: '0 0 0.875rem 0', color: '#6b7280', fontSize: '0.8125rem' }}>Carry any ongoing items from the last meeting.</p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle}>Required / Wanted</label>
              <textarea name="development_requests" defaultValue={meeting.development_requests ?? ''} maxLength={2000} rows={3} style={textareaStyle} placeholder="Skills, training or support needed…" />
            </div>
            <button formAction={saveMeetingNotes} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save Development</button>
          </form>
        </div>
      )}

      {/* ── 1:1 only: Projects & Experiments ────────────────────────── */}
      {meeting.meeting_type === 'one_on_one' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Projects &amp; Experiments</h2>
          <p style={{ margin: '0 0 0.875rem 0', color: '#6b7280', fontSize: '0.8125rem' }}>Carry any ongoing items from the last meeting.</p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle}>Involved in / Planned</label>
              <textarea name="project_involvement_notes" defaultValue={meeting.project_involvement_notes ?? ''} maxLength={2000} rows={3} style={textareaStyle} placeholder="Projects the employee is involved in or planned…" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle}>Tests &amp; Experiments</label>
              <textarea name="tests_experiments_notes" defaultValue={meeting.tests_experiments_notes ?? ''} maxLength={2000} rows={3} style={textareaStyle} placeholder="Any experiments or tests being conducted…" />
            </div>
            <button formAction={saveMeetingNotes} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save</button>
          </form>
        </div>
      )}

      {/* ── Milestones (project meetings) ────────────────────────────── */}
      {meeting.meeting_type === 'project_meeting' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>Milestones ({(milestones ?? []).length})</h2>

          {(milestones ?? []).map(m => {
            const statusColours: Record<string, { bg: string; color: string }> = {
              not_started: { bg: '#f3f4f6', color: '#374151' },
              in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
              complete:    { bg: '#f0fdf4', color: '#166534' },
              missed:      { bg: '#fef2f2', color: '#991b1b' },
            }
            const sc = statusColours[m.status] ?? statusColours.not_started
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500, color: '#111827' }}>{m.milestone_text}</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                    {m.owner_id ? `Owner: ${userMap[m.owner_id] ?? 'Unknown'}` : 'No owner'}
                    {m.expected_date && ` · Due: ${new Date(m.expected_date).toLocaleDateString('en-GB')}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', backgroundColor: sc.bg, color: sc.color }}>
                    {MILESTONE_LABELS[m.status]}
                  </span>
                  <form style={{ display: 'inline' }}>
                    <input type="hidden" name="meeting_id" value={id} />
                    <input type="hidden" name="milestone_id" value={m.id} />
                    <select name="status" defaultValue={m.status}
                      style={{ padding: '0.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.75rem', backgroundColor: 'white' }}
                    >
                      {MILESTONE_STATUSES.map(s => <option key={s} value={s}>{MILESTONE_LABELS[s]}</option>)}
                    </select>
                    <button formAction={updateMilestoneStatus}
                      style={{ marginLeft: '0.25rem', padding: '0.25rem 0.5rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.75rem' }}
                    >
                      Update
                    </button>
                  </form>
                  <form style={{ display: 'inline' }}>
                    <input type="hidden" name="meeting_id" value={id} />
                    <input type="hidden" name="milestone_id" value={m.id} />
                    <button formAction={removeMilestone}
                      style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            )
          })}

          {/* Add milestone */}
          <form style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', marginTop: '1rem', alignItems: 'flex-end' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Milestone</label>
              <input name="milestone_text" type="text" required maxLength={300} placeholder="e.g. Design complete" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Owner</label>
              <select name="owner_id" style={selectStyle}>
                <option value="">None</option>
                {(orgUsers ?? []).map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500 }}>Expected date</label>
              <input name="expected_date" type="date" style={inputStyle} />
            </div>
            <button formAction={addMilestone} style={{ ...btnPrimary, whiteSpace: 'nowrap' }}>Add Milestone</button>
          </form>
        </div>
      )}

      {/* ── This month's agreed actions ───────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>This Month&apos;s Agreed Actions ({(meetingActions ?? []).length})</h2>

        {(meetingActions ?? []).map(action => {
          const rb = action.risk_blockers ? JSON.parse(action.risk_blockers as string) as { selected?: string; notes?: string } : null
          const rs = action.risk_support ? JSON.parse(action.risk_support as string) as { selected?: string; notes?: string } : null
          const rm = action.risk_mitigation ? JSON.parse(action.risk_mitigation as string) as { selected?: string; notes?: string } : null
          return (
            <div key={action.id as string} style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '0.875rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>
                    {action.action_text as string ?? action.title as string}
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                    Owner: {action.assignee_id ? userMap[action.assignee_id as string] ?? 'Unassigned' : 'Unassigned'}
                    {(action.due_date as string | null) && ` · Due: ${new Date(action.due_date as string).toLocaleDateString('en-GB')}`}
                    {' '}&nbsp;
                    <span style={{ padding: '0.125rem 0.375rem', borderRadius: '9999px', fontSize: '0.7rem', backgroundColor: action.is_closed ? '#f0fdf4' : '#f3f4f6', color: action.is_closed ? '#166534' : '#374151' }}>
                      {action.is_closed ? 'Closed' : 'Open'}
                    </span>
                  </p>
                  {(rb || rs || rm) && (
                    <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                      {rb && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Blocker:</strong> {rb.selected}{rb.notes ? ` — ${rb.notes}` : ''}</div>}
                      {rs && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Support:</strong> {rs.selected}{rs.notes ? ` — ${rs.notes}` : ''}</div>}
                      {rm && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Mitigation:</strong> {rm.selected}{rm.notes ? ` — ${rm.notes}` : ''}</div>}
                    </div>
                  )}
                </div>
                <form style={{ marginLeft: '1rem' }}>
                  <input type="hidden" name="meeting_id" value={id} />
                  <input type="hidden" name="action_id" value={action.id as string} />
                  <button formAction={removeAction} style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Remove
                  </button>
                </form>
              </div>
            </div>
          )
        })}

        {/* Add action form */}
        <details style={{ marginTop: '0.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.875rem', color: '#2563eb', userSelect: 'none', padding: '0.5rem 0' }}>
            + Add Action
          </summary>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '0.875rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
            <input type="hidden" name="meeting_id" value={id} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.875rem' }}>
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={labelStyle}>Action <span style={{ color: '#dc2626' }}>*</span></label>
                <input name="action_text" type="text" required maxLength={300} placeholder="What needs to be done… (max 300 chars)" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={labelStyle}>Owner</label>
                <select name="owner_id" style={selectStyle}>
                  <option value="">Unassigned</option>
                  {(orgUsers ?? []).map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={labelStyle}>Due date</label>
                <input name="due_date" type="date" style={inputStyle} />
              </div>
            </div>

            <p style={{ margin: '0.25rem 0 0.25rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>Risk &amp; Mitigation</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.875rem' }}>
              <DropdownNotesField prefix="risk_blockers" label="What might stop you" options={optionsByCategory['risk_blockers'] ?? []} />
              <DropdownNotesField prefix="risk_support" label="What would help" options={optionsByCategory['risk_support'] ?? []} />
              <DropdownNotesField prefix="risk_mitigation" label="How to mitigate" options={optionsByCategory['risk_mitigation'] ?? []} />
            </div>

            <button formAction={addAction} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Add Action</button>
          </form>
        </details>
      </div>

      {/* ── 1:1 only: AOB ─────────────────────────────────────────────── */}
      {meeting.meeting_type === 'one_on_one' && (
        <div style={sectionStyle}>
          <h2 style={h2Style}>AOB Notes</h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="meeting_id" value={id} />
            <textarea
              name="aob_notes"
              defaultValue={meeting.aob_notes ?? ''}
              maxLength={2000}
              rows={3}
              placeholder="Any other business…"
              style={textareaStyle}
            />
            <button formAction={saveMeetingNotes} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Save</button>
          </form>
        </div>
      )}
    </div>
  )
}
