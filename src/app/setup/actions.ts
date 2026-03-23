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
  return { adminClient: createAdminClient(), user, profile }
}

// ─── Step 0 → 1: Save diagnostic answers ────────────────────────────────────

export async function saveDiagnostic(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const answers = {
    people_count: formData.get('people_count') as string,
    team_count: formData.get('team_count') as string,
    regular_121s: formData.get('regular_121s') as string,
    track_kpis: formData.get('track_kpis') as string,
    performance_reviews: formData.get('performance_reviews') as string,
    biggest_challenge: formData.get('biggest_challenge') as string,
    project_tracking: formData.get('project_tracking') as string,
  }

  // Upsert — first visit creates, returning visit updates
  const { error } = await adminClient
    .from('setup_progress')
    .upsert({
      organization_id: profile.organization_id,
      diagnostic_answers: answers,
      current_step: 1,
    }, { onConflict: 'organization_id' })

  if (error) redirect('/setup?message=Failed to save diagnostic: ' + error.message)
  redirect('/setup?step=1')
}

// ─── Generic step advancement ────────────────────────────────────────────────

export async function advanceStep(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const nextStep = parseInt(formData.get('next_step') as string, 10)
  if (isNaN(nextStep) || nextStep < 0 || nextStep > 6) redirect('/setup')

  const { error } = await adminClient
    .from('setup_progress')
    .update({ current_step: nextStep })
    .eq('organization_id', profile.organization_id)

  if (error) redirect('/setup?message=Failed to advance: ' + error.message)
  redirect('/setup?step=' + nextStep)
}

// ─── Step 2: Create a team ───────────────────────────────────────────────────

export async function addSetupTeam(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const name = (formData.get('name') as string)?.trim()
  if (!name) redirect('/setup?step=2&message=Team name is required')
  if (name.length > 100) redirect('/setup?step=2&message=Name must be 100 characters or fewer')

  const { error } = await adminClient.from('teams').insert({
    organization_id: profile.organization_id,
    name,
  })

  if (error) redirect('/setup?step=2&message=Failed to create team: ' + error.message)
  redirect('/setup?step=2&message=Team created')
}

export async function removeSetupTeam(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const teamId = formData.get('team_id') as string
  if (!teamId) redirect('/setup?step=2&message=Missing team ID')

  const { error } = await adminClient
    .from('teams')
    .delete()
    .eq('id', teamId)
    .eq('organization_id', profile.organization_id)

  if (error) redirect('/setup?step=2&message=Failed to delete team: ' + error.message)
  redirect('/setup?step=2&message=Team removed')
}

// ─── Step 3: Add a user ──────────────────────────────────────────────────────

export async function addSetupUser(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  const email = (formData.get('email') as string)?.trim()
  const fullName = (formData.get('full_name') as string)?.trim()
  const role = formData.get('role') as string
  const tempPassword = (formData.get('temp_password') as string)?.trim()

  if (!email || !fullName || !role || !tempPassword) {
    redirect('/setup?step=3&message=All fields are required')
  }

  if (!['admin', 'manager', 'contributor'].includes(role)) {
    redirect('/setup?step=3&message=Invalid role selected')
  }

  if (tempPassword.length < 8) {
    redirect('/setup?step=3&message=Password must be at least 8 characters')
  }

  // 1. Create the auth user
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !authUser.user) {
    redirect('/setup?step=3&message=Failed to create user: ' + (authError?.message ?? 'Unknown error'))
  }

  // 2. Create the public.users row
  const { error: profileError } = await adminClient
    .from('users')
    .insert({
      id: authUser.user.id,
      organization_id: profile.organization_id,
      email,
      full_name: fullName,
      role,
    })

  if (profileError) {
    // Roll back auth user on profile failure
    await adminClient.auth.admin.deleteUser(authUser.user.id)
    redirect('/setup?step=3&message=Failed to create user profile: ' + profileError.message)
  }

  redirect('/setup?step=3&message=User added')
}

// ─── Step 4: Save reporting lines ────────────────────────────────────────────

export async function saveReportingLines(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  // Fetch all org users to know which IDs to update
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id')
    .eq('organization_id', profile.organization_id)

  if (!orgUsers) redirect('/setup?step=4&message=Failed to load users')

  const errors: string[] = []

  for (const u of orgUsers) {
    const managerId = (formData.get('manager_' + u.id) as string) || null

    const { error } = await adminClient
      .from('users')
      .update({ manager_id: managerId || null })
      .eq('id', u.id)
      .eq('organization_id', profile.organization_id)

    if (error) errors.push(error.message)
  }

  if (errors.length > 0) {
    redirect('/setup?step=4&message=Some reporting lines failed to save')
  }

  // Advance to step 5
  await adminClient
    .from('setup_progress')
    .update({ current_step: 5 })
    .eq('organization_id', profile.organization_id)

  redirect('/setup?step=5')
}

// ─── Step 5: Add KPIs from catalogue or custom ──────────────────────────────

export async function addSetupKpis(formData: FormData) {
  const { adminClient, profile } = await verifyOrgAdmin()

  // Get selected catalogue KPI IDs (checkboxes)
  const selectedIds = formData.getAll('catalogue_kpi_id') as string[]

  for (const templateId of selectedIds) {
    // Check not already assigned
    const { data: existing } = await adminClient
      .from('kpis')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('template_kpi_id', templateId)
      .single()

    if (existing) continue

    // Load the system template
    const { data: template } = await adminClient
      .from('kpis')
      .select('*')
      .eq('id', templateId)
      .is('organization_id', null)
      .single()

    if (!template) continue

    await adminClient.from('kpis').insert({
      organization_id: profile.organization_id,
      template_kpi_id: templateId,
      name: template.name,
      category: template.category,
      description: template.description,
      unit: template.unit,
      target_value: null,
      target_frequency: template.target_frequency,
      audience: 'everyone',
      display_order: template.display_order ?? 0,
      is_active: true,
    })
  }

  // Handle custom KPI if provided
  const customName = (formData.get('custom_kpi_name') as string)?.trim()
  if (customName) {
    const customUnit = (formData.get('custom_kpi_unit') as string)?.trim() || null
    const customTarget = formData.get('custom_kpi_target') as string

    await adminClient.from('kpis').insert({
      organization_id: profile.organization_id,
      name: customName,
      category: 'other',
      unit: customUnit,
      target_value: customTarget ? parseFloat(customTarget) : null,
      target_frequency: 'monthly',
      audience: 'everyone',
      display_order: 0,
      is_active: true,
    })
  }

  // Advance to step 6
  await adminClient
    .from('setup_progress')
    .update({ current_step: 6 })
    .eq('organization_id', profile.organization_id)

  redirect('/setup?step=6')
}

// ─── Step 6: Complete setup ──────────────────────────────────────────────────

export async function completeSetup() {
  const { adminClient, profile } = await verifyOrgAdmin()

  const { error } = await adminClient
    .from('setup_progress')
    .update({
      is_complete: true,
      completed_at: new Date().toISOString(),
      current_step: 6,
    })
    .eq('organization_id', profile.organization_id)

  if (error) redirect('/setup?step=6&message=Failed to complete setup')
  redirect('/?message=Setup complete')
}
