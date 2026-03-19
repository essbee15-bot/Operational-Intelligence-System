'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function createObjective(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_platform_admin) redirect('/')
  if (profile.role !== 'admin' && profile.role !== 'manager') {
    redirect('/goals?message=Only managers and admins can create objectives')
  }

  const title       = (formData.get('title') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const ownerId     = (formData.get('owner_id') as string) || null
  const teamId      = (formData.get('team_id') as string) || null
  const periodLabel = (formData.get('period_label') as string)?.trim() || null
  const startDate   = (formData.get('start_date') as string) || null
  const endDate     = (formData.get('end_date') as string) || null

  if (!title)            redirect('/goals?message=Objective title is required')
  if (title.length > 300) redirect('/goals?message=Title must be 300 characters or fewer')

  // Managers must scope to a team
  if (profile.role === 'manager' && !teamId) {
    redirect('/goals?message=Managers must assign a team to their objective')
  }

  // Basic date validation
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    redirect('/goals?message=End date cannot be before start date')
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('objectives').insert({
    organization_id: profile.organization_id,
    title,
    description,
    owner_id:    ownerId || null,
    team_id:     teamId || null,
    period_label: periodLabel,
    start_date:  startDate || null,
    end_date:    endDate || null,
    status:      'active',
    created_by:  user.id,
  })

  if (error) redirect(`/goals?message=Failed to create: ${error.message}`)
  redirect('/goals?message=Objective created')
}
