'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

async function verifyPlatformAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')
  return user
}

export async function platformEditUser(formData: FormData) {
  const performer = await verifyPlatformAdmin()

  const targetUserId = formData.get('user_id') as string
  const fullName = (formData.get('full_name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const role = formData.get('role') as string

  if (!targetUserId || !fullName || !email || !role) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=All fields are required`)
  }

  if (!['admin', 'manager', 'contributor'].includes(role)) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=Invalid role`)
  }

  const adminClient = createAdminClient()

  const { data: currentProfile } = await adminClient
    .from('users')
    .select('full_name, email, role, organization_id')
    .eq('id', targetUserId)
    .single()

  if (!currentProfile) redirect('/platform-admin/users?message=User not found')

  const { error: authError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    email,
    user_metadata: { full_name: fullName },
  })

  if (authError) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=Failed to update: ${authError.message}`)
  }

  const { error: profileError } = await adminClient
    .from('users')
    .update({ full_name: fullName, email, role })
    .eq('id', targetUserId)

  if (profileError) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=Failed to update profile: ${profileError.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: currentProfile.organization_id,
    performed_by: performer.id,
    action: 'user_updated',
    target_type: 'user',
    target_id: targetUserId,
    target_name: fullName,
    details: {
      old: { full_name: currentProfile.full_name, email: currentProfile.email, role: currentProfile.role },
      new: { full_name: fullName, email, role },
    },
  })

  redirect(`/platform-admin/users?message=${fullName} updated successfully`)
}

export async function platformResetPassword(formData: FormData) {
  const performer = await verifyPlatformAdmin()

  const targetUserId = formData.get('user_id') as string
  const newPassword = (formData.get('new_password') as string)?.trim()

  if (!newPassword || newPassword.length < 8) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=Password must be at least 8 characters`)
  }

  const adminClient = createAdminClient()

  const { data: targetProfile } = await adminClient
    .from('users')
    .select('full_name, organization_id')
    .eq('id', targetUserId)
    .single()

  if (!targetProfile) redirect('/platform-admin/users?message=User not found')

  const { error } = await adminClient.auth.admin.updateUserById(targetUserId, { password: newPassword })

  if (error) {
    redirect(`/platform-admin/users/${targetUserId}/edit?message=Failed to reset password: ${error.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: targetProfile.organization_id,
    performed_by: performer.id,
    action: 'password_reset',
    target_type: 'user',
    target_id: targetUserId,
    target_name: targetProfile.full_name,
    details: { reset_by: 'platform_admin' },
  })

  redirect(`/platform-admin/users/${targetUserId}/edit?message=Password reset successfully`)
}

export async function platformRemoveUser(formData: FormData) {
  const performer = await verifyPlatformAdmin()

  const targetUserId = formData.get('user_id') as string

  if (targetUserId === performer.id) {
    redirect('/platform-admin/users?message=You cannot remove your own account')
  }

  const adminClient = createAdminClient()

  const { data: targetProfile } = await adminClient
    .from('users')
    .select('full_name, email, role, organization_id')
    .eq('id', targetUserId)
    .single()

  if (!targetProfile) redirect('/platform-admin/users?message=User not found')

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
    organization_id: targetProfile.organization_id,
    performed_by: performer.id,
    action: 'user_anonymised',
    target_type: 'user',
    target_id: targetUserId,
    target_name: targetProfile.full_name,
    details: { original_email: targetProfile.email, role: targetProfile.role, removed_by: 'platform_admin' },
  })

  redirect(`/platform-admin/users?message=${targetProfile.full_name} has been removed and their data anonymised`)
}
