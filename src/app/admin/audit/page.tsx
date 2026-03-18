import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/supabase/admin'

const ACTION_LABELS: Record<string, string> = {
  user_created: 'User created',
  user_updated: 'User updated',
  user_anonymised: 'User removed',
  password_reset: 'Password reset',
  org_created: 'Organisation created',
  platform_admin_created: 'Platform admin added',
}

function formatDetails(action: string, details: Record<string, unknown>): string {
  if (action === 'user_created') return `Role: ${details.role}`
  if (action === 'user_updated') {
    const o = details.old as Record<string, string> | undefined
    const n = details.new as Record<string, string> | undefined
    const changes: string[] = []
    if (o && n) {
      if (o.role !== n.role) changes.push(`Role: ${o.role} → ${n.role}`)
      if (o.email !== n.email) changes.push(`Email changed`)
      if (o.full_name !== n.full_name) changes.push(`Name changed`)
    }
    return changes.length ? changes.join(', ') : 'Details updated'
  }
  if (action === 'password_reset') return 'Temporary password issued'
  if (action === 'user_anonymised') return 'Personal data wiped, activity retained'
  return ''
}

export default async function OrgAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>
}) {
  const { action: actionFilter } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()

  let query = adminClient
    .from('audit_logs')
    .select('id, action, target_name, performed_by, details, created_at')
    .eq('organization_id', adminProfile.organization_id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (actionFilter) query = query.eq('action', actionFilter)

  const { data: logs } = await query

  // Resolve performer names
  const performerIds = [...new Set((logs ?? []).map(l => l.performed_by))]
  const { data: performers } = await adminClient
    .from('users')
    .select('id, full_name, email')
    .in('id', performerIds)
  const nameMap: Record<string, string> = Object.fromEntries(
    (performers ?? []).map(p => [p.id, p.full_name ?? p.email ?? 'Unknown'])
  )

  const actionTypes = Object.keys(ACTION_LABELS)

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/admin/users" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← User Management</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>Audit Log</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        A record of all user management changes in your organisation.
      </p>

      {/* Filter */}
      <form method="GET" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>Action</label>
          <select
            name="action"
            defaultValue={actionFilter ?? ''}
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white', minWidth: '180px' }}
          >
            <option value="">All Actions</option>
            {actionTypes.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>
        <button type="submit" style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
          Filter
        </button>
        {actionFilter && (
          <a href="/admin/audit" style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none' }}>
            Clear
          </a>
        )}
      </form>

      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        {!logs || logs.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No audit log entries found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151', width: '160px' }}>Date &amp; Time</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Target</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Performed By</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280', fontSize: '0.8rem' }}>
                    {new Date(log.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td style={{ padding: '0.625rem 0' }}>
                    <span style={{
                      padding: '0.125rem 0.5rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      backgroundColor: log.action === 'user_anonymised' ? '#fef2f2' : log.action === 'user_created' ? '#f0fdf4' : '#f3f4f6',
                      color: log.action === 'user_anonymised' ? '#991b1b' : log.action === 'user_created' ? '#166534' : '#374151',
                    }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0', color: '#111827' }}>{log.target_name ?? '—'}</td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>{nameMap[log.performed_by] ?? '—'}</td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280', fontSize: '0.8rem' }}>
                    {formatDetails(log.action, (log.details as Record<string, unknown>) ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
