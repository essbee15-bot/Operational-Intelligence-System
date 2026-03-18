'use server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'

/**
 * Creates a new organisation and its first admin user.
 * Only callable by authenticated platform admins (enforced by middleware + this check).
 */
export async function createOrganisationAndAdmin(formData: FormData) {
  // Verify the caller is a platform admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) {
    redirect('/')
  }

  const orgName = (formData.get('org_name') as string)?.trim()
  const adminEmail = (formData.get('admin_email') as string)?.trim()
  const adminFullName = (formData.get('admin_full_name') as string)?.trim()
  const tempPassword = formData.get('temp_password') as string

  if (!orgName || !adminEmail || !adminFullName || !tempPassword) {
    redirect('/platform-admin?message=All fields are required')
  }

  const adminClient = createAdminClient()

  // 1. Create the organisation
  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single()

  if (orgError || !org) {
    redirect(`/platform-admin?message=Failed to create organisation: ${orgError?.message}`)
  }

  // 2. Create the auth user with a confirmed email (so they can log in immediately)
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email: adminEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: adminFullName },
  })

  if (authError || !authUser.user) {
    // Roll back the org if auth user creation fails
    await adminClient.from('organizations').delete().eq('id', org.id)
    redirect(`/platform-admin?message=Failed to create admin user: ${authError?.message}`)
  }

  // 3. Create the user profile
  const { error: profileError } = await adminClient
    .from('users')
    .insert({
      id: authUser.user.id,
      organization_id: org.id,
      email: adminEmail,
      full_name: adminFullName,
      role: 'admin',
    })

  if (profileError) {
    // Roll back both if profile creation fails
    await adminClient.auth.admin.deleteUser(authUser.user.id)
    await adminClient.from('organizations').delete().eq('id', org.id)
    redirect(`/platform-admin?message=Failed to create user profile: ${profileError.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: org.id,
    performed_by: user.id,
    action: 'org_created',
    target_type: 'organization',
    target_id: org.id,
    target_name: orgName,
    details: { admin_email: adminEmail },
  })

  redirect(`/platform-admin?message=Organisation "${orgName}" and admin "${adminEmail}" created successfully`)
}

/**
 * Creates a new platform admin account (no organisation).
 * Only callable by existing platform admins.
 */
export async function createPlatformAdmin(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  const email = (formData.get('email') as string)?.trim()
  const fullName = (formData.get('full_name') as string)?.trim()
  const tempPassword = formData.get('temp_password') as string

  if (!email || !fullName || !tempPassword) {
    redirect('/platform-admin/team?message=All fields are required')
  }

  const adminClient = createAdminClient()

  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !authUser.user) {
    redirect(`/platform-admin/team?message=Failed to create account: ${authError?.message}`)
  }

  const { error: profileError } = await adminClient
    .from('users')
    .insert({
      id: authUser.user.id,
      organization_id: null,
      email,
      full_name: fullName,
      role: 'admin',
      is_platform_admin: true,
    })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUser.user.id)
    redirect(`/platform-admin/team?message=Failed to create profile: ${profileError.message}`)
  }

  await adminClient.from('audit_logs').insert({
    organization_id: null,
    performed_by: user.id,
    action: 'platform_admin_created',
    target_type: 'user',
    target_id: authUser.user.id,
    target_name: fullName,
    details: { email },
  })

  redirect(`/platform-admin/team?message=${fullName} added to the platform team successfully`)
}
