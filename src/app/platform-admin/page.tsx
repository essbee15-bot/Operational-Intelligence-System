import { createOrganisationAndAdmin } from './actions'
import { createClient } from '@/utils/supabase/server'
import { signout } from '@/app/login/actions'

export default async function PlatformAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch list of all organisations for overview
  const adminClient = (await import('@/utils/supabase/admin')).createAdminClient()
  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, name, subscription_status, created_at')
    .order('created_at', { ascending: false })

  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Platform Administration</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Signed in as {user?.email}
          </p>
        </div>
        <form>
          <button
            formAction={signout}
            style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Sign Out
          </button>
        </form>
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

      {/* Create Organisation + Admin */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.125rem' }}>Create New Organisation</h2>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="org_name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Organisation Name</label>
              <input
                id="org_name"
                name="org_name"
                type="text"
                required
                placeholder="Acme Corp"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="admin_email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Admin Email</label>
              <input
                id="admin_email"
                name="admin_email"
                type="email"
                required
                placeholder="admin@acmecorp.com"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="admin_full_name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Admin Full Name</label>
              <input
                id="admin_full_name"
                name="admin_full_name"
                type="text"
                required
                placeholder="Jane Smith"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="temp_password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Temporary Password</label>
              <input
                id="temp_password"
                name="temp_password"
                type="password"
                required
                minLength={8}
                placeholder="Min. 8 characters"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>
            The admin will be able to log in immediately and should change their password after first login.
          </p>
          <button
            formAction={createOrganisationAndAdmin}
            style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Create Organisation &amp; Admin
          </button>
        </form>
      </div>

      {/* Quick Links */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <a
          href="/platform-admin/users"
          style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>View All Users</p>
          <p style={{ margin: '0.25rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem' }}>Browse, edit and remove users across all organisations.</p>
        </a>
        <a
          href="/platform-admin/team"
          style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>Platform Team</p>
          <p style={{ margin: '0.25rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem' }}>Manage platform administrators who maintain the system.</p>
        </a>
        <a
          href="/platform-admin/audit"
          style={{ display: 'block', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', textDecoration: 'none' }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>Audit Log</p>
          <p style={{ margin: '0.25rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem' }}>Full change history across all organisations and platform actions.</p>
        </a>
      </div>

      {/* Organisations Overview */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.125rem' }}>
          All Organisations ({orgs?.length ?? 0})
        </h2>
        {!orgs || orgs.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No organisations yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.625rem 0', color: '#111827' }}>{org.name}</td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280' }}>{org.subscription_status ?? 'active'}</td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280' }}>
                    {new Date(org.created_at).toLocaleDateString('en-GB')}
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
