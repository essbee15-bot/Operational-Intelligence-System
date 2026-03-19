import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin:       { bg: '#fef2f2', color: '#991b1b' },
  manager:     { bg: '#eff6ff', color: '#1d4ed8' },
  contributor: { bg: '#f3f4f6', color: '#374151' },
}

interface OrgUser {
  id: string
  full_name: string | null
  email: string
  role: string
  manager_id: string | null
}

interface TreeNode {
  user: OrgUser
  depth: number
  isLast: boolean
  parentPrefix: string
}

function buildTree(users: OrgUser[]): TreeNode[] {
  const byManager: Record<string, OrgUser[]> = {}
  const orgUserIds = new Set(users.map(u => u.id))

  for (const u of users) {
    const mid = (u.manager_id && orgUserIds.has(u.manager_id)) ? u.manager_id : '__root__'
    if (!byManager[mid]) byManager[mid] = []
    byManager[mid]!.push(u)
  }

  // Sort each group: admin first, then manager, then contributor; then alphabetical
  const roleOrder: Record<string, number> = { admin: 0, manager: 1, contributor: 2 }
  for (const key of Object.keys(byManager)) {
    byManager[key]!.sort((a, b) => {
      const rd = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3)
      if (rd !== 0) return rd
      return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)
    })
  }

  const result: TreeNode[] = []

  function walk(managerId: string, depth: number, prefix: string) {
    const children = byManager[managerId] ?? []
    children.forEach((user, idx) => {
      const isLast = idx === children.length - 1
      result.push({ user, depth, isLast, parentPrefix: prefix })
      walk(user.id, depth + 1, prefix + (isLast ? '    ' : '│   '))
    })
  }

  walk('__root__', 0, '')
  return result
}

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>
}) {
  const { search } = await searchParams

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

  const adminClient = createAdminClient()
  const orgId  = profile.organization_id as string
  const isAdmin = (profile.role as string) === 'admin'

  const { data: usersRaw } = await adminClient
    .from('users')
    .select('id, full_name, email, role, manager_id')
    .eq('organization_id', orgId)
    .order('full_name')

  const allUsers: OrgUser[] = (usersRaw ?? []).map(u => ({
    id:         u.id as string,
    full_name:  u.full_name as string | null,
    email:      u.email as string,
    role:       u.role as string,
    manager_id: u.manager_id as string | null,
  }))

  // Counts
  const roleCount: Record<string, number> = {}
  for (const u of allUsers) { roleCount[u.role] = (roleCount[u.role] ?? 0) + 1 }

  const tree = buildTree(allUsers)

  // Filter for search
  const q = search?.trim().toLowerCase() ?? ''
  const filtered = q
    ? tree.filter(n =>
        (n.user.full_name ?? '').toLowerCase().includes(q) ||
        n.user.email.toLowerCase().includes(q) ||
        n.user.role.toLowerCase().includes(q)
      )
    : tree

  return (
    <div style={{ maxWidth: '860px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Reporting Lines</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            {allUsers.length} people ·{' '}
            {(roleCount['admin'] ?? 0)} admin{(roleCount['admin'] ?? 0) !== 1 ? 's' : ''} ·{' '}
            {(roleCount['manager'] ?? 0)} manager{(roleCount['manager'] ?? 0) !== 1 ? 's' : ''} ·{' '}
            {(roleCount['contributor'] ?? 0)} contributor{(roleCount['contributor'] ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        {isAdmin && (
          <a
            href="/admin/users"
            style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', textDecoration: 'none', color: '#374151' }}
          >
            Manage Users →
          </a>
        )}
      </div>

      {/* Search */}
      <form method="GET" style={{ marginBottom: '1.25rem' }}>
        <input
          type="text"
          name="search"
          defaultValue={search ?? ''}
          placeholder="Search by name, email, or role…"
          style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
        />
      </form>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {(['admin', 'manager', 'contributor'] as const).map(r => (
          <span key={r} style={{ fontSize: '0.75rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', backgroundColor: ROLE_COLORS[r]!.bg, color: ROLE_COLORS[r]!.color }}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </span>
        ))}
        <span style={{ fontSize: '0.75rem', color: '#9ca3af', alignSelf: 'center' }}>
          · Indentation shows reporting hierarchy
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>No results for &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          {filtered.map((node, idx) => {
            const { user: u, depth, isLast, parentPrefix } = node
            const rc = ROLE_COLORS[u.role] ?? { bg: '#f3f4f6', color: '#374151' }
            const isMe = u.id === user.id
            const connector = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ')
            const indent = depth === 0 ? '' : parentPrefix + connector

            return (
              <div
                key={u.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                  backgroundColor: isMe ? '#fafafa' : 'white',
                }}
              >
                {/* Tree connector */}
                {depth > 0 && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: '#d1d5db', whiteSpace: 'pre', flexShrink: 0 }}>
                    {indent}
                  </span>
                )}

                {/* Avatar circle */}
                <div style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: '9999px',
                  backgroundColor: rc.bg,
                  color: rc.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {((u.full_name ?? u.email).charAt(0)).toUpperCase()}
                </div>

                {/* Name + email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: isMe ? 700 : 500, fontSize: '0.9375rem', color: '#111827' }}>
                      {u.full_name ?? u.email}
                      {isMe && <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 400, marginLeft: '0.25rem' }}>(you)</span>}
                    </span>
                    <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.45rem', borderRadius: '9999px', backgroundColor: rc.bg, color: rc.color }}>
                      {u.role}
                    </span>
                  </div>
                  {u.full_name && (
                    <div style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.email}
                    </div>
                  )}
                </div>

                {/* Edit link for admins */}
                {isAdmin && (
                  <a
                    href={`/admin/users/${u.id}/edit`}
                    style={{ fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', flexShrink: 0, padding: '0.25rem 0.5rem', borderRadius: '4px' }}
                  >
                    Edit
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {q && (
        <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
          <a href="/reporting" style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>Clear search</a>
        </div>
      )}
    </div>
  )
}
