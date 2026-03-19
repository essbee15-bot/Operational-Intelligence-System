'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function getManagerProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const role = profile.role as string
  if (role !== 'admin' && role !== 'manager') {
    redirect('/projects?message=Only admins and managers can edit projects.')
  }

  return { user, profile, adminClient: createAdminClient() }
}

export async function updateProject(formData: FormData) {
  const { user, profile, adminClient } = await getManagerProfile()
  const projectId = formData.get('project_id') as string

  const name           = (formData.get('name') as string)?.trim()
  const description    = (formData.get('description') as string)?.trim() || null
  const ownerId        = (formData.get('owner_id') as string) || user.id
  const teamId         = (formData.get('team_id') as string) || null
  const priority       = (formData.get('priority') as string) || 'medium'
  const capacityRaw    = formData.get('capacity_impact') as string | null
  const capacityImpact = capacityRaw ? parseInt(capacityRaw, 10) : null
  const startDateRaw   = formData.get('start_date') as string | null
  const endDateRaw     = formData.get('end_date') as string | null
  const outcomes       = (formData.get('outcomes') as string)?.trim() || null

  if (!name || name.length < 1) {
    redirect(`/projects/${projectId}?tab=overview&message=Project name is required.`)
  }

  const { error } = await adminClient
    .from('projects')
    .update({
      name,
      description,
      owner_id:        ownerId,
      team_id:         teamId || null,
      priority,
      capacity_impact: capacityImpact,
      start_date:      startDateRaw || null,
      end_date:        endDateRaw   || null,
      outcomes,
    })
    .eq('id', projectId)
    .eq('organization_id', profile.organization_id as string)

  if (error) {
    redirect(`/projects/${projectId}?tab=overview&message=Failed to save changes.`)
  }

  redirect(`/projects/${projectId}?tab=overview&message=Project saved.`)
}

export async function updateProjectStatus(formData: FormData) {
  const { profile, adminClient } = await getManagerProfile()
  const projectId = formData.get('project_id') as string
  const status    = formData.get('status') as string

  const validStatuses = ['planning', 'active', 'on_hold', 'completed', 'failed', 'cancelled']
  if (!validStatuses.includes(status)) {
    redirect(`/projects/${projectId}?message=Invalid status.`)
  }

  const { error } = await adminClient
    .from('projects')
    .update({ status })
    .eq('id', projectId)
    .eq('organization_id', profile.organization_id as string)

  if (error) {
    redirect(`/projects/${projectId}?message=Failed to update status.`)
  }

  redirect(`/projects/${projectId}?message=Status updated.`)
}

export async function addProjectAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const adminClient = createAdminClient()
  const projectId  = formData.get('project_id') as string
  const title      = (formData.get('title') as string)?.trim()
  const assigneeId = (formData.get('assignee_id') as string) || user.id
  const dueDateRaw = formData.get('due_date') as string | null

  if (!title) {
    redirect(`/projects/${projectId}?tab=actions&message=Action title is required.`)
  }

  const { error } = await adminClient
    .from('action_items')
    .insert({
      organization_id: profile.organization_id,
      title,
      assignee_id:     assigneeId,
      project_id:      projectId,
      status:          'pending',
      due_date:        dueDateRaw || null,
      is_closed:       false,
    })

  if (error) {
    redirect(`/projects/${projectId}?tab=actions&message=Failed to add action.`)
  }

  redirect(`/projects/${projectId}?tab=actions&message=Action added.`)
}

export async function closeProjectAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const adminClient = createAdminClient()
  const actionId  = formData.get('action_id') as string
  const projectId = formData.get('project_id') as string

  await adminClient
    .from('action_items')
    .update({ is_closed: true, status: 'completed' })
    .eq('id', actionId)
    .eq('organization_id', profile.organization_id as string)

  redirect(`/projects/${projectId}?tab=actions&message=Action marked complete.`)
}
