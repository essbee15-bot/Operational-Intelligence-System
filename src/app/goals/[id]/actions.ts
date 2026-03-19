'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function verifyObjectiveAccess(objectiveId: string, requireManager = false) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_platform_admin) redirect('/goals')

  const isManager = profile.role === 'admin' || profile.role === 'manager'

  if (requireManager && !isManager) {
    redirect(`/goals/${objectiveId}?message=Only managers and admins can do this`)
  }

  const adminClient = createAdminClient()

  const { data: objective } = await adminClient
    .from('objectives')
    .select('id, organization_id, status')
    .eq('id', objectiveId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!objective) redirect('/goals?message=Objective not found')

  return { adminClient, user, profile, objective, isManager }
}

export async function addKeyResult(formData: FormData) {
  const objectiveId = formData.get('objective_id') as string
  const { adminClient, profile } = await verifyObjectiveAccess(objectiveId, true)

  const title        = (formData.get('title') as string)?.trim()
  const description  = (formData.get('description') as string)?.trim() || null
  const kpiId        = (formData.get('kpi_id') as string) || null
  const targetRaw    = formData.get('target_value') as string
  const unit         = (formData.get('unit') as string)?.trim() || null
  const status       = (formData.get('status') as string) || 'not_started'

  if (!title)             redirect(`/goals/${objectiveId}?message=Key result title is required`)
  if (title.length > 300) redirect(`/goals/${objectiveId}?message=Title must be 300 characters or fewer`)

  const VALID_STATUSES = ['not_started', 'on_track', 'at_risk', 'complete', 'missed']
  if (!VALID_STATUSES.includes(status)) redirect(`/goals/${objectiveId}?message=Invalid status`)

  // Verify KPI belongs to this org (if provided)
  if (kpiId) {
    const { data: kpi } = await adminClient
      .from('kpis')
      .select('id')
      .eq('id', kpiId)
      .eq('organization_id', profile.organization_id)
      .single()
    if (!kpi) redirect(`/goals/${objectiveId}?message=KPI not found in your organisation`)
  }

  // Get next display_order
  const { data: last } = await adminClient
    .from('key_results')
    .select('display_order')
    .eq('objective_id', objectiveId)
    .order('display_order', { ascending: false })
    .limit(1)

  const { error } = await adminClient.from('key_results').insert({
    organization_id: profile.organization_id,
    objective_id:    objectiveId,
    title,
    description,
    kpi_id:          kpiId || null,
    target_value:    targetRaw ? parseFloat(targetRaw) : null,
    unit:            unit || null,
    current_value:   null,
    status,
    display_order:   (last?.[0]?.display_order ?? 0) + 1,
  })

  if (error) redirect(`/goals/${objectiveId}?message=Failed to add key result: ${error.message}`)
  redirect(`/goals/${objectiveId}?message=Key result added`)
}

export async function updateKeyResult(formData: FormData) {
  const objectiveId   = formData.get('objective_id') as string
  const keyResultId   = formData.get('key_result_id') as string
  const { adminClient, profile } = await verifyObjectiveAccess(objectiveId, true)

  const currentRaw = formData.get('current_value') as string
  const status     = formData.get('status') as string

  const VALID_STATUSES = ['not_started', 'on_track', 'at_risk', 'complete', 'missed']
  if (!VALID_STATUSES.includes(status)) redirect(`/goals/${objectiveId}?message=Invalid status`)

  const { error } = await adminClient
    .from('key_results')
    .update({
      current_value: currentRaw ? parseFloat(currentRaw) : null,
      status,
    })
    .eq('id', keyResultId)
    .eq('objective_id', objectiveId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/goals/${objectiveId}?message=Failed to update: ${error.message}`)
  redirect(`/goals/${objectiveId}?message=Progress updated`)
}

export async function removeKeyResult(formData: FormData) {
  const objectiveId = formData.get('objective_id') as string
  const keyResultId = formData.get('key_result_id') as string
  const { adminClient, profile } = await verifyObjectiveAccess(objectiveId, true)

  const { error } = await adminClient
    .from('key_results')
    .delete()
    .eq('id', keyResultId)
    .eq('objective_id', objectiveId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/goals/${objectiveId}?message=Failed to remove: ${error.message}`)
  redirect(`/goals/${objectiveId}?message=Key result removed`)
}

export async function updateObjectiveStatus(formData: FormData) {
  const objectiveId = formData.get('objective_id') as string
  const { adminClient, profile } = await verifyObjectiveAccess(objectiveId, true)

  const status = formData.get('status') as string
  const VALID = ['active', 'complete', 'cancelled']
  if (!VALID.includes(status)) redirect(`/goals/${objectiveId}?message=Invalid status`)

  const { error } = await adminClient
    .from('objectives')
    .update({ status })
    .eq('id', objectiveId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/goals/${objectiveId}?message=Failed to update: ${error.message}`)
  redirect(`/goals/${objectiveId}?message=Status updated`)
}

export async function deleteObjective(formData: FormData) {
  const objectiveId = formData.get('objective_id') as string

  // Only admins can delete
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_platform_admin || profile.role !== 'admin') {
    redirect(`/goals/${objectiveId}?message=Only org admins can delete objectives`)
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('objectives')
    .delete()
    .eq('id', objectiveId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/goals/${objectiveId}?message=Failed to delete: ${error.message}`)
  redirect('/goals?message=Objective deleted')
}
