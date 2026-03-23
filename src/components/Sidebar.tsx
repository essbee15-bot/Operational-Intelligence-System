'use client'

import { usePathname } from 'next/navigation'

// ── SVG icon set ──────────────────────────────────────────────────────────────
const icons = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  meetings: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  actions: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5.5 8l1.75 1.75L10.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  kpis: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 12.5l3.5-4 3 2.5 4-6 2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  goals: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="1" fill="currentColor"/>
    </svg>
  ),
  projects: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 4.5h13v9a1 1 0 01-1 1h-11a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M1.5 4.5l2-3h9l2 3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  reporting: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="3" cy="12" r="1.75" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="13" cy="12" r="1.75" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 4.75v3.5M8 8.25l-3.3 2M8 8.25l3.3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  admin: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 1.5v1.25M8 13.25V14.5M14.5 8h-1.25M2.75 8H1.5M12.48 3.52l-.88.88M4.4 11.6l-.88.88M12.48 12.48l-.88-.88M4.4 4.4l-.88-.88" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  platform: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L2 5v6l6 3.5L14 11V5L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M8 1.5v13M2 5l6 3.5L14 5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  password: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="7" width="11" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
    </svg>
  ),
  signout: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  users: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M1 14a5 5 0 0110 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M11 3a2.5 2.5 0 010 5M13 14a5 5 0 00-2.5-4.33" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  scores: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 13V7M5.5 13V5M9 13V8M12.5 13V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
}

type NavItem = { label: string; href: string; icon: keyof typeof icons; exact?: boolean }

// ── Component ─────────────────────────────────────────────────────────────────
export default function Sidebar({
  name,
  role,
  orgName,
  isPlatformAdmin,
  isAdmin,
  hasOrg = false,
  signoutAction,
}: {
  name: string
  role: string
  orgName?: string | null
  isPlatformAdmin: boolean
  isAdmin: boolean
  hasOrg?: boolean
  signoutAction: () => Promise<void>
}) {
  const pathname = usePathname()

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  // ── Nav items ──────────────────────────────────────────────────────────────
  const mainItems: NavItem[] = []
  const adminItems: NavItem[] = []
  const platformItems: NavItem[] = []
  const bottomItems: NavItem[] = [
    { label: 'Change Password', href: '/account/change-password', icon: 'password' },
  ]

  if (isPlatformAdmin) {
    platformItems.push(
      { label: 'Organisations',    href: '/platform-admin',           icon: 'platform', exact: true },
      { label: 'All Meetings',     href: '/platform-admin/meetings',  icon: 'meetings' },
      { label: 'All Users',        href: '/platform-admin/users',     icon: 'users' },
      { label: 'KPI Catalogue',    href: '/platform-admin/kpis',      icon: 'kpis' },
      { label: 'System Options',   href: '/platform-admin/options',   icon: 'admin' },
      { label: 'Platform Team',    href: '/platform-admin/team',      icon: 'reporting' },
      { label: 'Audit Log',        href: '/platform-admin/audit',     icon: 'actions' },
    )
    // If the platform admin also belongs to an org, show regular app links too
    if (hasOrg) {
      mainItems.push(
        { label: 'Dashboard',       href: '/',          icon: 'dashboard', exact: true },
        { label: 'Meetings',        href: '/meetings',  icon: 'meetings' },
        { label: 'Actions',         href: '/actions',   icon: 'actions' },
        { label: 'KPIs',            href: '/kpis',      icon: 'kpis' },
        { label: 'Goals & OKRs',    href: '/goals',     icon: 'goals' },
        { label: 'Projects',        href: '/projects',  icon: 'projects' },
        { label: 'Reporting Lines', href: '/reporting', icon: 'reporting' },
        { label: 'My Scores',       href: '/scores',    icon: 'scores' },
      )
      if (role === 'manager' || role === 'admin') {
        mainItems.push(
          { label: 'Team Rankings',  href: '/scores/team', icon: 'scores' },
        )
      }
      if (isAdmin) {
        adminItems.push(
          { label: 'Administration',       href: '/admin',            icon: 'admin', exact: true },
          { label: 'Org Rankings',         href: '/scores/org',       icon: 'scores' },
          { label: 'Manager Effectiveness', href: '/scores/managers', icon: 'scores' },
        )
      }
    }
  } else {
    mainItems.push(
      { label: 'Dashboard',       href: '/',          icon: 'dashboard', exact: true },
      { label: 'Meetings',        href: '/meetings',  icon: 'meetings' },
      { label: 'Actions',         href: '/actions',   icon: 'actions' },
      { label: 'KPIs',            href: '/kpis',      icon: 'kpis' },
      { label: 'Goals & OKRs',    href: '/goals',     icon: 'goals' },
      { label: 'Projects',        href: '/projects',  icon: 'projects' },
      { label: 'Reporting Lines', href: '/reporting', icon: 'reporting' },
      { label: 'My Scores',       href: '/scores',    icon: 'scores' },
    )
    if (role === 'manager' || role === 'admin') {
      mainItems.push(
        { label: 'Team Rankings',  href: '/scores/team', icon: 'scores' },
      )
    }

    if (isAdmin) {
      adminItems.push(
        { label: 'Administration',       href: '/admin',            icon: 'admin', exact: true },
        { label: 'Org Rankings',         href: '/scores/org',       icon: 'scores' },
        { label: 'Manager Effectiveness', href: '/scores/managers', icon: 'scores' },
      )
    }
  }

  const renderLink = (item: NavItem) => (
    <a
      key={item.href}
      href={item.href}
      className={`sidebar-link${isActive(item.href, item.exact) ? ' active' : ''}`}
    >
      {icons[item.icon]}
      {item.label}
    </a>
  )

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L2 5v6l6 3.5L14 11V5L8 1.5z" fill="white" opacity=".9"/>
          </svg>
        </div>
        <span className="sidebar-logo-text">Leadership Hub</span>
      </div>

      {/* User */}
      <div className="sidebar-user">
        <div className="sidebar-avatar">{initials || '?'}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{name}</div>
          <div className="sidebar-user-role">
            {isPlatformAdmin ? 'Platform Admin' : (orgName ? `${role} · ${orgName}` : role)}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {platformItems.length > 0 && (
          <>
            <div className="sidebar-section-label">Platform</div>
            {platformItems.map(renderLink)}
          </>
        )}

        {mainItems.length > 0 && (
          <>
            {platformItems.length > 0 && <div className="sidebar-section-label">My Org</div>}
            {mainItems.map(renderLink)}
          </>
        )}

        {adminItems.length > 0 && (
          <>
            <div className="sidebar-divider" />
            {adminItems.map(renderLink)}
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="sidebar-bottom">
        {bottomItems.map(renderLink)}
        <form>
          <button
            formAction={signoutAction}
            className="sidebar-link"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            {icons.signout}
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
