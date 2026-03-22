'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function submitResponse(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/')

  const adminClient = createAdminClient()

  const periodId = formData.get('period_id') as string
  const teamId   = formData.get('team_id') as string

  if (!periodId || !teamId) {
    redirect('/surveys?message=Missing required fields')
  }

  // Verify period exists, is open, and belongs to org
  const { data: period } = await adminClient
    .from('pulse_periods')
    .select('id, survey_id, is_closed, pulse_surveys(questions)')
    .eq('id', periodId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!period)          redirect('/surveys?message=Survey period not found')
  if (period.is_closed) redirect('/surveys?message=This survey period has already closed')

  // Verify user is a member of this team
  const { data: membership } = await adminClient
    .from('team_members')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('team_id', teamId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle()

  if (!membership) redirect('/surveys?message=You are not a member of this team')

  // Build answers from formData
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const survey = period.pulse_surveys as unknown as { questions: Array<{ key: string; label: string; type: string; required: boolean }> } | null
  const questions = survey?.questions ?? []

  const answers = questions
    .map(q => {
      const val = formData.get(`answer_${q.key}`)
      return { key: q.key, value: val != null && val !== '' ? String(val) : null }
    })
    .filter((a): a is { key: string; value: string } => a.value !== null)

  // Insert completion record first — PK (period_id, user_id, team_id) prevents duplicate submissions
  const { error: completionError } = await adminClient
    .from('pulse_completions')
    .insert({
      period_id:    periodId,
      user_id:      user.id,
      team_id:      teamId,
      completed_at: new Date().toISOString(),
    })

  if (completionError) {
    // Unique constraint violation → already submitted
    redirect(`/surveys/${periodId}?team=${teamId}&message=You have already submitted a response for this survey`)
  }

  // Insert anonymous response — deliberately NO user_id
  const { error: responseError } = await adminClient
    .from('pulse_responses')
    .insert({
      period_id:       periodId,
      organization_id: profile.organization_id,
      team_id:         teamId,
      answers,
    })

  if (responseError) {
    redirect(`/surveys?message=Failed to save response: ${responseError.message}`)
  }

  redirect('/surveys?message=Thank you! Your response has been recorded anonymously.')
}
