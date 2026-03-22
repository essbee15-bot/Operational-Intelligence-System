import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ users: [] }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ users: [] }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const rawQ = (searchParams.get('q') ?? '').trim()
  const q = rawQ.replace(/[%_\\]/g, '\\$&').slice(0, 100)
  const excludeParam = searchParams.get('exclude') ?? ''
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const excludeIds = excludeParam.split(',').filter(id => UUID_RE.test(id))

  if (q.length < 3) return NextResponse.json({ users: [] })

  let query = supabase
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .neq('id', user.id)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('full_name')
    .limit(10)

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data: users, error: searchError } = await query
  if (searchError) {
    console.error('[users/search] query failed', searchError.message)
    return NextResponse.json({ users: [] }, { status: 500 })
  }
  return NextResponse.json({ users: users ?? [] })
}
