import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/supabase/admin'

export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; role?: string; message?: string }>
}) {
  const { org: orgFilter, role: roleFilter, message } = await searchParams
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
    .from('users')
    .select('id, full_name, email, role, organization_id, is_anonymised, organizations(name)')
    .eq('is_platform_admin', false)
    .eq('is_anonymised', false)
    .order('full_name')

  if (orgFilter) query = query.eq('organization_id', orgFilter)
  if (roleFilter) query = query.eq('role', roleFilter as 'admin' | 'manager' | 'contributor')

  const { data: users } = await query

  const roles = ['admin', 'manager', 'contributor']
  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Administration</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>All Users</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        {users?.length ?? 0} user{users?.length !== 1 ? 's' : ''} across all organisations
      </p>

      {message && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '6px',
          marginBottom: '1.5rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b',
          fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Filters */}
      <form method="GET" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>Organisation</label>
          <select
            name="org"
            defaultValue={orgFilter ?? ''}
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white', minWidth: '200px' }}
          >
            <option value="">All Organisations</option>
            {(orgs ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>Role</label>
          <select
            name="role"
            defaultValue={roleFilter ?? ''}
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
          <button
            type="submit"
            style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Filter
          </button>
          {(orgFilter || roleFilter) && (
            <a
              href="/platform-admin/users"
              style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none' }}
            >
              Clear
            </a>
          )}
        </div>
      </form>

      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        {!users || users.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No users found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Organisation</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Role</th>
                <th style={{ padding: '0.5rem 0' }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.625rem 0', color: '#111827' }}>{u.full_name}</td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>{u.email}</td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>
                    {(u.organizations as unknown as { name: string } | null)?.name ?? '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0' }}>
                    <span style={{
                      padding: '0.125rem 0.5rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      backgroundColor: u.role === 'admin' ? '#fef3c7' : u.role === 'manager' ? '#dbeafe' : '#f3f4f6',
                      color: u.role === 'admin' ? '#92400e' : u.role === 'manager' ? '#1e40af' : '#374151',
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0', textAlign: 'right' }}>
                    {u.id !== user.id && (
                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <a
                          href={`/platform-admin/users/${u.id}/edit`}
                          style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}
                        >
                          Edit
                        </a>
                        <a
                          href={`/platform-admin/users/${u.id}/remove`}
                          style={{ fontSize: '0.8rem', color: '#dc2626', textDecoration: 'none' }}
                        >
                          Remove
                        </a>
                      </div>
                    )}
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
