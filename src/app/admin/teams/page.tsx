import React from 'react'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember } from './actions'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', contributor: 'Contributor',
}
const ROLE_COLOR: Record<string, string> = {
  admin: '#92400e', manager: '#1d4ed8', contributor: '#374151',
}
const ROLE_BG: Record<string, string> = {
  admin: '#fffbeb', manager: '#eff6ff', contributor: '#f3f4f6',
}

export default async function AdminTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; message?: string }>
}) {
  const { team: expandedTeamId, message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()

  // All teams in this org
  const { data: teams } = await adminClient
    .from('teams')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('name')

  // All org users (for lead dropdown + member add)
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .order('full_name')

  // All team_members for this org
  const { data: allMembers } = await adminClient
    .from('team_members')
    .select('team_id, user_id')
    .eq('organization_id', profile.organization_id)

  // Build lookup maps
  const userMap: Record<string, { name: string; role: string }> = Object.fromEntries(
    (orgUsers ?? []).map(u => [
      u.id,
      { name: u.full_name ?? u.email ?? 'Unknown', role: u.role as string },
    ])
  )

  // membersByTeam: team_id → user_id[]
  const membersByTeam: Record<string, string[]> = {}
  ;(allMembers ?? []).forEach(m => {
    const tid = m.team_id as string
    if (!membersByTeam[tid]) membersByTeam[tid] = []
    membersByTeam[tid]!.push(m.user_id as string)
  })

  const isSuccess = ['created', 'updated', 'deleted', 'added', 'removed'].some(w => message?.toLowerCase().includes(w))

  // Eligible leads = admin or manager role
  const leadCandidates = (orgUsers ?? []).filter(u => u.role === 'admin' || u.role === 'manager')

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>Teams</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          Create teams, assign members and scope KPIs to specific teams.
        </p>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* ── Create team form ──────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.875rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Create Team</h2>
        <form style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Team name *</label>
            <input
              name="name" type="text" required maxLength={100}
              placeholder="e.g. Sales Team, Engineering"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Team lead <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <select name="lead_id" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
              <option value="">— No lead —</option>
              {leadCandidates.map(u => (
                <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
              ))}
            </select>
          </div>
          <button
            formAction={createTeam}
            style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
          >
            Create Team
          </button>
        </form>
      </div>

      {/* ── Teams list ─────────────────────────────────────────────────────── */}
      {(teams ?? []).length === 0 ? (
        <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '1.25rem', fontSize: '0.875rem', color: '#92400e' }}>
          No teams yet. Create your first team above.
        </div>
      ) : (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Team</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Lead</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Members</th>
                <th style={{ padding: '0.5rem 0.875rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {(teams ?? []).map((team, idx) => {
                const isExpanded = expandedTeamId === (team.id as string)
                const memberIds  = membersByTeam[team.id as string] ?? []
                const leadName   = team.lead_id ? (userMap[team.lead_id as string]?.name ?? '—') : '—'

                // Users NOT yet in this team (candidates to add)
                const nonMembers = (orgUsers ?? []).filter(u => !memberIds.includes(u.id))

                return (
                  <React.Fragment key={team.id as string}>
                    <tr style={{ borderBottom: !isExpanded && idx < (teams ?? []).length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                      <td style={{ padding: '0.625rem 0.875rem', fontWeight: 500, color: '#111827' }}>
                        {team.name as string}
                      </td>
                      <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>{leadName}</td>
                      <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>
                        {memberIds.length} {memberIds.length === 1 ? 'member' : 'members'}
                      </td>
                      <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isExpanded
                          ? <a href="/admin/teams" style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none', marginRight: '0.75rem' }}>Close</a>
                          : <a href={`/admin/teams?team=${team.id as string}`} style={{ fontSize: '0.75rem', color: '#374151', textDecoration: 'none', marginRight: '0.75rem' }}>Manage</a>
                        }
                        <form style={{ display: 'inline' }}>
                          <input type="hidden" name="team_id" value={team.id as string} />
                          <button
                            formAction={deleteTeam}
                            style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            title="Delete team and remove all member assignments"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={4} style={{ padding: 0, borderBottom: idx < (teams ?? []).length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                          <div style={{ padding: '1rem 0.875rem', backgroundColor: '#f0f7ff', borderLeft: '3px solid #2563eb' }}>

                            {/* Edit name + lead */}
                            <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #bfdbfe' }}>
                              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#1d4ed8' }}>Edit Team</p>
                              <form style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <input type="hidden" name="team_id" value={team.id as string} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 180px' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 500 }}>Team name</label>
                                  <input
                                    name="name" type="text" required maxLength={100}
                                    defaultValue={team.name as string}
                                    style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 180px' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 500 }}>Team lead</label>
                                  <select name="lead_id" defaultValue={team.lead_id as string ?? ''} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                    <option value="">— No lead —</option>
                                    {leadCandidates.map(u => (
                                      <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                                    ))}
                                  </select>
                                </div>
                                <button formAction={updateTeam} style={{ padding: '0.375rem 1rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                                  Save
                                </button>
                              </form>
                            </div>

                            {/* Members list */}
                            <div style={{ marginBottom: '1rem' }}>
                              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#1d4ed8' }}>
                                Members ({memberIds.length})
                              </p>
                              {memberIds.length === 0 ? (
                                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>No members yet. Add members below.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                  {memberIds.map(uid => {
                                    const u = userMap[uid]
                                    if (!u) return null
                                    return (
                                      <div key={uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.375rem 0.625rem', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dbeafe' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <span style={{ fontWeight: 500, fontSize: '0.8125rem', color: '#111827' }}>{u.name}</span>
                                          <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.375rem', borderRadius: '9999px', backgroundColor: ROLE_BG[u.role] ?? '#f3f4f6', color: ROLE_COLOR[u.role] ?? '#374151' }}>
                                            {ROLE_LABEL[u.role] ?? u.role}
                                          </span>
                                        </div>
                                        <form style={{ display: 'inline' }}>
                                          <input type="hidden" name="team_id" value={team.id as string} />
                                          <input type="hidden" name="user_id" value={uid} />
                                          <button formAction={removeTeamMember} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                            Remove
                                          </button>
                                        </form>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Add member */}
                            {nonMembers.length > 0 && (
                              <div>
                                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#1d4ed8' }}>Add Member</p>
                                <form style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <input type="hidden" name="team_id" value={team.id as string} />
                                  <select name="user_id" style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white', flex: 1 }}>
                                    {nonMembers.map(u => (
                                      <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                                    ))}
                                  </select>
                                  <button formAction={addTeamMember} style={{ padding: '0.375rem 0.875rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                                    + Add
                                  </button>
                                </form>
                              </div>
                            )}
                            {nonMembers.length === 0 && memberIds.length > 0 && (
                              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#9ca3af' }}>All org users are already in this team.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
