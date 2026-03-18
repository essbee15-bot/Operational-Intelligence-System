'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

export async function removeUser(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') {
    redirect('/?message=Unauthorised')
  }

  const targetUserId = formData.get('user_id') as string

  if (targetUserId === user.id) {
    redirect('/admin/users?message=You cannot remove your own account')
  }

  const { data: targetProfile } = await supabase
    .from('users')
    .select('organization_id, full_name')
    .eq('id', targetUserId)
    .eq('organization_id', adminProfile.organization_id)
    .single()

  if (!targetProfile) {
    redirect('/admin/users?message=User not found')
  }

  const adminClient = createAdminClient()
  const anonymisedEmail = `leaver-${targetUserId}@deleted.invalid`

  // 1. Anonymise the public profile
  await adminClient
    .from('users')
    .update({
      full_name: 'Leaver',
      email: anonymisedEmail,
      manager_id: null,
      is_anonymised: true,
      anonymised_at: new Date().toISOString(),
    })
    .eq('id', targetUserId)

  // 2. Clear manager_id for anyone who reported to this person
  await adminClient
    .from('users')
    .update({ manager_id: null })
    .eq('manager_id', targetUserId)

  // 3. Disable the auth account (random password + ban)
  await adminClient.auth.admin.updateUserById(targetUserId, {
    email: anonymisedEmail,
    password: crypto.randomUUID() + crypto.randomUUID(),
    ban_duration: '876000h',
  })

  // 4. Audit log
  await adminClient.from('audit_logs').insert({
    organization_id: adminProfile.organization_id,
    performed_by: user.id,
    action: 'user_anonymised',
    target_type: 'user',
    target_id: targetUserId,
    target_name: targetProfile.full_name,
    details: { removed_by: 'org_admin', note: 'Personal data wiped, activity data retained' },
  })

  redirect(`/admin/users?message=${targetProfile.full_name} has been removed and their data anonymised`)
}

/**
 * Creates a new user within the org admin's organisation.
 * Only callable by authenticated org admins.
 */
export async function createUser(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify caller is an org admin and get their org
  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') {
    redirect('/?message=Unauthorised')
  }

  const email = (formData.get('email') as string)?.trim()
  const fullName = (formData.get('full_name') as string)?.trim()
  const role = formData.get('role') as string
  const managerId = (formData.get('manager_id') as string) || null
  const tempPassword = formData.get('temp_password') as string

  if (!email || !fullName || !role || !tempPassword) {
    redirect('/admin/users?message=All fields are required')
  }

  if (!['admin', 'manager', 'contributor'].includes(role)) {
    redirect('/admin/users?message=Invalid role selected')
  }

  const adminClient = createAdminClient()

  // 1. Create the auth user
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !authUser.user) {
    redirect(`/admin/users?message=Failed to create user: ${authError?.message}`)
  }

  // 2. Create the user profile in the same organisation
  const { error: profileError } = await adminClient
    .from('users')
    .insert({
      id: authUser.user.id,
      organization_id: adminProfile.organization_id,
      email,
      full_name: fullName,
      role,
      manager_id: managerId || null,
    })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUser.user.id)
    redirect(`/admin/users?message=Failed to create user profile: ${profileError.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: adminProfile.organization_id,
    performed_by: user.id,
    action: 'user_created',
    target_type: 'user',
    target_id: authUser.user.id,
    target_name: fullName,
    details: { email, role },
  })

  redirect(`/admin/users?message=User "${email}" created successfully`)
}

/**
 * Resets a user's password within the org admin's organisation.
 */
export async function resetUserPassword(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/?message=Unauthorised')

  const targetUserId = formData.get('user_id') as string
  const newPassword = (formData.get('new_password') as string)?.trim()

  if (!newPassword || newPassword.length < 8) {
    redirect(`/admin/users/${targetUserId}/edit?message=Password must be at least 8 characters`)
  }

  const { data: targetProfile } = await supabase
    .from('users')
    .select('organization_id, full_name')
    .eq('id', targetUserId)
    .eq('organization_id', adminProfile.organization_id)
    .single()

  if (!targetProfile) redirect('/admin/users?message=User not found')

  const adminClient = createAdminClient()

  const { error } = await adminClient.auth.admin.updateUserById(targetUserId, { password: newPassword })

  if (error) {
    redirect(`/admin/users/${targetUserId}/edit?message=Failed to reset password: ${error.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: adminProfile.organization_id,
    performed_by: user.id,
    action: 'password_reset',
    target_type: 'user',
    target_id: targetUserId,
    target_name: targetProfile.full_name,
    details: { reset_by: 'org_admin' },
  })

  redirect(`/admin/users/${targetUserId}/edit?message=Password reset successfully for ${targetProfile.full_name}`)
}

/**
 * Updates an existing user's profile within the org admin's organisation.
 * Only callable by authenticated org admins.
 */
export async function updateUser(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') {
    redirect('/?message=Unauthorised')
  }

  const targetUserId = formData.get('user_id') as string
  const fullName = (formData.get('full_name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const role = formData.get('role') as string
  const managerId = (formData.get('manager_id') as string) || null

  if (!targetUserId || !fullName || !email || !role) {
    redirect(`/admin/users/${targetUserId}/edit?message=All fields are required`)
  }

  if (!['admin', 'manager', 'contributor'].includes(role)) {
    redirect(`/admin/users/${targetUserId}/edit?message=Invalid role selected`)
  }

  // Verify the target user belongs to the admin's org (prevent cross-org edits)
  const { data: targetProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', targetUserId)
    .single()

  if (!targetProfile || targetProfile.organization_id !== adminProfile.organization_id) {
    redirect('/admin/users?message=User not found')
  }

  const adminClient = createAdminClient()

  // Update auth email if changed
  const { error: authError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    email,
    user_metadata: { full_name: fullName },
  })

  if (authError) {
    redirect(`/admin/users/${targetUserId}/edit?message=Failed to update email: ${authError.message}`)
  }

  // Update profile
  const { error: profileError } = await adminClient
    .from('users')
    .update({
      full_name: fullName,
      email,
      role,
      manager_id: managerId || null,
    })
    .eq('id', targetUserId)
    .eq('organization_id', adminProfile.organization_id)

  if (profileError) {
    redirect(`/admin/users/${targetUserId}/edit?message=Failed to update profile: ${profileError.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: adminProfile.organization_id,
    performed_by: user.id,
    action: 'user_updated',
    target_type: 'user',
    target_id: targetUserId,
    target_name: fullName,
    details: {
      old: { role: targetProfile.role },
      new: { full_name: fullName, email, role, manager_id: managerId },
    },
  })

  redirect(`/admin/users?message=${fullName} updated successfully`)
}
