import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/supabase/admin'
import { createPlatformAdmin } from '../actions'

export default async function PlatformTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
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

  const { data: platformAdmins } = await adminClient
    .from('users')
    .select('id, full_name, email, created_at')
    .eq('is_platform_admin', true)
    .order('created_at')

  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '700px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Administration</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>Platform Team</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Platform admins have full access to manage all organisations and users across the system.
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

      {/* Current platform admins */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.125rem' }}>
          Current Team ({platformAdmins?.length ?? 0})
        </h2>
        {!platformAdmins || platformAdmins.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No platform admins found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Added</th>
                <th style={{ padding: '0.5rem 0' }}></th>
              </tr>
            </thead>
            <tbody>
              {platformAdmins.map((admin) => (
                <tr key={admin.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.625rem 0', color: '#111827', fontWeight: admin.id === user.id ? 600 : 400 }}>
                    {admin.full_name}
                    {admin.id === user.id && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#6b7280', fontWeight: 400 }}>(you)</span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>{admin.email}</td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280' }}>
                    {new Date(admin.created_at).toLocaleDateString('en-GB')}
                  </td>
                  <td style={{ padding: '0.625rem 0', textAlign: 'right' }}>
                    {admin.id !== user.id && (
                      <a
                        href={`/platform-admin/users/${admin.id}/remove`}
                        style={{ fontSize: '0.8rem', color: '#dc2626', textDecoration: 'none' }}
                      >
                        Remove
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add new platform admin */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.125rem' }}>Add Platform Admin</h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0 0 1.25rem 0' }}>
          They will be able to log in immediately and should change their password after first login.
        </p>

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
              <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="jane@example.com"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="temp_password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Temporary Password</label>
            <input
              id="temp_password"
              name="temp_password"
              type="text"
              required
              minLength={8}
              placeholder="Min. 8 characters"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>

          <button
            formAction={createPlatformAdmin}
            style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Add to Platform Team
          </button>
        </form>
      </div>
    </div>
  )
}
