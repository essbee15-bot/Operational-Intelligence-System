import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/supabase/admin'
import { platformEditUser, platformResetPassword } from '../../actions'

export default async function PlatformEditUserPage({
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
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()

  const { data: targetUser } = await adminClient
    .from('users')
    .select('id, full_name, email, role, organization_id, organizations(name)')
    .eq('id', id)
    .single()

  if (!targetUser) redirect('/platform-admin/users?message=User not found')

  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '500px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <a href="/platform-admin/users" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← All Users</a>
      <h1 style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '1.5rem' }}>Edit User</h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 1.5rem 0' }}>
        {(targetUser.organizations as unknown as { name: string } | null)?.name ?? '—'}
      </p>

      {message && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '6px',
          marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b',
          fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input type="hidden" name="user_id" value={targetUser.id} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="full_name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Full Name</label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              defaultValue={targetUser.full_name ?? ''}
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
              defaultValue={targetUser.email}
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="role" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Role</label>
            <select
              id="role"
              name="role"
              required
              defaultValue={targetUser.role}
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
            >
              <option value="contributor">Contributor</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>
            Changes are logged to the audit trail.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button
              formAction={platformEditUser}
              style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Save Changes
            </button>
            <a
              href="/platform-admin/users"
              style={{ padding: '0.625rem 1.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              Cancel
            </a>
          </div>
        </form>
      </div>

      {/* Reset Password */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Reset Password</h2>
        <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0 0 1rem 0' }}>
          Issue a new temporary password. Share credentials with the user securely. This is logged.
        </p>
        <form style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <input type="hidden" name="user_id" value={targetUser.id} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="new_password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>New Temporary Password</label>
            <input
              id="new_password"
              name="new_password"
              type="text"
              required
              minLength={8}
              placeholder="Min. 8 characters"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <button
            formAction={platformResetPassword}
            style={{ padding: '0.625rem 1rem', backgroundColor: '#4b5563', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
          >
            Reset Password
          </button>
        </form>
      </div>
    </div>
  )
}
