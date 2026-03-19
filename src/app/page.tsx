import { createClient } from '@/utils/supabase/server'
import { signout } from '@/app/login/actions'
import { redirect } from 'next/navigation'

export default async function HomePage({
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
    .select('full_name, role, is_platform_admin, organization_id')
    .eq('id', user.id)
    .single()

  const isPlatformAdmin = profile?.is_platform_admin ?? false
  const role = profile?.role ?? 'contributor'
  const name = profile?.full_name ?? user.email

  const navItems: { label: string; href: string; description: string }[] = []

  if (isPlatformAdmin) {
    navItems.push({
      label: 'Platform Administration',
      href: '/platform-admin',
      description: 'Create and manage client organisations and their admin accounts.',
    })
    navItems.push({
      label: 'Meetings Overview',
      href: '/platform-admin/meetings',
      description: 'View all meetings across every organisation for consistency oversight.',
    })
    navItems.push({
      label: 'System Options',
      href: '/platform-admin/options',
      description: 'Manage system-wide default dropdown options available to all organisations.',
    })
    navItems.push({
      label: 'KPI Catalogue',
      href: '/platform-admin/kpis',
      description: 'Manage the system KPI library and pre-load KPIs for organisations at onboarding.',
    })
    navItems.push({
      label: 'View All Users',
      href: '/platform-admin/users',
      description: 'Browse, edit and remove users across all organisations.',
    })
    navItems.push({
      label: 'Platform Team',
      href: '/platform-admin/team',
      description: 'Manage platform administrators who maintain the system.',
    })
    navItems.push({
      label: 'Audit Log',
      href: '/platform-admin/audit',
      description: 'Full change history across all organisations and platform actions.',
    })
  }

  if (role === 'admin' && !isPlatformAdmin) {
    navItems.push({
      label: 'User Management',
      href: '/admin/users',
      description: 'Add, edit and manage users in your organisation.',
    })
    navItems.push({
      label: 'Audit Log',
      href: '/admin/audit',
      description: 'View a record of all user management changes in your organisation.',
    })
    navItems.push({
      label: 'Custom Fields',
      href: '/admin/fields',
      description: 'Define extra fields to capture on meetings, projects, KPIs and users.',
    })
    navItems.push({
      label: 'Dropdown Options',
      href: '/admin/options',
      description: 'Manage the predefined options available in meeting and review dropdowns.',
    })
    navItems.push({
      label: 'KPI Management',
      href: '/admin/kpis',
      description: 'Assign KPIs to your organisation, set targets and control visibility.',
    })
    navItems.push({
      label: 'Teams',
      href: '/admin/teams',
      description: 'Create teams, assign members and scope KPIs to specific teams.',
    })
  }

  if (!isPlatformAdmin) {
    navItems.push({
      label: 'My Meetings',
      href: '/meetings',
      description: 'View, create and manage your 1:1s, team meetings and project meetings.',
    })
    navItems.push({
      label: 'My Actions',
      href: '/actions',
      description: 'Track all actions agreed in your meetings.',
    })
    navItems.push({
      label: 'My KPIs',
      href: '/kpis',
      description: 'View your organisation\'s KPIs and track performance over time.',
    })
    navItems.push({
      label: 'Goals & OKRs',
      href: '/goals',
      description: 'Track objectives and key results aligned to your organisation\'s KPIs.',
    })
  }

  navItems.push({
    label: 'Change Password',
    href: '/account/change-password',
    description: 'Update your login password.',
  })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '3.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '1rem', color: '#111827' }}>Leadership Hub</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{name}</span>
            <form>
              <button
                formAction={signout}
                style={{ fontSize: '0.8rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1.5rem' }}>
        {message && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1.5rem',
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            fontSize: '0.875rem',
          }}>
            {message}
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#111827' }}>Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
          <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
            {isPlatformAdmin ? 'Platform Administrator' : `${role.charAt(0).toUpperCase() + role.slice(1)}`}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
                textDecoration: 'none',
                transition: 'border-color 0.15s',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{item.label}</p>
              <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem', lineHeight: 1.5 }}>{item.description}</p>
            </a>
          ))}
        </div>

        {navItems.length === 1 && (
          <p style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.875rem' }}>
            More modules are coming soon.
          </p>
        )}
      </main>
    </div>
  )
}
