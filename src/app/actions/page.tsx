import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export default async function MyActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; message?: string }>
}) {
  const { filter, message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const adminClient = createAdminClient()

  // Load all actions assigned to this user
  let query = adminClient
    .from('action_items')
    .select('*, meetings(id, meeting_type, title, purpose, date)')
    .eq('organization_id', profile.organization_id)
    .eq('assignee_id', user.id)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (filter === 'open') {
    query = query.eq('is_closed', false)
  } else if (filter === 'closed') {
    query = query.eq('is_closed', true)
  }

  const { data: actions } = await query

  // Load org users for display
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  const isSuccess = message?.includes('success') || message === 'Action reviewed'

  const openCount = (actions ?? []).filter(a => !a.is_closed).length
  const closedCount = (actions ?? []).filter(a => a.is_closed).length

  const tabs = [
    { key: '', label: `All (${(actions ?? []).length})` },
    { key: 'open', label: `Open (${openCount})` },
    { key: 'closed', label: `Closed (${closedCount})` },
  ]

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>My Actions</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        All actions assigned to you across your meetings.
      </p>

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
            href={tab.key ? `/actions?filter=${tab.key}` : '/actions'}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              textDecoration: 'none',
              borderBottom: (filter ?? '') === tab.key ? '2px solid #111827' : '2px solid transparent',
              color: (filter ?? '') === tab.key ? '#111827' : '#6b7280',
              fontWeight: (filter ?? '') === tab.key ? 600 : 400,
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Actions list */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        {(actions ?? []).length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No actions found.</p>
          </div>
        ) : (
          <div>
            {(actions ?? []).map((action, idx) => {
              const rb = action.risk_blockers ? JSON.parse(action.risk_blockers as string) as { selected?: string; notes?: string } : null
              const rs = action.risk_support ? JSON.parse(action.risk_support as string) as { selected?: string; notes?: string } : null
              const rm = action.risk_mitigation ? JSON.parse(action.risk_mitigation as string) as { selected?: string; notes?: string } : null
              const meeting = action.meetings as { id: string; meeting_type: string; title: string; purpose: string | null; date: string } | null

              const isOverdue = !action.is_closed && action.due_date && new Date(action.due_date as string) < new Date()

              return (
                <div
                  key={action.id as string}
                  style={{
                    padding: '1rem 1.25rem',
                    borderBottom: idx < (actions ?? []).length - 1 ? '1px solid #f3f4f6' : 'none',
                    borderLeft: action.is_closed ? '4px solid #86efac' : isOverdue ? '4px solid #fca5a5' : '4px solid #e5e7eb',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: action.is_closed ? '#6b7280' : '#111827', textDecoration: action.is_closed ? 'line-through' : 'none' }}>
                        {action.action_text as string ?? action.title as string}
                      </p>
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {action.due_date && (
                          <span style={{ fontSize: '0.8rem', color: isOverdue ? '#dc2626' : '#6b7280' }}>
                            {isOverdue ? '⚠ Overdue: ' : 'Due: '}
                            {new Date(action.due_date as string).toLocaleDateString('en-GB')}
                          </span>
                        )}
                        {meeting && (
                          <a href={`/meetings/${meeting.id}`} style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}>
                            From: {meeting.meeting_type === 'one_on_one' ? meeting.title : meeting.purpose ?? meeting.title}
                          </a>
                        )}
                        <span style={{
                          padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem',
                          backgroundColor: action.is_closed ? '#f0fdf4' : '#f3f4f6',
                          color: action.is_closed ? '#166534' : '#374151',
                        }}>
                          {action.is_closed ? 'Closed' : 'Open'}
                        </span>
                      </div>

                      {(rb || rs || rm) && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                          {rb?.selected && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Blocker:</strong> {rb.selected}{rb.notes ? ` — ${rb.notes}` : ''}</span>}
                          {rs?.selected && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Support:</strong> {rs.selected}{rs.notes ? ` — ${rs.notes}` : ''}</span>}
                          {rm?.selected && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}><strong>Mitigation:</strong> {rm.selected}{rm.notes ? ` — ${rm.notes}` : ''}</span>}
                        </div>
                      )}
                    </div>

                    {meeting && !action.is_closed && (
                      <a
                        href={`/meetings/${meeting.id}`}
                        style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        Review →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
