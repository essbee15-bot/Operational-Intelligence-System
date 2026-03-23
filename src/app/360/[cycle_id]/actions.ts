'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function submitReview(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, manager_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (!profile.manager_id) redirect('/360?message=No manager assigned')

  const adminClient = createAdminClient()
  const cycleId = formData.get('cycle_id') as string
  const managerId = formData.get('manager_id') as string
  if (!cycleId || !managerId) redirect('/360?message=Missing required fields')

  // Verify cycle exists, is open, belongs to org
  const { data: cycle } = await adminClient
    .from('review_cycles')
    .select('id, is_closed, custom_questions')
    .eq('id', cycleId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!cycle) redirect('/360?message=Review cycle not found')
  if (cycle.is_closed) redirect('/360?message=This review cycle has closed')

  // Verify managerId matches user's actual manager
  if (managerId !== profile.manager_id) redirect('/360?message=Invalid manager')

  // Check for duplicate submission (PK will also block it, but check first for better UX)
  const { data: existing } = await adminClient
    .from('review_completions')
    .select('cycle_id')
    .eq('cycle_id', cycleId)
    .eq('user_id', user.id)
    .eq('manager_id', managerId)
    .maybeSingle()

  if (existing) redirect('/360?message=You have already submitted this review')

  // Build answers array
  const coreKeys = ['communication', 'support_development', 'decision_making', 'vision_direction', 'trust_safety']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answers: Array<{ key: string; value: any }> = []

  for (const key of coreKeys) {
    const val = formData.get(key)
    if (val) answers.push({ key, value: Number(val) })
  }

  const openText = (formData.get('open_text') as string)?.trim()
  if (openText) answers.push({ key: 'open_text', value: openText })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customQs = (cycle.custom_questions as any[]) ?? []
  for (const q of customQs) {
    const val = formData.get(q.key as string)
    if (val) {
      answers.push({
        key: q.key as string,
        value: q.type === 'rating_5' ? Number(val) : (val as string).trim(),
      })
    }
  }

  // 1. Insert completion record (composite PK prevents duplicates)
  const { error: compError } = await adminClient
    .from('review_completions')
    .insert({
      cycle_id: cycleId,
      user_id: user.id,
      manager_id: managerId,
    })

  if (compError) redirect('/360?message=You have already submitted this review')

  // 2. Insert anonymous response — NO user_id
  await adminClient
    .from('review_responses')
    .insert({
      cycle_id: cycleId,
      organization_id: profile.organization_id,
      manager_id: managerId,
      answers,
    })

  redirect('/360?message=Thank you! Your review has been recorded anonymously.')
}
