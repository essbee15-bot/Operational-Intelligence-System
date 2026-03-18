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
      if (o.email !== n.email) changes.push('Email changed')
      if (o.full_name !== n.full_name) changes.push('Name changed')
    }
    return changes.length ? changes.join(', ') : 'Details updated'
  }
  if (action === 'password_reset') return `Reset by ${details.reset_by ?? 'admin'}`
  if (action === 'user_anonymised') return `By ${details.removed_by ?? 'admin'}`
  if (action === 'org_created') return `Admin: ${details.admin_email ?? ''}`
  if (action === 'platform_admin_created') return `${details.email ?? ''}`
  return ''
}

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; action?: string }>
}) {
  const { org: orgFilter, action: actionFilter } = await searchParams
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

  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, name')
    .order('name')

  let query = adminClient
    .from('audit_logs')
    .select('id, action, target_name, performed_by, organization_id, details, created_at, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (orgFilter) query = query.eq('organization_id', orgFilter)
  if (actionFilter) query = query.eq('action', actionFilter)

  const { data: logs } = await query

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
    <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Administration</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>Platform Audit Log</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        All user management and administrative changes across every organisation.
      </p>

      {/* Filters */}
      <form method="GET" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>Organisation</label>
          <select
            name="org"
            defaultValue={orgFilter ?? ''}
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white', minWidth: '200px' }}
          >
            <option value="">All Organisations</option>
            <option value="__platform__">Platform level</option>
            {(orgs ?? []).map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
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
        {(orgFilter || actionFilter) && (
          <a href="/platform-admin/audit" style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none' }}>
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
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151', width: '140px' }}>Date &amp; Time</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Target</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Organisation</th>
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
                      backgroundColor: log.action === 'user_anonymised' ? '#fef2f2' : log.action === 'user_created' || log.action === 'org_created' ? '#f0fdf4' : '#f3f4f6',
                      color: log.action === 'user_anonymised' ? '#991b1b' : log.action === 'user_created' || log.action === 'org_created' ? '#166534' : '#374151',
                    }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0', color: '#111827' }}>{log.target_name ?? '—'}</td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>
                    {(log.organizations as unknown as { name: string } | null)?.name ?? <span style={{ color: '#9ca3af' }}>Platform</span>}
                  </td>
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
