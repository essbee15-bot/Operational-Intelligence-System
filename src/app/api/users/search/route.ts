import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
  const q = (searchParams.get('q') ?? '').trim()
  const excludeParam = searchParams.get('exclude') ?? ''
  const excludeIds = excludeParam.split(',').filter(Boolean)

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

  const { data: users } = await query
  return NextResponse.json({ users: users ?? [] })
}
