'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function verifyMeetingAccess(meetingId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const adminClient = createAdminClient()
  const { data: meeting } = await adminClient
    .from('meetings')
    .select('id, organization_id')
    .eq('id', meetingId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!meeting) redirect('/meetings?message=Meeting not found')
  return { adminClient, user, profile, meeting }
}

// ─── Notes / free-text sections ──────────────────────────────────────────────

export async function saveMeetingNotes(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  const updates: Record<string, string | null> = {}
  const fields = [
    'general_notes', 'outcomes', 'aob_notes', 'kpi_notes',
    'development_requests', 'project_involvement_notes', 'tests_experiments_notes',
    'purpose', 'goals_next_period',
    'performance_reasons', 'success_failure_surprises',
  ]
  for (const f of fields) {
    const val = formData.get(f) as string | null
    if (val !== null) updates[f] = val.slice(0, 2000) || null
  }

  const { error } = await adminClient
    .from('meetings')
    .update(updates)
    .eq('id', meetingId)

  if (error) {
    redirect(`/meetings/${meetingId}?message=Failed to save notes: ${error.message}`)
  }
  redirect(`/meetings/${meetingId}?message=Notes saved`)
}

// ─── Scoring (1:1 only) ───────────────────────────────────────────────────────

export async function saveScores(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  const selfScore = parseInt(formData.get('self_score') as string)
  const managerScore = parseInt(formData.get('manager_score') as string)
  const adjustedScore = parseInt(formData.get('adjusted_score') as string)

  const scoreObj = {
    meeting_id: meetingId,
    self_score: isNaN(selfScore) ? null : selfScore,
    manager_score: isNaN(managerScore) ? null : managerScore,
    adjusted_score: isNaN(adjustedScore) ? null : adjustedScore,
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminClient
    .from('one_on_one_scores')
    .upsert(scoreObj, { onConflict: 'meeting_id' })

  if (error) {
    redirect(`/meetings/${meetingId}?message=Failed to save scores: ${error.message}`)
  }
  redirect(`/meetings/${meetingId}?message=Scores saved`)
}

// ─── Action items ─────────────────────────────────────────────────────────────

export async function addAction(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  const actionText = (formData.get('action_text') as string)?.trim().slice(0, 300)
  const ownerId = (formData.get('owner_id') as string) || null
  const dueDate = (formData.get('due_date') as string) || null

  // Risk fields (JSONB with selected + notes)
  const riskBlockersSelected = formData.get('risk_blockers_selected') as string
  const riskBlockersNotes = (formData.get('risk_blockers_notes') as string)?.trim().slice(0, 300)
  const riskSupportSelected = formData.get('risk_support_selected') as string
  const riskSupportNotes = (formData.get('risk_support_notes') as string)?.trim().slice(0, 300)
  const riskMitigationSelected = formData.get('risk_mitigation_selected') as string
  const riskMitigationNotes = (formData.get('risk_mitigation_notes') as string)?.trim().slice(0, 300)

  if (!actionText) {
    redirect(`/meetings/${meetingId}?message=Action text is required`)
  }

  const toJsonb = (selected: string, notes: string) =>
    (selected || notes) ? JSON.stringify({ selected: selected || null, notes: notes || null }) : null

  const { error } = await adminClient
    .from('action_items')
    .insert({
      organization_id: profile.organization_id,
      meeting_id: meetingId,
      title: actionText,
      action_text: actionText,
      assignee_id: ownerId,
      due_date: dueDate || null,
      risk_blockers: toJsonb(riskBlockersSelected, riskBlockersNotes),
      risk_support: toJsonb(riskSupportSelected, riskSupportNotes),
      risk_mitigation: toJsonb(riskMitigationSelected, riskMitigationNotes),
      status: 'pending',
      is_closed: false,
    })

  if (error) {
    redirect(`/meetings/${meetingId}?message=Failed to add action: ${error.message}`)
  }
  redirect(`/meetings/${meetingId}?message=Action added`)
}

export async function removeAction(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const actionId = formData.get('action_id') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  await adminClient
    .from('action_items')
    .delete()
    .eq('id', actionId)
    .eq('organization_id', profile.organization_id)

  redirect(`/meetings/${meetingId}?message=Action removed`)
}

// ─── Action reviews (carry-forward) ──────────────────────────────────────────

export async function reviewAction(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const actionId = formData.get('action_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  const outcome = formData.get('outcome') as string
  if (!['complete', 'ongoing', 'missed'].includes(outcome)) {
    redirect(`/meetings/${meetingId}?message=Invalid outcome`)
  }

  const wentWellSelected = formData.get('went_well_selected') as string
  const wentWellNotes = (formData.get('went_well_notes') as string)?.trim().slice(0, 300)
  const wentBadlySelected = formData.get('went_badly_selected') as string
  const wentBadlyNotes = (formData.get('went_badly_notes') as string)?.trim().slice(0, 300)
  const learnedSelected = formData.get('learned_selected') as string
  const learnedNotes = (formData.get('learned_notes') as string)?.trim().slice(0, 300)

  const toJsonb = (selected: string, notes: string) =>
    (selected || notes) ? JSON.stringify({ selected: selected || null, notes: notes || null }) : null

  // Insert review record
  const { error: reviewError } = await adminClient
    .from('action_reviews')
    .insert({
      action_id: actionId,
      meeting_id: meetingId,
      outcome,
      went_well: toJsonb(wentWellSelected, wentWellNotes),
      went_badly: toJsonb(wentBadlySelected, wentBadlyNotes),
      learned: toJsonb(learnedSelected, learnedNotes),
    })

  if (reviewError) {
    redirect(`/meetings/${meetingId}?message=Failed to save review: ${reviewError.message}`)
  }

  // Close the action if complete or missed
  if (outcome === 'complete' || outcome === 'missed') {
    await adminClient
      .from('action_items')
      .update({ is_closed: true, status: outcome === 'complete' ? 'completed' : 'in_progress' })
      .eq('id', actionId)
  }

  redirect(`/meetings/${meetingId}?message=Action reviewed`)
}

// ─── Agenda items ─────────────────────────────────────────────────────────────

export async function addAgendaItem(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  const content = (formData.get('content') as string)?.trim().slice(0, 300)
  if (!content) {
    redirect(`/meetings/${meetingId}?message=Agenda item cannot be empty`)
  }

  // Get next order
  const { data: existing } = await adminClient
    .from('agenda_items')
    .select('display_order')
    .eq('meeting_id', meetingId)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.display_order ?? 0) + 1

  await adminClient.from('agenda_items').insert({ meeting_id: meetingId, content, display_order: nextOrder })
  redirect(`/meetings/${meetingId}?message=Agenda item added`)
}

export async function removeAgendaItem(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const itemId = formData.get('item_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  await adminClient.from('agenda_items').delete().eq('id', itemId)
  redirect(`/meetings/${meetingId}?message=Agenda item removed`)
}

// ─── Milestones (project meetings) ────────────────────────────────────────────

export async function addMilestone(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  const milestoneText = (formData.get('milestone_text') as string)?.trim().slice(0, 300)
  const ownerId = (formData.get('owner_id') as string) || null
  const expectedDate = (formData.get('expected_date') as string) || null

  if (!milestoneText) {
    redirect(`/meetings/${meetingId}?message=Milestone text is required`)
  }

  const { data: existing } = await adminClient
    .from('milestones')
    .select('display_order')
    .eq('meeting_id', meetingId)
    .order('display_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.display_order ?? 0) + 1

  await adminClient.from('milestones').insert({
    organization_id: profile.organization_id,
    meeting_id: meetingId,
    milestone_text: milestoneText,
    owner_id: ownerId,
    expected_date: expectedDate || null,
    display_order: nextOrder,
  })

  redirect(`/meetings/${meetingId}?message=Milestone added`)
}

export async function updateMilestoneStatus(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const milestoneId = formData.get('milestone_id') as string
  const status = formData.get('status') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  await adminClient
    .from('milestones')
    .update({ status })
    .eq('id', milestoneId)
    .eq('organization_id', profile.organization_id)

  redirect(`/meetings/${meetingId}?message=Milestone updated`)
}

export async function removeMilestone(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const milestoneId = formData.get('milestone_id') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  await adminClient
    .from('milestones')
    .delete()
    .eq('id', milestoneId)
    .eq('organization_id', profile.organization_id)

  redirect(`/meetings/${meetingId}?message=Milestone removed`)
}

// ─── Performance review overview (review_period + overall_rating) ─────────────

const VALID_RATINGS = ['exceeds', 'meets', 'development_required', 'unsatisfactory']

export async function saveReviewOverview(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient } = await verifyMeetingAccess(meetingId)

  const reviewPeriod = (formData.get('review_period') as string)?.trim() || null
  const overallRating = (formData.get('overall_rating') as string) || null

  if (overallRating && !VALID_RATINGS.includes(overallRating)) {
    redirect(`/meetings/${meetingId}?message=Invalid rating value`)
  }

  const { error } = await adminClient
    .from('meetings')
    .update({ review_period: reviewPeriod, overall_rating: overallRating })
    .eq('id', meetingId)

  if (error) {
    redirect(`/meetings/${meetingId}?message=Failed to save review overview: ${error.message}`)
  }
  redirect(`/meetings/${meetingId}?message=Review overview saved`)
}

// ─── Custom field values (for /admin/fields field_definitions) ────────────────

export async function saveCustomFieldValue(formData: FormData) {
  const meetingId = formData.get('meeting_id') as string
  const { adminClient, profile } = await verifyMeetingAccess(meetingId)

  const fieldKey = (formData.get('field_key') as string)?.trim()
  const value = (formData.get('value') as string) ?? ''

  if (!fieldKey) {
    redirect(`/meetings/${meetingId}?message=Field key is required`)
  }

  // Confirm the field definition exists for this org + entity_type='meeting'
  const { data: fieldDef } = await adminClient
    .from('field_definitions')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('entity_type', 'meeting')
    .eq('field_key', fieldKey)
    .single()

  if (!fieldDef) {
    redirect(`/meetings/${meetingId}?message=Custom field not found`)
  }

  const { error } = await adminClient
    .from('field_values')
    .upsert(
      {
        organization_id: profile.organization_id,
        entity_type: 'meeting',
        entity_id: meetingId,
        field_key: fieldKey,
        value: value || null,
      },
      { onConflict: 'organization_id,entity_type,entity_id,field_key' }
    )

  if (error) {
    redirect(`/meetings/${meetingId}?message=Failed to save custom field: ${error.message}`)
  }
  redirect(`/meetings/${meetingId}?message=Field saved`)
}
