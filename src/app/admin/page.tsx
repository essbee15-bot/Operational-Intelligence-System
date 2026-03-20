import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { signout } from '@/app/login/actions'

const adminSections = [
  {
    group: 'People & Teams',
    items: [
      { label: 'User Management',    href: '/admin/users',   description: 'Add, edit, manage users and set reporting lines.' },
      { label: 'Teams',              href: '/admin/teams',   description: 'Create teams, assign members and appoint team leads.' },
      { label: 'Reporting Lines',    href: '/reporting',     description: 'View and manage the full org hierarchy.' },
    ],
  },
  {
    group: 'Performance & Data',
    items: [
      { label: 'KPI Management',    href: '/admin/kpis',    description: 'Assign KPIs, set targets and control visibility.' },
      { label: 'Custom Fields',     href: '/admin/fields',  description: 'Define extra fields for meetings, projects, KPIs and users.' },
      { label: 'Dropdown Options',  href: '/admin/options', description: 'Manage predefined options used in meeting and review forms.' },
    ],
  },
  {
    group: 'Engagement',
    items: [
      { label: 'Pulse Surveys',     href: '/admin/surveys', description: 'Create surveys, open periods and view aggregated team results.' },
      { label: 'AI Assistant',      href: '/admin/ai',      description: 'Connect your API key and configure the organisational AI co-pilot.' },
    ],
  },
  {
    group: 'Account',
    items: [
      { label: 'Billing',           href: '/billing',            description: 'Manage your subscription plan and payment details.' },
      { label: 'Audit Log',         href: '/admin/audit',        description: 'Full record of all user and admin changes in your organisation.' },
    ],
  },
]

export default async function AdminHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_platform_admin || profile.role !== 'admin') {
    redirect('/')
  }

  const name = profile.full_name ?? user.email

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '3.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <a href="/" style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', textDecoration: 'none' }}>Leadership Hub</a>
            <span style={{ color: '#d1d5db' }}>/</span>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Administration</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{name}</span>
            <form>
              <button formAction={signout} style={{ fontSize: '0.8rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
          <h1 style={{ margin: '0.5rem 0 0.375rem 0', fontSize: '1.5rem', color: '#111827' }}>Administration</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Manage your organisation's settings, people and data.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {adminSections.map(section => (
            <div key={section.group}>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {section.group}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                {section.items.map(item => (
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
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>{item.label}</p>
                    <p style={{ margin: '0.375rem 0 0 0', color: '#6b7280', fontSize: '0.8125rem', lineHeight: 1.5 }}>{item.description}</p>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
