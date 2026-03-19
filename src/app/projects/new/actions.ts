'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function createProject(formData: FormData) {
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
    redirect('/projects?message=Only admins and managers can create projects.')
  }

  const name           = (formData.get('name') as string)?.trim()
  const description    = (formData.get('description') as string)?.trim() || null
  const ownerId        = (formData.get('owner_id') as string) || user.id
  const teamId         = (formData.get('team_id') as string) || null
  const priority       = (formData.get('priority') as string) || 'medium'
  const capacityRaw    = formData.get('capacity_impact') as string | null
  const capacityImpact = capacityRaw ? parseInt(capacityRaw, 10) : null
  const startDateRaw   = formData.get('start_date') as string | null
  const endDateRaw     = formData.get('end_date') as string | null

  if (!name || name.length < 1) {
    redirect('/projects/new?message=Project name is required.')
  }

  const adminClient = createAdminClient()

  const { data: inserted, error } = await adminClient
    .from('projects')
    .insert({
      organization_id: profile.organization_id,
      name,
      description,
      owner_id:        ownerId,
      team_id:         teamId || null,
      priority,
      capacity_impact: capacityImpact,
      start_date:      startDateRaw || null,
      end_date:        endDateRaw   || null,
      status:          'planning',
      created_by:      user.id,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    redirect('/projects/new?message=Failed to create project. Please try again.')
  }

  redirect(`/projects/${inserted.id as string}?message=Project created successfully.`)
}
