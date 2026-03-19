'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function verifyKpiAccess(kpiId: string, requireManager = false) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin) redirect('/platform-admin/kpis')

  if (requireManager && profile.role === 'contributor') {
    redirect(`/kpis/${kpiId}?message=Only managers and admins can record KPI values`)
  }

  const adminClient = createAdminClient()

  // Verify KPI belongs to this org and audience allows access
  const { data: kpi } = await adminClient
    .from('kpis')
    .select('id, organization_id, audience')
    .eq('id', kpiId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!kpi) redirect('/kpis?message=KPI not found')

  // Audience check: contributors can't see management_only KPIs
  if (kpi.audience === 'management_only' && profile.role === 'contributor') {
    redirect('/kpis?message=You do not have access to this KPI')
  }

  return { adminClient, user, profile, kpi }
}

export async function recordKpiValue(formData: FormData) {
  const kpiId = formData.get('kpi_id') as string
  const { adminClient, profile } = await verifyKpiAccess(kpiId, true)

  const valueRaw = formData.get('value') as string
  const dateStr  = formData.get('date') as string
  const notes    = (formData.get('notes') as string)?.trim() || null

  if (!valueRaw || isNaN(parseFloat(valueRaw))) {
    redirect(`/kpis/${kpiId}?message=A valid numeric value is required`)
  }
  if (!dateStr) {
    redirect(`/kpis/${kpiId}?message=Date is required`)
  }

  const { error } = await adminClient.from('kpi_records').insert({
    kpi_id:          kpiId,
    organization_id: profile.organization_id,
    value:           parseFloat(valueRaw),
    date:            new Date(dateStr).toISOString(),
    notes:           notes ? notes.slice(0, 2000) : null,
  })

  if (error) redirect(`/kpis/${kpiId}?message=Failed to save: ${error.message}`)
  redirect(`/kpis/${kpiId}?message=Reading recorded`)
}

export async function deleteKpiRecord(formData: FormData) {
  const kpiId    = formData.get('kpi_id') as string
  const recordId = formData.get('record_id') as string
  const { adminClient, profile } = await verifyKpiAccess(kpiId, true)

  const { error } = await adminClient
    .from('kpi_records')
    .delete()
    .eq('id', recordId)
    .eq('kpi_id', kpiId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/kpis/${kpiId}?message=Failed to delete: ${error.message}`)
  redirect(`/kpis/${kpiId}?message=Reading removed`)
}
