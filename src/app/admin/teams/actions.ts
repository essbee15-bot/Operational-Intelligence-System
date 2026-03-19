'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function verifyOrgAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/?message=Unauthorised')
  return { adminClient: createAdminClient(), user, profile }
}

export async function createTeam(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const name   = (formData.get('name') as string)?.trim()
  const leadId = (formData.get('lead_id') as string) || null

  if (!name)              redirect('/admin/teams?message=Team name is required')
  if (name.length > 100)  redirect('/admin/teams?message=Name must be 100 characters or fewer')

  const { error } = await adminClient.from('teams').insert({
    organization_id: profile.organization_id,
    name,
    lead_id: leadId || null,
  })

  if (error) redirect(`/admin/teams?message=Failed to create team: ${error.message}`)
  redirect('/admin/teams?message=Team created')
}

export async function updateTeam(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const teamId = formData.get('team_id') as string
  const name   = (formData.get('name') as string)?.trim()
  const leadId = (formData.get('lead_id') as string) || null

  if (!teamId)            redirect('/admin/teams?message=Missing team ID')
  if (!name)              redirect(`/admin/teams?team=${teamId}&message=Team name is required`)
  if (name.length > 100)  redirect(`/admin/teams?team=${teamId}&message=Name must be 100 characters or fewer`)

  const { error } = await adminClient
    .from('teams')
    .update({ name, lead_id: leadId || null })
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/teams?team=${teamId}&message=Failed to update: ${error.message}`)
  redirect(`/admin/teams?team=${teamId}&message=Team updated`)
}

export async function deleteTeam(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const teamId = formData.get('team_id') as string

  const { error } = await adminClient
    .from('teams')
    .delete()
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/teams?message=Failed to delete team: ${error.message}`)
  redirect('/admin/teams?message=Team deleted')
}

export async function addTeamMember(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const teamId = formData.get('team_id') as string
  const userId = formData.get('user_id') as string

  if (!teamId || !userId) redirect('/admin/teams?message=Missing parameters')

  // Verify team belongs to this org
  const { data: team } = await adminClient
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!team) redirect('/admin/teams?message=Team not found')

  // upsert — silently skip if already a member
  const { error } = await adminClient.from('team_members').upsert({
    team_id:         teamId,
    user_id:         userId,
    organization_id: profile.organization_id,
  }, { onConflict: 'team_id,user_id' })

  if (error) redirect(`/admin/teams?team=${teamId}&message=Failed to add member: ${error.message}`)
  redirect(`/admin/teams?team=${teamId}&message=Member added`)
}

export async function removeTeamMember(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const teamId = formData.get('team_id') as string
  const userId = formData.get('user_id') as string

  // Verify team belongs to this org before deleting
  const { data: team } = await adminClient
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!team) redirect('/admin/teams?message=Team not found')

  const { error } = await adminClient
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)

  if (error) redirect(`/admin/teams?team=${teamId}&message=Failed to remove member: ${error.message}`)
  redirect(`/admin/teams?team=${teamId}&message=Member removed`)
}
