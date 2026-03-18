'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

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

const VALID_CATEGORIES = [
  'went_well', 'went_badly', 'learned',
  'risk_blockers', 'risk_support', 'risk_mitigation',
  'development_type', 'meeting_purpose',
]

export async function createSystemOption(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const category = formData.get('category') as string
  const label = (formData.get('label') as string)?.trim()

  if (!category || !VALID_CATEGORIES.includes(category)) {
    redirect(`/platform-admin/options?message=Invalid category`)
  }
  if (!label) {
    redirect(`/platform-admin/options?category=${category}&message=Label is required`)
  }
  if (label.length > 300) {
    redirect(`/platform-admin/options?category=${category}&message=Label must be 300 characters or fewer`)
  }

  // Check for duplicate system option in this category
  const { data: existing } = await adminClient
    .from('predefined_options')
    .select('id')
    .is('organization_id', null)
    .eq('category', category)
    .eq('label', label)
    .single()

  if (existing) {
    redirect(`/platform-admin/options?category=${category}&message=That option already exists as a system default`)
  }

  // Get next display order for system options in this category
  const { data: last } = await adminClient
    .from('predefined_options')
    .select('display_order')
    .is('organization_id', null)
    .eq('category', category)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (last?.[0]?.display_order ?? 0) + 1

  const { error } = await adminClient
    .from('predefined_options')
    .insert({
      organization_id: null,
      category,
      label,
      display_order: nextOrder,
      is_active: true,
    })

  if (error) {
    redirect(`/platform-admin/options?category=${category}&message=Failed to add option: ${error.message}`)
  }

  redirect(`/platform-admin/options?category=${category}&message=System option added`)
}

export async function deleteSystemOption(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const optionId = formData.get('option_id') as string
  const category = formData.get('category') as string

  // Only delete system defaults (null org_id)
  const { error } = await adminClient
    .from('predefined_options')
    .delete()
    .eq('id', optionId)
    .is('organization_id', null)

  if (error) {
    redirect(`/platform-admin/options?category=${category}&message=Failed to remove option: ${error.message}`)
  }

  redirect(`/platform-admin/options?category=${category}&message=System option removed`)
}

export async function toggleSystemOption(formData: FormData) {
  const { adminClient } = await verifyPlatformAdmin()

  const optionId = formData.get('option_id') as string
  const category = formData.get('category') as string
  const currentActive = formData.get('is_active') === 'true'

  const { error } = await adminClient
    .from('predefined_options')
    .update({ is_active: !currentActive })
    .eq('id', optionId)
    .is('organization_id', null)

  if (error) {
    redirect(`/platform-admin/options?category=${category}&message=Failed to update option`)
  }

  redirect(`/platform-admin/options?category=${category}&message=Option ${!currentActive ? 'enabled' : 'disabled'}`)
}
