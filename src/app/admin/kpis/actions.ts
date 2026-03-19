'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

const VALID_CATEGORIES  = ['sales', 'finance', 'operations', 'customer', 'hr', 'projects', 'other']
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc']
const VALID_AUDIENCES   = ['everyone', 'management_only']

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

// ─── Assign a system catalogue KPI to this org ───────────────────────────────

export async function addKpiFromCatalogue(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const templateId = formData.get('template_kpi_id') as string
  if (!templateId) redirect('/admin/kpis?message=Missing template ID')

  // Load the system template
  const { data: template } = await adminClient
    .from('kpis')
    .select('*')
    .eq('id', templateId)
    .is('organization_id', null)
    .single()

  if (!template) redirect('/admin/kpis?view=catalogue&message=Template not found')

  // Check not already assigned
  const { data: existing } = await adminClient
    .from('kpis')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('template_kpi_id', templateId)
    .single()

  if (existing) redirect('/admin/kpis?view=catalogue&message=Already assigned to your organisation')

  const { data: last } = await adminClient
    .from('kpis')
    .select('display_order')
    .eq('organization_id', profile.organization_id)
    .eq('category', template.category)
    .order('display_order', { ascending: false })
    .limit(1)

  const { error } = await adminClient.from('kpis').insert({
    organization_id:  profile.organization_id,
    template_kpi_id:  templateId,
    name:             template.name,
    category:         template.category,
    description:      template.description,
    unit:             template.unit,
    target_value:     null,          // org sets their own target
    target_frequency: template.target_frequency,
    audience:         'everyone',
    display_order:    (last?.[0]?.display_order ?? 0) + 1,
    is_active:        true,
  })

  if (error) redirect(`/admin/kpis?view=catalogue&message=Failed to assign: ${error.message}`)
  redirect('/admin/kpis?message=KPI added to your organisation')
}

// ─── Add a bespoke (non-catalogue) KPI ───────────────────────────────────────

export async function addBespokeOrgKpi(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const name        = (formData.get('name') as string)?.trim()
  const category    = formData.get('category') as string
  const description = (formData.get('description') as string)?.trim() || null
  const unit        = (formData.get('unit') as string)?.trim() || null
  const targetRaw   = formData.get('target_value') as string
  const frequency   = formData.get('target_frequency') as string
  const audience    = formData.get('audience') as string || 'everyone'

  if (!name)                                  redirect('/admin/kpis?message=KPI name is required')
  if (!VALID_CATEGORIES.includes(category))   redirect('/admin/kpis?message=Invalid category')
  if (!VALID_FREQUENCIES.includes(frequency)) redirect('/admin/kpis?message=Invalid frequency')
  if (!VALID_AUDIENCES.includes(audience))    redirect('/admin/kpis?message=Invalid audience')
  if (name.length > 200)                      redirect('/admin/kpis?message=Name must be 200 characters or fewer')

  const { data: last } = await adminClient
    .from('kpis')
    .select('display_order')
    .eq('organization_id', profile.organization_id)
    .eq('category', category)
    .order('display_order', { ascending: false })
    .limit(1)

  const { error } = await adminClient.from('kpis').insert({
    organization_id:  profile.organization_id,
    template_kpi_id:  null,
    name,
    category,
    description,
    unit:             unit || null,
    target_value:     targetRaw ? parseFloat(targetRaw) : null,
    target_frequency: frequency,
    audience,
    display_order:    (last?.[0]?.display_order ?? 0) + 1,
    is_active:        true,
  })

  if (error) redirect(`/admin/kpis?message=Failed to add KPI: ${error.message}`)
  redirect('/admin/kpis?message=KPI added')
}

// ─── Update target, owner, audience, active flag ─────────────────────────────

export async function updateOrgKpiSettings(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const kpiId      = formData.get('kpi_id') as string
  const targetRaw  = formData.get('target_value') as string
  const ownerId    = (formData.get('owner_id') as string) || null
  const audience   = formData.get('audience') as string || 'everyone'
  const isActive   = formData.get('is_active') !== 'false'

  if (!kpiId)                              redirect('/admin/kpis?message=Missing KPI ID')
  if (!VALID_AUDIENCES.includes(audience)) redirect('/admin/kpis?message=Invalid audience')

  const { error } = await adminClient
    .from('kpis')
    .update({
      target_value: targetRaw ? parseFloat(targetRaw) : null,
      owner_id:     ownerId || null,
      audience,
      is_active:    isActive,
    })
    .eq('id', kpiId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/kpis?message=Failed to update: ${error.message}`)
  redirect('/admin/kpis?message=KPI settings updated')
}

// ─── Remove org KPI (cascades kpi_records) ───────────────────────────────────

export async function removeOrgKpi(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const kpiId = formData.get('kpi_id') as string
  if (!kpiId) redirect('/admin/kpis?message=Missing KPI ID')

  const { error } = await adminClient
    .from('kpis')
    .delete()
    .eq('id', kpiId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/kpis?message=Failed to remove: ${error.message}`)
  redirect('/admin/kpis?message=KPI removed')
}
