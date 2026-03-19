'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

const VALID_CATEGORIES = ['sales', 'finance', 'operations', 'customer', 'hr', 'projects', 'other']
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc']

async function verifyPlatformAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/?message=Unauthorised')
  return { adminClient: createAdminClient() }
}

// ─── System catalogue (organization_id = NULL) ────────────────────────────────

export async function createSystemKpi(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const name           = (formData.get('name') as string)?.trim()
  const category       = formData.get('category') as string
  const description    = (formData.get('description') as string)?.trim() || null
  const unit           = (formData.get('unit') as string)?.trim() || null
  const targetValue    = formData.get('target_value') as string
  const frequency      = formData.get('target_frequency') as string

  if (!name)                              redirect('/platform-admin/kpis?message=KPI name is required')
  if (!VALID_CATEGORIES.includes(category)) redirect('/platform-admin/kpis?message=Invalid category')
  if (!VALID_FREQUENCIES.includes(frequency)) redirect('/platform-admin/kpis?message=Invalid frequency')
  if (name.length > 200)                  redirect('/platform-admin/kpis?message=Name must be 200 characters or fewer')

  // Next display_order within this category
  const { data: last } = await adminClient
    .from('kpis')
    .select('display_order')
    .is('organization_id', null)
    .eq('category', category)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (last?.[0]?.display_order ?? 0) + 1

  const { error } = await adminClient.from('kpis').insert({
    organization_id: null,
    name,
    category,
    description,
    unit: unit || null,
    target_value: targetValue ? parseFloat(targetValue) : null,
    target_frequency: frequency,
    display_order: nextOrder,
    is_active: true,
  })

  if (error) redirect(`/platform-admin/kpis?message=Failed to add KPI: ${error.message}`)
  redirect('/platform-admin/kpis?message=KPI added to catalogue')
}

export async function updateSystemKpi(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const kpiId      = formData.get('kpi_id') as string
  const name       = (formData.get('name') as string)?.trim()
  const category   = formData.get('category') as string
  const description = (formData.get('description') as string)?.trim() || null
  const unit       = (formData.get('unit') as string)?.trim() || null
  const frequency  = formData.get('target_frequency') as string

  if (!kpiId)                               redirect('/platform-admin/kpis?message=Missing KPI id')
  if (!name)                                redirect('/platform-admin/kpis?message=KPI name is required')
  if (!VALID_CATEGORIES.includes(category)) redirect('/platform-admin/kpis?message=Invalid category')
  if (!VALID_FREQUENCIES.includes(frequency)) redirect('/platform-admin/kpis?message=Invalid frequency')
  if (name.length > 200)                    redirect('/platform-admin/kpis?message=Name must be 200 characters or fewer')

  const updates = { name, category, description, unit: unit || null, target_frequency: frequency }

  // 1. Update the system template
  const { error } = await adminClient
    .from('kpis')
    .update(updates)
    .eq('id', kpiId)
    .is('organization_id', null)

  if (error) redirect(`/platform-admin/kpis?message=Failed to update: ${error.message}`)

  // 2. Propagate wording changes to every org copy derived from this template.
  //    We update name, description, unit and frequency — the fields the platform
  //    admin controls. The org retains its own target_value and owner_id.
  await adminClient
    .from('kpis')
    .update(updates)
    .eq('template_kpi_id', kpiId)
    .not('organization_id', 'is', null)

  redirect('/platform-admin/kpis?message=KPI updated and synced to all organisations')
}

export async function deleteSystemKpi(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const kpiId = formData.get('kpi_id') as string
  const { error } = await adminClient
    .from('kpis')
    .delete()
    .eq('id', kpiId)
    .is('organization_id', null)

  if (error) redirect(`/platform-admin/kpis?message=Failed to remove KPI: ${error.message}`)
  redirect('/platform-admin/kpis?message=KPI removed from catalogue')
}

export async function toggleSystemKpi(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const kpiId      = formData.get('kpi_id') as string
  const isActive   = formData.get('is_active') === 'true'

  const { error } = await adminClient
    .from('kpis')
    .update({ is_active: !isActive })
    .eq('id', kpiId)
    .is('organization_id', null)

  if (error) redirect(`/platform-admin/kpis?message=Failed to update KPI`)
  redirect(`/platform-admin/kpis?message=KPI ${!isActive ? 'enabled' : 'disabled'}`)
}

// ─── Org-specific KPIs ────────────────────────────────────────────────────────

export async function assignKpiToOrg(formData: FormData) {
  // Copies a system template into a specific org's KPI list
  const { adminClient } = await verifyPlatformAdmin()

  const templateId = formData.get('template_kpi_id') as string
  const orgId      = formData.get('org_id') as string

  if (!templateId || !orgId) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Missing parameters`)

  // Load the template
  const { data: template } = await adminClient
    .from('kpis')
    .select('*')
    .eq('id', templateId)
    .is('organization_id', null)
    .single()

  if (!template) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Template not found`)

  // Get next display order for this org + category
  const { data: last } = await adminClient
    .from('kpis')
    .select('display_order')
    .eq('organization_id', orgId)
    .eq('category', template.category)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (last?.[0]?.display_order ?? 0) + 1

  const { error } = await adminClient.from('kpis').insert({
    organization_id: orgId,
    template_kpi_id: templateId,
    name:            template.name,
    category:        template.category,
    description:     template.description,
    unit:            template.unit,
    target_value:    template.target_value,
    target_frequency: template.target_frequency,
    display_order:   nextOrder,
    is_active:       true,
  })

  if (error) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Failed to assign KPI: ${error.message}`)
  redirect(`/platform-admin/kpis?org_id=${orgId}&message=KPI assigned to organisation`)
}

export async function createOrgKpi(formData: FormData) {
  // Adds a bespoke KPI directly to a specific org (no template source)
  const { adminClient } = await verifyPlatformAdmin()

  const orgId       = formData.get('org_id') as string
  const name        = (formData.get('name') as string)?.trim()
  const category    = formData.get('category') as string
  const description = (formData.get('description') as string)?.trim() || null
  const unit        = (formData.get('unit') as string)?.trim() || null
  const targetValue = formData.get('target_value') as string
  const frequency   = formData.get('target_frequency') as string

  if (!orgId || !name)                      redirect(`/platform-admin/kpis?org_id=${orgId}&message=KPI name is required`)
  if (!VALID_CATEGORIES.includes(category)) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Invalid category`)
  if (!VALID_FREQUENCIES.includes(frequency)) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Invalid frequency`)
  if (name.length > 200)                    redirect(`/platform-admin/kpis?org_id=${orgId}&message=Name must be 200 characters or fewer`)

  const { data: last } = await adminClient
    .from('kpis')
    .select('display_order')
    .eq('organization_id', orgId)
    .eq('category', category)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (last?.[0]?.display_order ?? 0) + 1

  const { error } = await adminClient.from('kpis').insert({
    organization_id: orgId,
    template_kpi_id: null,
    name,
    category,
    description,
    unit: unit || null,
    target_value: targetValue ? parseFloat(targetValue) : null,
    target_frequency: frequency,
    display_order: nextOrder,
    is_active: true,
  })

  if (error) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Failed to add KPI: ${error.message}`)
  redirect(`/platform-admin/kpis?org_id=${orgId}&message=KPI added to organisation`)
}

export async function removeOrgKpi(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const kpiId = formData.get('kpi_id') as string
  const orgId = formData.get('org_id') as string

  const { error } = await adminClient
    .from('kpis')
    .delete()
    .eq('id', kpiId)
    .eq('organization_id', orgId)

  if (error) redirect(`/platform-admin/kpis?org_id=${orgId}&message=Failed to remove KPI: ${error.message}`)
  redirect(`/platform-admin/kpis?org_id=${orgId}&message=KPI removed from organisation`)
}
