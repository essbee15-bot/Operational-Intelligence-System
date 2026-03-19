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

  if (!profile || profile.role !== 'admin') redirect('/')
  return { user, profile, adminClient: createAdminClient() }
}

export async function saveAiSettings(formData: FormData) {
  const { profile, adminClient } = await verifyOrgAdmin()
  const orgId = profile.organization_id as string

  const provider       = (formData.get('provider') as string) || 'openai'
  const model          = (formData.get('model') as string) || 'gpt-4o-mini'
  const apiKey         = (formData.get('api_key') as string)?.trim() || null
  const isEnabled      = formData.get('is_enabled') === 'true'

  const embeddingModel = provider === 'openai' ? 'text-embedding-3-small' : 'none'

  const { error } = await adminClient
    .from('ai_settings')
    .upsert({
      organization_id: orgId,
      provider,
      model,
      api_key:         apiKey,
      is_enabled:      isEnabled,
      embedding_model: embeddingModel,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'organization_id' })

  if (error) {
    redirect('/admin/ai?message=Failed to save settings.')
  }

  redirect('/admin/ai?message=AI settings saved.')
}
