'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

function toFieldKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

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

export async function createField(formData: FormData) {
  const { supabase, profile } = await verifyOrgAdmin()

  const entityType = formData.get('entity_type') as string
  const label = (formData.get('label') as string)?.trim()
  const fieldType = formData.get('field_type') as string
  const isRequired = formData.get('is_required') === 'on'
  const optionsRaw = (formData.get('options') as string)?.trim()

  if (!entityType || !label || !fieldType) {
    redirect(`/admin/fields?entity=${entityType}&message=All fields are required`)
  }

  const validEntities = ['user', 'meeting', 'project', 'kpi']
  const validTypes = ['text', 'number', 'date', 'select', 'textarea', 'checkbox']

  if (!validEntities.includes(entityType) || !validTypes.includes(fieldType)) {
    redirect(`/admin/fields?entity=${entityType}&message=Invalid entity or field type`)
  }

  const fieldKey = toFieldKey(label)
  if (!fieldKey) {
    redirect(`/admin/fields?entity=${entityType}&message=Label must contain at least one letter or number`)
  }

  const options = fieldType === 'select'
    ? optionsRaw?.split(',').map(o => o.trim()).filter(Boolean)
    : []

  // Get max display_order
  const { data: existing } = await supabase
    .from('field_definitions')
    .select('display_order')
    .eq('organization_id', profile.organization_id)
    .eq('entity_type', entityType)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.display_order ?? -1) + 1

  const { error } = await supabase
    .from('field_definitions')
    .insert({
      organization_id: profile.organization_id,
      entity_type: entityType,
      label,
      field_key: fieldKey,
      field_type: fieldType,
      options: options ?? [],
      is_required: isRequired,
      display_order: nextOrder,
    })

  if (error) {
    const msg = error.code === '23505'
      ? `A field with key "${fieldKey}" already exists for this entity type`
      : `Failed to create field: ${error.message}`
    redirect(`/admin/fields?entity=${entityType}&message=${msg}`)
  }

  redirect(`/admin/fields?entity=${entityType}&message=Field "${label}" added successfully`)
}

export async function deleteField(formData: FormData) {
  const { supabase, profile } = await verifyOrgAdmin()

  const fieldId = formData.get('field_id') as string
  const entityType = formData.get('entity_type') as string

  const { error } = await supabase
    .from('field_definitions')
    .delete()
    .eq('id', fieldId)
    .eq('organization_id', profile.organization_id)

  if (error) {
    redirect(`/admin/fields?entity=${entityType}&message=Failed to delete field: ${error.message}`)
  }

  redirect(`/admin/fields?entity=${entityType}&message=Field removed successfully`)
}

export async function updateField(formData: FormData) {
  const { supabase, profile } = await verifyOrgAdmin()

  const fieldId = formData.get('field_id') as string
  const entityType = formData.get('entity_type') as string
  const label = (formData.get('label') as string)?.trim()
  const fieldType = formData.get('field_type') as string
  const isRequired = formData.get('is_required') === 'on'
  const optionsRaw = (formData.get('options') as string)?.trim()

  if (!label || !fieldType) {
    redirect(`/admin/fields?entity=${entityType}&message=All fields are required`)
  }

  const options = fieldType === 'select'
    ? optionsRaw?.split(',').map(o => o.trim()).filter(Boolean)
    : []

  const { error } = await supabase
    .from('field_definitions')
    .update({ label, field_type: fieldType, options: options ?? [], is_required: isRequired })
    .eq('id', fieldId)
    .eq('organization_id', profile.organization_id)

  if (error) {
    redirect(`/admin/fields?entity=${entityType}&message=Failed to update field: ${error.message}`)
  }

  redirect(`/admin/fields?entity=${entityType}&message=Field updated successfully`)
}
