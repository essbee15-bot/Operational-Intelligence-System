import { createClient } from '@supabase/supabase-js'

/**
 * Server-only admin client using the service role key.
 * This client BYPASSES Row Level Security — only use it in
 * secure Server Actions or API Routes, never in client components.
 *
 * Use cases:
 * - Platform admin creating a new organization + first admin user
 * - Org admin creating a new user (requires auth.admin.createUser)
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
