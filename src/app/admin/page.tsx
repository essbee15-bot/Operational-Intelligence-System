import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'

const adminSections = [
  {
    group: 'People & Teams',
    items: [
      { label: 'User Management',   href: '/admin/users',   description: 'Add, edit, manage users and set reporting lines.',                   icon: '👥', accent: '#eff6ff', accentText: '#1d4ed8' },
      { label: 'Teams',             href: '/admin/teams',   description: 'Create teams, assign members and appoint team leads.',               icon: '🏢', accent: '#f0fdf4', accentText: '#166534' },
      { label: 'Reporting Lines',   href: '/reporting',     description: 'View and manage the full org hierarchy.',                            icon: '🌿', accent: '#ecfeff', accentText: '#0e7490' },
    ],
  },
  {
    group: 'Performance & Data',
    items: [
      { label: 'KPI Management',    href: '/admin/kpis',    description: 'Assign KPIs, set targets and control visibility.',                   icon: '📊', accent: '#fffbeb', accentText: '#92400e' },
      { label: 'Custom Fields',     href: '/admin/fields',  description: 'Define extra fields for meetings, projects, KPIs and users.',        icon: '🔧', accent: '#f5f3ff', accentText: '#6d28d9' },
      { label: 'Dropdown Options',  href: '/admin/options', description: 'Manage predefined options used in meeting and review forms.',         icon: '📋', accent: '#fff1f2', accentText: '#be123c' },
    ],
  },
  {
    group: 'Engagement',
    items: [
      { label: 'Pulse Surveys',     href: '/admin/surveys', description: 'Create surveys, open periods and view aggregated team results.',      icon: '📡', accent: '#f0fdf4', accentText: '#166534' },
      { label: 'AI Assistant',      href: '/admin/ai',      description: 'Connect your API key and configure the organisational AI co-pilot.', icon: '✨', accent: '#faf5ff', accentText: '#7c3aed' },
    ],
  },
  {
    group: 'Account',
    items: [
      { label: 'Billing',           href: '/billing',       description: 'Manage your subscription plan and payment details.',                 icon: '💳', accent: '#f8fafc', accentText: '#475569' },
      { label: 'Audit Log',         href: '/admin/audit',   description: 'Full record of all user and admin changes in your organisation.',    icon: '📜', accent: '#f8fafc', accentText: '#475569' },
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

  return (
    <PageShell>
      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Administration</h1>
            <p className="page-subtitle">Manage your organisation&apos;s settings, people and data.</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {adminSections.map(section => (
            <div key={section.group}>
              <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {section.group}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
                {section.items.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="card admin-card"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.875rem',
                      padding: '1rem 1.125rem',
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{
                      width: '2.25rem',
                      height: '2.25rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: item.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.1rem',
                      flexShrink: 0,
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem' }}>{item.label}</p>
                      <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{item.description}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
