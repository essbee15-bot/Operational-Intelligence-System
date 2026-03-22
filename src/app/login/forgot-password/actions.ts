'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string).trim().toLowerCase()

  if (!email) redirect('/login/forgot-password')

  // Use the admin client (bypasses RLS) to check if this is a platform admin.
  // We must never reveal whether an email exists, but platform admins need
  // a different message since email reset won't be their recovery path.
  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('is_platform_admin')
    .eq('email', email)
    .maybeSingle()

  if (profile?.is_platform_admin) {
    redirect('/login/forgot-password?message=platform_admin')
  }

  // Derive the origin for the redirect URL.
  // Server actions are same-origin POSTs — the 'origin' header is always
  // the actual deployment URL (localhost, preview, or production).
  // We trust it directly rather than checking an allowlist so that
  // Vercel preview URLs work without any configuration changes.
  const headersList = await headers()

  const origin =
    headersList.get('origin') ??
    (headersList.get('x-forwarded-proto') && headersList.get('host')
      ? `${headersList.get('x-forwarded-proto')}://${headersList.get('host')}`
      : null) ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://localhost:3000'

  const supabase = await createClient()

  // Fire and forget — we never tell the caller whether the email exists.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/login/reset-password`,
  })

  // Always show the same success message regardless of outcome.
  redirect('/login/forgot-password?message=sent')
}
