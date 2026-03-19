import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createMeeting } from './actions'

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
  searchParams: Promise<{ type?: string; message?: string }>
}) {
  const { type: typeParam, message } = await searchParams
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
    .select('id, full_name, email, role')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .neq('id', user.id)
    .order('full_name')

  // Load previous meetings the user was involved in (for carry-forward)
  const { data: previousMeetings } = await supabase
    .from('meetings')
    .select('id, title, purpose, meeting_type, date')
    .eq('organization_id', profile.organization_id)
    .order('date', { ascending: false })
    .limit(20)

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
          <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>1:1 Meeting Details</h2>
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
              <select
                id="attendee_id" name="attendee_id" required
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">Select employee…</option>
                {(orgUsers ?? []).map(u => (
                  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="previous_meeting_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Previous meeting <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional — carries forward open actions)</span>
              </label>
              <select
                id="previous_meeting_id" name="previous_meeting_id"
                defaultValue={(previousMeetings ?? []).filter(m => m.meeting_type === 'one_on_one')[0]?.id ?? ''}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">None (new series)</option>
                {(previousMeetings ?? [])
                  .filter(m => m.meeting_type === 'one_on_one')
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {m.title} — {new Date(m.date).toLocaleDateString('en-GB')}
                    </option>
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
          <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>Performance Review Details</h2>
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
              <select
                id="attendee_id" name="attendee_id" required
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">Select employee…</option>
                {(orgUsers ?? []).map(u => (
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="previous_meeting_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Previous review <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional — carries forward open actions)</span>
              </label>
              <select
                id="previous_meeting_id" name="previous_meeting_id"
                defaultValue={(previousMeetings ?? []).filter(m => m.meeting_type === 'performance_review')[0]?.id ?? ''}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">None (first review)</option>
                {(previousMeetings ?? [])
                  .filter(m => m.meeting_type === 'performance_review')
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {m.title} — {new Date(m.date).toLocaleDateString('en-GB')}
                    </option>
                  ))}
              </select>
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

      {/* Team / Project meeting form */}
      {(activeType === 'team_meeting' || activeType === 'project_meeting') && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>
            {activeType === 'team_meeting' ? 'Team Meeting' : 'Project Meeting'} Details
          </h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input type="hidden" name="meeting_type" value={activeType} />

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
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Attendees <span style={{ color: '#9ca3af', fontWeight: 400 }}>(hold Ctrl/Cmd to select multiple)</span>
              </label>
              <select
                name="attendee_ids[]"
                multiple
                size={Math.min(8, (orgUsers ?? []).length + 1)}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                {(orgUsers ?? []).map(u => (
                  <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="previous_meeting_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Previous meeting <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional — carries forward open actions)</span>
              </label>
              <select
                id="previous_meeting_id" name="previous_meeting_id"
                defaultValue={(previousMeetings ?? []).filter(m => m.meeting_type === activeType)[0]?.id ?? ''}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">None (new series)</option>
                {(previousMeetings ?? [])
                  .filter(m => m.meeting_type === activeType)
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {m.purpose ?? m.title} — {new Date(m.date).toLocaleDateString('en-GB')}
                    </option>
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
    </div>
  )
}
