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

// ─── Create survey ────────────────────────────────────────────────────────────

export async function createSurvey(formData: FormData) {
  const { adminClient, user, profile } = await verifyOrgAdmin()

  const name = (formData.get('name') as string)?.trim().slice(0, 200)
  const description = (formData.get('description') as string)?.trim() || null
  const frequency = (formData.get('frequency') as string) || 'monthly'

  const validFrequencies = ['weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc']
  if (!name) redirect('/admin/surveys?message=Survey name is required')
  if (!validFrequencies.includes(frequency)) redirect('/admin/surveys?message=Invalid frequency')

  const { data: survey, error } = await adminClient
    .from('pulse_surveys')
    .insert({
      organization_id: profile.organization_id,
      name,
      description,
      frequency,
      questions: [],
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !survey) {
    redirect(`/admin/surveys?message=Failed to create survey: ${error?.message ?? 'unknown error'}`)
  }
  redirect(`/admin/surveys/${survey.id}?message=Survey created`)
}

// ─── Update survey details ────────────────────────────────────────────────────

export async function updateSurvey(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const surveyId = formData.get('survey_id') as string
  const name = (formData.get('name') as string)?.trim().slice(0, 200)
  const description = (formData.get('description') as string)?.trim() || null
  const frequency = (formData.get('frequency') as string) || 'monthly'

  const validFrequencies = ['weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc']
  if (!name) redirect(`/admin/surveys/${surveyId}?message=Survey name is required`)
  if (!validFrequencies.includes(frequency)) redirect(`/admin/surveys/${surveyId}?message=Invalid frequency`)

  const { error } = await adminClient
    .from('pulse_surveys')
    .update({ name, description, frequency })
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/surveys/${surveyId}?message=Failed to update survey: ${error.message}`)
  redirect(`/admin/surveys/${surveyId}?message=Survey updated`)
}

// ─── Add question to survey ───────────────────────────────────────────────────

export async function addQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const surveyId = formData.get('survey_id') as string
  const label = (formData.get('label') as string)?.trim().slice(0, 300)
  const type = (formData.get('type') as string) || 'rating_5'
  const required = formData.get('required') === 'true'

  const validTypes = ['rating_5', 'rating_10', 'nps', 'yes_no', 'text']
  if (!label) redirect(`/admin/surveys/${surveyId}?message=Question label is required`)
  if (!validTypes.includes(type)) redirect(`/admin/surveys/${surveyId}?message=Invalid question type`)

  const { data: survey } = await adminClient
    .from('pulse_surveys')
    .select('id, questions')
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!survey) redirect('/admin/surveys?message=Survey not found')

  const questions = (survey.questions as Array<{ key: string; label: string; type: string; required: boolean }>) ?? []

  // Generate unique key
  let key = toFieldKey(label)
  let suffix = 1
  while (questions.some(q => q.key === key)) {
    key = `${toFieldKey(label)}_${suffix++}`
  }

  const updated = [...questions, { key, label, type, required }]

  const { error } = await adminClient
    .from('pulse_surveys')
    .update({ questions: updated })
    .eq('id', surveyId)

  if (error) redirect(`/admin/surveys/${surveyId}?message=Failed to add question: ${error.message}`)
  redirect(`/admin/surveys/${surveyId}?message=Question added`)
}

// ─── Remove question from survey ──────────────────────────────────────────────

export async function removeQuestion(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const surveyId = formData.get('survey_id') as string
  const questionKey = formData.get('question_key') as string

  const { data: survey } = await adminClient
    .from('pulse_surveys')
    .select('id, questions')
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!survey) redirect('/admin/surveys?message=Survey not found')

  const questions = (survey.questions as Array<{ key: string }>) ?? []
  const updated = questions.filter(q => q.key !== questionKey)

  const { error } = await adminClient
    .from('pulse_surveys')
    .update({ questions: updated })
    .eq('id', surveyId)

  if (error) redirect(`/admin/surveys/${surveyId}?message=Failed to remove question: ${error.message}`)
  redirect(`/admin/surveys/${surveyId}?message=Question removed`)
}

// ─── Open a new survey period ─────────────────────────────────────────────────

export async function openPeriod(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const surveyId = formData.get('survey_id') as string
  const periodLabel = (formData.get('period_label') as string)?.trim().slice(0, 100)

  if (!periodLabel) redirect(`/admin/surveys/${surveyId}?message=Period label is required`)

  // Verify survey belongs to org
  const { data: survey } = await adminClient
    .from('pulse_surveys')
    .select('id')
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!survey) redirect('/admin/surveys?message=Survey not found')

  const { data: period, error } = await adminClient
    .from('pulse_periods')
    .insert({
      survey_id: surveyId,
      organization_id: profile.organization_id,
      period_label: periodLabel,
      opens_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !period) {
    redirect(`/admin/surveys/${surveyId}?message=Failed to open period: ${error?.message ?? 'unknown error'}`)
  }
  redirect(`/admin/surveys/${surveyId}?period=${period.id}&message=Period opened`)
}

// ─── Close a survey period ────────────────────────────────────────────────────

export async function closePeriod(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const periodId = formData.get('period_id') as string
  const surveyId = formData.get('survey_id') as string

  // Verify period belongs to org
  const { data: period } = await adminClient
    .from('pulse_periods')
    .select('id')
    .eq('id', periodId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!period) redirect('/admin/surveys?message=Period not found')

  const { error } = await adminClient
    .from('pulse_periods')
    .update({ is_closed: true, closes_at: new Date().toISOString() })
    .eq('id', periodId)

  if (error) redirect(`/admin/surveys/${surveyId}?message=Failed to close period: ${error.message}`)
  redirect(`/admin/surveys/${surveyId}?message=Period closed`)
}

// ─── Toggle survey active/inactive ───────────────────────────────────────────

export async function toggleSurveyActive(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const surveyId = formData.get('survey_id') as string
  const isActive = formData.get('is_active') === 'true'

  const { error } = await adminClient
    .from('pulse_surveys')
    .update({ is_active: !isActive })
    .eq('id', surveyId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect(`/admin/surveys/${surveyId}?message=Failed to update survey: ${error.message}`)
  redirect(`/admin/surveys/${surveyId}?message=${isActive ? 'Survey deactivated' : 'Survey activated'}`)
}
