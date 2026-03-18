import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

const TYPE_LABELS: Record<string, string> = {
  one_on_one:      '1:1',
  team_meeting:    'Team',
  project_meeting: 'Project',
}

const TYPE_COLOURS: Record<string, { bg: string; color: string }> = {
  one_on_one:      { bg: '#eff6ff', color: '#1d4ed8' },
  team_meeting:    { bg: '#f0fdf4', color: '#166534' },
  project_meeting: { bg: '#faf5ff', color: '#6b21a8' },
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; message?: string }>
}) {
  const { type: typeFilter, message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, full_name, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Platform admins have no organisation — redirect to cross-org overview
  if (profile.is_platform_admin) redirect('/platform-admin/meetings')

  // Load all org users for name resolution
  const { data: orgUsers } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  // Fetch meetings the user is involved in
  // (organizer, 1:1 attendee, or in meeting_attendees)
  let query = supabase
    .from('meetings')
    .select('id, meeting_type, title, purpose, date, organizer_id, attendee_id')
    .eq('organization_id', profile.organization_id)
    .order('date', { ascending: false })

  if (typeFilter) {
    query = query.eq('meeting_type', typeFilter)
  }

  const { data: allMeetings } = await query

  // Also load meeting_attendees to know which group meetings the user is part of
  const { data: myAttendances } = await supabase
    .from('meeting_attendees')
    .select('meeting_id')
    .eq('user_id', user.id)

  const myAttendanceMeetingIds = new Set((myAttendances ?? []).map(a => a.meeting_id))

  // Filter to meetings the user is part of
  const meetings = (allMeetings ?? []).filter(m =>
    m.organizer_id === user.id ||
    m.attendee_id === user.id ||
    myAttendanceMeetingIds.has(m.id)
  )

  const isSuccess = message?.includes('successfully') || message?.includes('created')

  const tabs = [
    { key: '', label: 'All' },
    { key: 'one_on_one', label: '1:1s' },
    { key: 'team_meeting', label: 'Team' },
    { key: 'project_meeting', label: 'Project' },
  ]

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>My Meetings</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>Meetings you organise or attend.</p>
        </div>
        <a
          href="/meetings/new"
          style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
        >
          + New Meeting
        </a>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        {tabs.map(tab => (
          <a
            key={tab.key}
            href={tab.key ? `/meetings?type=${tab.key}` : '/meetings'}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              textDecoration: 'none',
              borderBottom: (typeFilter ?? '') === tab.key ? '2px solid #111827' : '2px solid transparent',
              color: (typeFilter ?? '') === tab.key ? '#111827' : '#6b7280',
              fontWeight: (typeFilter ?? '') === tab.key ? 600 : 400,
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Meetings list */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        {meetings.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
              No meetings found.{' '}
              <a href="/meetings/new" style={{ color: '#2563eb', textDecoration: 'none' }}>Create your first meeting →</a>
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Meeting</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Participants</th>
                <th style={{ padding: '0.75rem 1rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {meetings.map(m => {
                const colours = TYPE_COLOURS[m.meeting_type] ?? { bg: '#f3f4f6', color: '#374151' }
                const displayTitle = m.meeting_type === 'one_on_one'
                  ? `1:1 — ${m.attendee_id ? userMap[m.attendee_id] ?? 'Unknown' : 'Unknown'}`
                  : m.purpose ?? m.title
                const organiserName = userMap[m.organizer_id] ?? 'Unknown'

                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#374151', whiteSpace: 'nowrap' }}>
                      {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#111827', fontWeight: 500 }}>
                      {displayTitle}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', backgroundColor: colours.bg, color: colours.color }}>
                        {TYPE_LABELS[m.meeting_type]}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontSize: '0.8125rem' }}>
                      {m.meeting_type === 'one_on_one'
                        ? `${userMap[m.organizer_id] ?? '?'} & ${m.attendee_id ? userMap[m.attendee_id] ?? '?' : '?'}`
                        : `Organised by ${organiserName}`
                      }
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <a href={`/meetings/${m.id}`} style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}>
                        Open →
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
