import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createProject } from './actions'

export default async function NewProjectPage({
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
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/')

  const role = profile.role as string
  if (role !== 'admin' && role !== 'manager') {
    redirect('/projects?message=Only admins and managers can create projects.')
  }

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string

  // Load users + teams for assignment dropdowns
  const [{ data: orgUsers }, { data: teams }] = await Promise.all([
    adminClient
      .from('users')
      .select('id, full_name, email, role')
      .eq('organization_id', orgId)
      .order('full_name'),
    adminClient
      .from('teams')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('name'),
  ])

  const isError = message && !message.toLowerCase().includes('created') && !message.toLowerCase().includes('saved')

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/projects" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Projects</a>
      </div>
      <h1 style={{ margin: '0 0 1.5rem 0', fontSize: '1.5rem' }}>New Project</h1>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem', backgroundColor: isError ? '#fef2f2' : '#f0fdf4', border: `1px solid ${isError ? '#fca5a5' : '#86efac'}`, color: isError ? '#991b1b' : '#166534', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      <form action={createProject}>
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
              Project Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              autoFocus
              maxLength={200}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              placeholder="e.g. CRM Migration, Q2 Marketing Campaign"
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
              Description
            </label>
            <textarea
              name="description"
              rows={3}
              maxLength={1000}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
              placeholder="What is this project trying to achieve?"
            />
          </div>

          {/* Owner + Team row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                Owner
              </label>
              <select
                name="owner_id"
                defaultValue={user.id}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              >
                {(orgUsers ?? []).map(u => (
                  <option key={u.id as string} value={u.id as string}>
                    {(u.full_name as string | null) ?? (u.email as string)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                Team (optional)
              </label>
              <select
                name="team_id"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              >
                <option value="">— No team —</option>
                {(teams ?? []).map(t => (
                  <option key={t.id as string} value={t.id as string}>
                    {t.name as string}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Priority + Capacity row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                Priority
              </label>
              <select
                name="priority"
                defaultValue="medium"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                Capacity Impact (hours)
              </label>
              <input
                type="number"
                name="capacity_impact"
                min="0"
                max="10000"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                placeholder="e.g. 40"
              />
            </div>
          </div>

          {/* Start + End date row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                Start Date
              </label>
              <input
                type="date"
                name="start_date"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
                End Date
              </label>
              <input
                type="date"
                name="end_date"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

        </div>

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <a
            href="/projects"
            style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', textDecoration: 'none', color: '#374151' }}
          >
            Cancel
          </a>
          <button
            type="submit"
            style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            Create Project
          </button>
        </div>
      </form>
    </div>
  )
}
