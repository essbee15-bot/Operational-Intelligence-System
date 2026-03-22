import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

const TYPE_LABELS: Record<string, string> = {
  one_on_one:         '1:1',
  team_meeting:       'Team',
  project_meeting:    'Project',
  performance_review: 'Review',
}

const TYPE_COLOURS: Record<string, { bg: string; color: string }> = {
  one_on_one:         { bg: '#eff6ff', color: '#1d4ed8' },
  team_meeting:       { bg: '#f0fdf4', color: '#166534' },
  project_meeting:    { bg: '#faf5ff', color: '#6b21a8' },
  performance_review: { bg: '#fdf4ff', color: '#7e22ce' },
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
    { key: 'performance_review', label: 'Reviews' },
  ]

  return (
    <PageShell>
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Meetings</h1>
          <p className="page-subtitle">Meetings you organise or attend.</p>
        </div>
        <a href="/meetings/new" className="btn btn-primary">+ New Meeting</a>
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
      <div className="tab-nav">
        {tabs.map(tab => (
          <a
            key={tab.key}
            href={tab.key ? `/meetings?type=${tab.key}` : '/meetings'}
            className={`tab-item${(typeFilter ?? '') === tab.key ? ' active' : ''}`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Meetings list */}
      <div className="card">
        {meetings.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ color: '#374151', fontSize: '0.875rem', margin: '0 0 0.375rem 0', fontWeight: 500 }}>
              {typeFilter ? `No ${TYPE_LABELS[typeFilter] ?? typeFilter} meetings yet` : 'No meetings yet'}
            </p>
            <p style={{ color: '#9ca3af', fontSize: '0.8125rem', margin: 0 }}>
              <a href="/meetings/new" style={{ color: '#0ea5e9', textDecoration: 'none', fontWeight: 500 }}>Schedule a new meeting →</a>
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
                  : m.meeting_type === 'performance_review'
                  ? `Review — ${m.attendee_id ? userMap[m.attendee_id] ?? 'Unknown' : 'Unknown'}`
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
                      {(m.meeting_type === 'one_on_one' || m.meeting_type === 'performance_review')
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
    </PageShell>
  )
}
