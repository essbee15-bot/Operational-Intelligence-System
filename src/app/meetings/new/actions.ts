'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function createMeeting(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const meetingType = formData.get('meeting_type') as string
  const dateStr = formData.get('date') as string
  const timeStr = (formData.get('time') as string) ?? '09:00'
  const previousMeetingId = (formData.get('previous_meeting_id') as string) || null

  const validTypes = ['one_on_one', 'team_meeting', 'project_meeting', 'performance_review']
  if (!validTypes.includes(meetingType)) {
    redirect('/meetings/new?message=Invalid meeting type')
  }
  if (!dateStr) {
    redirect('/meetings/new?message=Date is required')
  }

  // Combine date + time into a timestamp
  const dateTime = new Date(`${dateStr}T${timeStr}:00`)

  const adminClient = createAdminClient()

  if (meetingType === 'one_on_one') {
    const attendeeId = formData.get('attendee_id') as string
    if (!attendeeId) {
      redirect('/meetings/new?type=one_on_one&message=Please select an employee')
    }

    // Auto-generate title
    const { data: attendee } = await adminClient
      .from('users')
      .select('full_name, email')
      .eq('id', attendeeId)
      .single()

    const attendeeName = attendee?.full_name ?? attendee?.email ?? 'Employee'
    const title = `1:1 — ${attendeeName} — ${new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: profile.organization_id,
        meeting_type: 'one_on_one',
        title,
        organizer_id: user.id,
        attendee_id: attendeeId,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
      })
      .select('id')
      .single()

    if (error || !meeting) {
      redirect(`/meetings/new?type=one_on_one&message=Failed to create meeting: ${error?.message ?? 'unknown error'}`)
    }

    redirect(`/meetings/${meeting.id}?message=Meeting created`)

  } else if (meetingType === 'performance_review') {
    const attendeeId = formData.get('attendee_id') as string
    if (!attendeeId) {
      redirect('/meetings/new?type=performance_review&message=Please select an employee')
    }

    const reviewPeriod = (formData.get('review_period') as string)?.trim() || null

    // Auto-generate title
    const { data: attendee } = await adminClient
      .from('users')
      .select('full_name, email')
      .eq('id', attendeeId)
      .single()

    const attendeeName = attendee?.full_name ?? attendee?.email ?? 'Employee'
    const datePart = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const title = `Review — ${attendeeName} — ${reviewPeriod ?? datePart}`

    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: profile.organization_id,
        meeting_type: 'performance_review',
        title,
        organizer_id: user.id,
        attendee_id: attendeeId,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
        review_period: reviewPeriod,
      })
      .select('id')
      .single()

    if (error || !meeting) {
      redirect(`/meetings/new?type=performance_review&message=Failed to create review: ${error?.message ?? 'unknown error'}`)
    }

    redirect(`/meetings/${meeting.id}?message=Review created`)

  } else {
    // team_meeting or project_meeting
    const purpose = (formData.get('purpose') as string)?.trim().slice(0, 300)
    if (!purpose) {
      redirect(`/meetings/new?type=${meetingType}&message=Purpose is required`)
    }

    const title = purpose
    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: profile.organization_id,
        meeting_type: meetingType,
        title,
        purpose,
        organizer_id: user.id,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
      })
      .select('id')
      .single()

    if (error || !meeting) {
      redirect(`/meetings/new?type=${meetingType}&message=Failed to create meeting: ${error?.message ?? 'unknown error'}`)
    }

    // Insert attendees
    const attendeeIds = formData.getAll('attendee_ids[]') as string[]
    if (attendeeIds.length > 0) {
      await adminClient
        .from('meeting_attendees')
        .insert(attendeeIds.map(uid => ({ meeting_id: meeting.id, user_id: uid })))
    }

    redirect(`/meetings/${meeting.id}?message=Meeting created`)
  }
}
