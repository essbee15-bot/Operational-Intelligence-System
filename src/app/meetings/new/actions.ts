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

  const validTypes = ['one_on_one', 'team_meeting', 'project_meeting', 'performance_review']
  if (!validTypes.includes(meetingType)) {
    redirect('/meetings/new?message=Invalid meeting type')
  }
  if (!dateStr) {
    redirect('/meetings/new?message=Date is required')
  }

  // Combine date + time into a timestamp
  const dateTime = new Date(`${dateStr}T${timeStr}:00`)

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string | null
  if (!orgId) {
    redirect('/meetings/new?message=Your account is not linked to an organisation — contact your admin')
  }

  if (meetingType === 'one_on_one') {
    const attendeeId = formData.get('attendee_id') as string | null
    const safeAttendeeId = attendeeId && UUID_RE.test(attendeeId) ? attendeeId : null

    const rawExternal = (formData.get('external_attendees') as string ?? '').trim()
    const externalAttendees = rawExternal.slice(0, 500) || null

    // Auto-detect most recent previous 1:1 between the same two people
    // (regardless of who organised it)
    let previousMeetingId: string | null = null
    if (safeAttendeeId) {
      const { data: prevMeeting } = await adminClient
        .from('meetings')
        .select('id')
        .eq('organization_id', orgId)
        .eq('meeting_type', 'one_on_one')
        .or(`and(organizer_id.eq.${user.id},attendee_id.eq.${safeAttendeeId}),and(organizer_id.eq.${safeAttendeeId},attendee_id.eq.${user.id})`)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      previousMeetingId = prevMeeting?.id ?? null
    }

    // Auto-generate title
    let attendeeName: string | null = null
    if (safeAttendeeId) {
      const { data: attendee } = await adminClient
        .from('users').select('full_name, email').eq('id', safeAttendeeId).single()
      attendeeName = attendee?.full_name ?? attendee?.email ?? null
    } else if (externalAttendees) {
      attendeeName = externalAttendees.split(',')[0]?.trim() ?? null
    }
    const datePart = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const title = attendeeName ? `1:1 — ${attendeeName} — ${datePart}` : `1:1 — ${datePart}`

    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: orgId,
        meeting_type: 'one_on_one',
        title,
        organizer_id: user.id,
        attendee_id: safeAttendeeId,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
        external_attendees: externalAttendees,
      })
      .select('id')
      .single()

    if (error || !meeting) {
      redirect(`/meetings/new?type=one_on_one&message=Failed to create meeting: ${error?.message ?? 'unknown error'}`)
    }

    redirect(`/meetings/${meeting.id}?message=Meeting created`)

  } else if (meetingType === 'performance_review') {
    const attendeeId = formData.get('attendee_id') as string | null
    const safeAttendeeId = attendeeId && UUID_RE.test(attendeeId) ? attendeeId : null

    const rawExternal = (formData.get('external_attendees') as string ?? '').trim()
    const externalAttendees = rawExternal.slice(0, 500) || null

    const reviewPeriod = (formData.get('review_period') as string)?.trim() || null

    // Auto-detect most recent previous review for this employee
    let previousMeetingId: string | null = null
    if (safeAttendeeId) {
      const { data: prevReview } = await adminClient
        .from('meetings')
        .select('id')
        .eq('organization_id', orgId)
        .eq('meeting_type', 'performance_review')
        .eq('attendee_id', safeAttendeeId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      previousMeetingId = prevReview?.id ?? null
    }

    // Auto-generate title
    let attendeeName: string | null = null
    if (safeAttendeeId) {
      const { data: attendee } = await adminClient
        .from('users').select('full_name, email').eq('id', safeAttendeeId).single()
      attendeeName = attendee?.full_name ?? attendee?.email ?? null
    } else if (externalAttendees) {
      attendeeName = externalAttendees.split(',')[0]?.trim() ?? null
    }
    const datePart = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const title = attendeeName
      ? `Review — ${attendeeName} — ${reviewPeriod ?? datePart}`
      : `Review — ${reviewPeriod ?? datePart}`

    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: orgId,
        meeting_type: 'performance_review',
        title,
        organizer_id: user.id,
        attendee_id: safeAttendeeId,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
        review_period: reviewPeriod,
        external_attendees: externalAttendees,
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

    const projectId = meetingType === 'project_meeting'
      ? (formData.get('project_id') as string | null) || null
      : null

    const safeProjectId = projectId && UUID_RE.test(projectId) ? projectId : null

    if (meetingType === 'project_meeting' && !safeProjectId) {
      redirect('/meetings/new?type=project_meeting&message=Please select a project')
    }

    const rawAttendeeIds = formData.getAll('attendee_ids[]') as string[]
    const attendeeIds = rawAttendeeIds.filter(id => UUID_RE.test(id))

    const rawExternal = (formData.get('external_attendees') as string ?? '').trim()
    const externalAttendees = rawExternal.slice(0, 500) || null

    // Auto-detect most recent previous meeting of the same type with overlapping attendees
    // (same organiser, same type — best proxy for a recurring meeting series)
    let previousMeetingId: string | null = null
    if (attendeeIds.length > 0) {
      // Find most recent meeting of same type that shares attendees with this one
      // For project_meeting, scope to the same project so the chain stays per-project
      let prevQuery = adminClient
        .from('meetings')
        .select('id')
        .eq('organization_id', orgId)
        .eq('meeting_type', meetingType)
        .eq('organizer_id', user.id)
      if (meetingType === 'project_meeting' && safeProjectId) {
        prevQuery = prevQuery.eq('project_id', safeProjectId)
      }
      const { data: recentSameType } = await prevQuery
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      previousMeetingId = recentSameType?.id ?? null
    }

    const title = purpose
    const { data: meeting, error } = await adminClient
      .from('meetings')
      .insert({
        organization_id: orgId,
        meeting_type: meetingType,
        title,
        purpose,
        organizer_id: user.id,
        date: dateTime.toISOString(),
        previous_meeting_id: previousMeetingId,
        project_id: safeProjectId,
        external_attendees: externalAttendees,
      })
      .select('id')
      .single()

    if (error || !meeting) {
      redirect(`/meetings/new?type=${meetingType}&message=Failed to create meeting: ${error?.message ?? 'unknown error'}`)
    }

    // Insert attendees
    if (attendeeIds.length > 0) {
      await adminClient
        .from('meeting_attendees')
        .insert(attendeeIds.map(uid => ({ meeting_id: meeting.id, user_id: uid })))
    }

    redirect(`/meetings/${meeting.id}?message=Meeting created`)
  }
}
