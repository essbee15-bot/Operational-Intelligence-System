import { createAdminClient } from '@/utils/supabase/admin'
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

export default async function PlatformMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org_id?: string; type?: string }>
}) {
  const { org_id: orgFilter, type: typeFilter } = await searchParams

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

  // Load all organisations for the filter dropdown
  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, name')
    .order('name')

  // Load all meetings (optionally filtered by org)
  let query = adminClient
    .from('meetings')
    .select('id, meeting_type, title, purpose, date, organizer_id, attendee_id, organization_id')
    .order('date', { ascending: false })
    .limit(200)

  if (orgFilter) {
    query = query.eq('organization_id', orgFilter)
  }
  if (typeFilter) {
    query = query.eq('meeting_type', typeFilter)
  }

  const { data: meetings } = await query

  // Load all users across all orgs for name resolution
  const meetingOrgIds = [...new Set((meetings ?? []).map(m => m.organization_id).filter(Boolean))]
  const { data: allUsers } = await adminClient
    .from('users')
    .select('id, full_name, email, organization_id')
    .in('organization_id', meetingOrgIds.length > 0 ? meetingOrgIds : ['00000000-0000-0000-0000-000000000000'])

  const userMap: Record<string, string> = Object.fromEntries(
    (allUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  const orgMap: Record<string, string> = Object.fromEntries(
    (orgs ?? []).map(o => [o.id, o.name])
  )

  const tabs = [
    { key: '', label: 'All Types' },
    { key: 'one_on_one', label: '1:1s' },
    { key: 'team_meeting', label: 'Team' },
    { key: 'project_meeting', label: 'Project' },
  ]

  const buildHref = (params: { org_id?: string; type?: string }) => {
    const p = new URLSearchParams()
    if (params.org_id) p.set('org_id', params.org_id)
    if (params.type) p.set('type', params.type)
    return `/platform-admin/meetings${p.toString() ? '?' + p.toString() : ''}`
  }

  const selectedOrgName = orgFilter ? orgMap[orgFilter] : null

  return (
    <div style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Admin</a>
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>Meetings Overview</h1>
        <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
          Read-only view of all meetings across every organisation. Use this to review structure and terminology consistency.
        </p>
      </div>

      {/* Org filter */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>Filter by Organisation:</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={buildHref({ type: typeFilter })}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              textDecoration: 'none',
              backgroundColor: !orgFilter ? '#111827' : '#f3f4f6',
              color: !orgFilter ? 'white' : '#374151',
            }}
          >
            All Organisations
          </a>
          {(orgs ?? []).map(org => (
            <a
              key={org.id}
              href={buildHref({ org_id: org.id, type: typeFilter })}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                textDecoration: 'none',
                backgroundColor: orgFilter === org.id ? '#111827' : '#f3f4f6',
                color: orgFilter === org.id ? 'white' : '#374151',
              }}
            >
              {org.name}
            </a>
          ))}
        </div>
      </div>

      {/* Type tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb' }}>
        {tabs.map(tab => (
          <a
            key={tab.key}
            href={buildHref({ org_id: orgFilter, type: tab.key || undefined })}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              textDecoration: 'none',
              borderBottom: (typeFilter ?? '') === tab.key ? '2px solid #111827' : '2px solid transparent',
              color: (typeFilter ?? '') === tab.key ? '#111827' : '#6b7280',
              fontWeight: (typeFilter ?? '') === tab.key ? 600 : 400,
              marginBottom: '-1px',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Summary */}
      <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
        Showing <strong style={{ color: '#111827' }}>{(meetings ?? []).length}</strong> meeting{(meetings ?? []).length !== 1 ? 's' : ''}
        {selectedOrgName ? ` in ${selectedOrgName}` : ' across all organisations'}
        {typeFilter ? ` · ${TYPE_LABELS[typeFilter]} only` : ''}
      </div>

      {/* Meetings table */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        {(meetings ?? []).length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No meetings found with the current filters.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Organisation</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Meeting</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Organiser</th>
                <th style={{ padding: '0.75rem 1rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {(meetings ?? []).map((m, idx) => {
                const colours = TYPE_COLOURS[m.meeting_type] ?? { bg: '#f3f4f6', color: '#374151' }
                const displayTitle = m.meeting_type === 'one_on_one'
                  ? `1:1 — ${m.attendee_id ? userMap[m.attendee_id] ?? 'Unknown' : 'Unknown'}`
                  : m.purpose ?? m.title
                const lastRow = idx === (meetings ?? []).length - 1

                return (
                  <tr key={m.id} style={{ borderBottom: lastRow ? 'none' : '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#374151', fontSize: '0.8125rem' }}>
                      {orgMap[m.organization_id] ?? '—'}
                    </td>
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
                      {userMap[m.organizer_id] ?? '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <a href={`/platform-admin/meetings/${m.id}`} style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        View →
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {(meetings ?? []).length === 200 && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#9ca3af', textAlign: 'center' }}>
          Showing the 200 most recent meetings. Use the organisation filter to narrow results.
        </p>
      )}
    </div>
  )
}
