import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/supabase/admin'
import { platformRemoveUser } from '../../actions'

export default async function PlatformRemoveUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  if (id === user.id) redirect('/platform-admin/users?message=You cannot remove your own account')

  const adminClient = createAdminClient()

  const { data: targetUser } = await adminClient
    .from('users')
    .select('id, full_name, email, role, organizations(name)')
    .eq('id', id)
    .single()

  if (!targetUser) redirect('/platform-admin/users?message=User not found')

  return (
    <div style={{ maxWidth: '440px', margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <a href="/platform-admin/users" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← All Users</a>
      <h1 style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '1.5rem' }}>Remove User</h1>
      <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
        The account will be disabled and personal details anonymised. Activity data is retained.
      </p>

      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem' }}>
        <p style={{ margin: '0 0 0.25rem 0', fontWeight: 600, color: '#111827' }}>{targetUser.full_name}</p>
        <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.875rem', color: '#6b7280' }}>{targetUser.email}</p>
        <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
          Role: {targetUser.role}
        </p>
        <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
          Organisation: {(targetUser.organizations as unknown as { name: string } | null)?.name ?? '—'}
        </p>

        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.875rem', color: '#991b1b' }}>
          Their account will be disabled and their name/email replaced with anonymous values. Meetings, projects and action items they were part of will be kept and attributed to &apos;Leaver&apos;. This action is logged and cannot be undone.
        </div>
        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#166534' }}>
          Their manager relationships will be cleared. Anyone reporting to them will need to be reassigned.
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <form>
            <input type="hidden" name="user_id" value={targetUser.id} />
            <button
              formAction={platformRemoveUser}
              style={{ padding: '0.625rem 1.25rem', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Yes, Anonymise &amp; Remove
            </button>
          </form>
          <a
            href="/platform-admin/users"
            style={{ padding: '0.625rem 1.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            Cancel
          </a>
        </div>
      </div>
    </div>
  )
}
