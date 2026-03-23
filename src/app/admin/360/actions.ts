'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
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
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/?message=Unauthorised')
  return { adminClient: createAdminClient(), user, profile }
}

// ─── Create review cycle ───────────────────────────────────────────────────────

export async function createCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const opensAtRaw = (formData.get('opens_at') as string)?.trim()
  const opens_at = opensAtRaw || new Date().toISOString()

  if (!name) redirect('/admin/360?message=Name is required')

  const { data: cycle, error } = await adminClient
    .from('review_cycles')
    .insert({
      organization_id: profile.organization_id,
      name,
      description,
      opens_at,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !cycle) {
    redirect('/admin/360?message=Failed to create cycle')
  }
  redirect(`/admin/360/${cycle.id}?message=Cycle created`)
}

// ─── Close review cycle ────────────────────────────────────────────────────────

export async function closeCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string

  await adminClient
    .from('review_cycles')
    .update({ is_closed: true, closes_at: new Date().toISOString() })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Cycle closed`)
}

// ─── Reopen review cycle ───────────────────────────────────────────────────────

export async function reopenCycle(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string

  await adminClient
    .from('review_cycles')
    .update({ is_closed: false, closes_at: null })
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)

  redirect(`/admin/360/${cycleId}?message=Cycle reopened`)
}

// ─── Add custom question to cycle ─────────────────────────────────────────────

export async function addCustomQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string
  const label = (formData.get('label') as string)?.trim()
  const type = (formData.get('type') as string) || 'rating_5'

  const validTypes = ['rating_5', 'text']
  if (!label) redirect(`/admin/360/${cycleId}?message=Question label is required`)
  if (!validTypes.includes(type)) redirect(`/admin/360/${cycleId}?message=Invalid question type`)

  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('id, custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/admin/360?message=Cycle not found')

  const questions = (cycle.custom_questions as Array<{ key: string; label: string; type: string; required: boolean }>) ?? []

  if (questions.length >= 3) {
    redirect(`/admin/360/${cycleId}?message=Maximum 3 custom questions`)
  }

  // Generate unique key
  let key = toFieldKey(label)
  let suffix = 1
  while (questions.some(q => q.key === key)) {
    key = `${toFieldKey(label)}_${suffix++}`
  }

  const updated = [...questions, { key, label, type, required: false }]

  const { error } = await adminClient
    .from('review_cycles')
    .update({ custom_questions: updated })
    .eq('id', cycleId)

  if (error) redirect(`/admin/360/${cycleId}?message=Failed to add question: ${error.message}`)
  redirect(`/admin/360/${cycleId}?message=Question added`)
}

// ─── Remove custom question from cycle ────────────────────────────────────────

export async function removeCustomQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const cycleId = formData.get('cycle_id') as string
  const questionKey = formData.get('question_key') as string

  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('id, custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/admin/360?message=Cycle not found')

  const questions = (cycle.custom_questions as Array<{ key: string }>) ?? []
  const updated = questions.filter(q => q.key !== questionKey)

  const { error } = await adminClient
    .from('review_cycles')
    .update({ custom_questions: updated })
    .eq('id', cycleId)

  if (error) redirect(`/admin/360/${cycleId}?message=Failed to remove question: ${error.message}`)
  redirect(`/admin/360/${cycleId}?message=Question removed`)
}
