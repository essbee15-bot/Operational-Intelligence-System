import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ enabled: false })

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ enabled: false })

  const { data: settings } = await createAdminClient()
    .from('ai_settings')
    .select('is_enabled, api_key')
    .eq('organization_id', profile.organization_id as string)
    .single()

  const enabled = !!(settings?.is_enabled && settings?.api_key)
  return NextResponse.json({ enabled })
}
