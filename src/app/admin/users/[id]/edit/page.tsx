import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { updateUser, resetUserPassword, confirmUserEmail } from '../../actions'

export default async function EditUserPage({
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

  // Verify org admin
  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/')

  // Load the target user (must be in same org)
  const { data: targetUser } = await supabase
    .from('users')
    .select('id, full_name, email, role, manager_id')
    .eq('id', id)
    .eq('organization_id', adminProfile.organization_id)
    .single()

  if (!targetUser) redirect('/admin/users?message=User not found')

  // Check auth status (email confirmed?) using admin client
  const adminClient = createAdminClient()
  const { data: authData } = await adminClient.auth.admin.getUserById(id)
  const emailConfirmed = !!authData?.user?.email_confirmed_at

  // Load managers for the dropdown
  const { data: orgUsers } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('organization_id', adminProfile.organization_id)
    .in('role', ['admin', 'manager'])
    .neq('id', id) // can't report to yourself
    .order('full_name')

  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '500px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <a href="/admin/users" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← User Management</a>
      <h1 style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '1.5rem' }}>Edit User</h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 1.5rem 0' }}>
        Update {targetUser.full_name}&apos;s profile details.
      </p>

      {!emailConfirmed && (
        <div style={{
          padding: '0.875rem 1rem',
          borderRadius: '6px',
          marginBottom: '1.25rem',
          backgroundColor: '#fffbeb',
          border: '1px solid #fcd34d',
          color: '#92400e',
          fontSize: '0.875rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <span>⚠️ This account&apos;s email is <strong>not confirmed</strong> — the user cannot sign in until activated.</span>
          <form style={{ flexShrink: 0 }}>
            <input type="hidden" name="user_id" value={targetUser.id} />
            <button
              formAction={confirmUserEmail}
              style={{ padding: '0.375rem 0.875rem', backgroundColor: '#d97706', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
            >
              Activate Account
            </button>
          </form>
        </div>
      )}

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="manager_id" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Reports To</label>
            <select
              id="manager_id"
              name="manager_id"
              defaultValue={targetUser.manager_id ?? ''}
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
            >
              <option value="">— None —</option>
              {(orgUsers ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button
              formAction={updateUser}
              style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Save Changes
            </button>
            <a
              href="/admin/users"
              style={{ padding: '0.625rem 1.25rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
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
          Issue a new temporary password. Share credentials with the user securely.
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
            formAction={resetUserPassword}
            style={{ padding: '0.625rem 1rem', backgroundColor: '#4b5563', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
          >
            Reset Password
          </button>
        </form>
      </div>
    </div>
  )
}
