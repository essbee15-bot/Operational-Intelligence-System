import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createUser, removeUser } from './actions'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Verify org admin
  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/')

  // Fetch org name
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', adminProfile.organization_id)
    .single()

  // Fetch all active (non-anonymised) users in this org
  const { data: orgUsers } = await supabase
    .from('users')
    .select('id, full_name, email, role, manager_id')
    .eq('organization_id', adminProfile.organization_id)
    .eq('is_anonymised', false)
    .order('full_name')

  // Managers available to assign (managers + admins)
  const managers = (orgUsers ?? []).filter((u) => ['admin', 'manager'].includes(u.role))

  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
        <h1 style={{ margin: '0.5rem 0 0 0' }}>User Management</h1>
        <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
          {org?.name} — Create and manage users in your organisation.
        </p>
      </div>

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

      {/* Create user form */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.125rem' }}>Add New User</h2>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="full_name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Full Name</label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                required
                placeholder="Jane Smith"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="jane@company.com"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="role" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Role</label>
              <select
                id="role"
                name="role"
                required
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="contributor">Contributor</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="manager_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Reports To (optional)</label>
              <select
                id="manager_id"
                name="manager_id"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
              >
                <option value="">— None —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', gridColumn: '1 / -1' }}>
              <label htmlFor="temp_password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Temporary Password</label>
              <input
                id="temp_password"
                name="temp_password"
                type="password"
                required
                minLength={8}
                placeholder="Min. 8 characters — user should change this after first login"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
          </div>
          <button
            formAction={createUser}
            style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Create User
          </button>
        </form>
      </div>

      {/* Existing users */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.125rem' }}>
          Organisation Users ({orgUsers?.length ?? 0})
        </h2>
        {!orgUsers || orgUsers.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No users yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Manager</th>
                <th style={{ padding: '0.5rem 0' }}></th>
              </tr>
            </thead>
            <tbody>
              {orgUsers.map((u) => {
                const manager = orgUsers.find((m) => m.id === u.manager_id)
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.625rem 0', color: '#111827' }}>
                      {u.full_name}
                      {u.id === user.id && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>(you)</span>
                      )}
                    </td>
                    <td style={{ padding: '0.625rem 0', color: '#374151' }}>{u.email}</td>
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
                    <td style={{ padding: '0.625rem 0', color: '#6b7280' }}>
                      {manager ? manager.full_name : '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {u.role !== 'admin' && (
                          <a
                            href={`/admin/users/${u.id}/edit`}
                            style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}
                          >
                            Edit
                          </a>
                        )}
                        {u.id !== user.id && (
                          <a
                            href={`/admin/users/${u.id}/remove`}
                            style={{ fontSize: '0.8rem', color: '#dc2626', textDecoration: 'none' }}
                          >
                            Remove
                          </a>
                        )}
                      </div>
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
