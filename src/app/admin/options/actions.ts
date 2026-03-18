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
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/?message=Unauthorised')
  return { supabase, user, profile }
}

export async function createOption(formData: FormData) {
  const { profile } = await verifyOrgAdmin()
  const adminClient = createAdminClient()

  const category = formData.get('category') as string
  const label = (formData.get('label') as string)?.trim()

  const validCategories = [
    'went_well', 'went_badly', 'learned',
    'risk_blockers', 'risk_support', 'risk_mitigation',
    'development_type', 'meeting_purpose',
  ]

  if (!category || !label) {
    redirect(`/admin/options?category=${category}&message=Label is required`)
  }
  if (!validCategories.includes(category)) {
    redirect(`/admin/options?message=Invalid category`)
  }
  if (label.length > 300) {
    redirect(`/admin/options?category=${category}&message=Label must be 300 characters or fewer`)
  }

  // Get next display order
  const { data: existing } = await adminClient
    .from('predefined_options')
    .select('display_order')
    .eq('organization_id', profile.organization_id)
    .eq('category', category)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.display_order ?? 0) + 1

  const { error } = await adminClient
    .from('predefined_options')
    .insert({
      organization_id: profile.organization_id,
      category,
      label,
      display_order: nextOrder,
    })

  if (error) {
    redirect(`/admin/options?category=${category}&message=Failed to add option: ${error.message}`)
  }

  redirect(`/admin/options?category=${category}&message=Option added successfully`)
}

export async function toggleOption(formData: FormData) {
  const { profile } = await verifyOrgAdmin()
  const adminClient = createAdminClient()

  const optionId = formData.get('option_id') as string
  const category = formData.get('category') as string
  const currentActive = formData.get('is_active') === 'true'

  // Can only toggle org-specific options (not system defaults)
  const { error } = await adminClient
    .from('predefined_options')
    .update({ is_active: !currentActive })
    .eq('id', optionId)
    .eq('organization_id', profile.organization_id)

  if (error) {
    redirect(`/admin/options?category=${category}&message=Failed to update option`)
  }

  redirect(`/admin/options?category=${category}&message=Option updated`)
}

export async function deleteOption(formData: FormData) {
  const { profile } = await verifyOrgAdmin()
  const adminClient = createAdminClient()

  const optionId = formData.get('option_id') as string
  const category = formData.get('category') as string

  // Can only delete org-specific options (not system defaults)
  const { error } = await adminClient
    .from('predefined_options')
    .delete()
    .eq('id', optionId)
    .eq('organization_id', profile.organization_id)

  if (error) {
    redirect(`/admin/options?category=${category}&message=Failed to delete option`)
  }

  redirect(`/admin/options?category=${category}&message=Option removed`)
}

export async function hideSystemOption(formData: FormData) {
  // Creates an org-specific "shadow" record that marks a system default as hidden
  // by adding an org override with is_active=false
  const { profile } = await verifyOrgAdmin()
  const adminClient = createAdminClient()

  const label = formData.get('label') as string
  const category = formData.get('category') as string

  // Check if an org override already exists
  const { data: existing } = await adminClient
    .from('predefined_options')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('category', category)
    .eq('label', label)
    .single()

  if (existing) {
    // Toggle it
    redirect(`/admin/options?category=${category}&message=Already overridden`)
  }

  await adminClient
    .from('predefined_options')
    .insert({
      organization_id: profile.organization_id,
      category,
      label,
      display_order: 999,
      is_active: false,
    })

  redirect(`/admin/options?category=${category}&message=System option hidden for your organisation`)
}
