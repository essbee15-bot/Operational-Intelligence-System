import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { computeOrgScores } from '@/lib/scoring/compute'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Get all orgs
  const { data: orgs } = await admin
    .from('organizations')
    .select('id')

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ message: 'No orgs to process' })
  }

  const results: { orgId: string; status: string }[] = []

  for (const org of orgs) {
    try {
      await computeOrgScores(org.id as string)
      results.push({ orgId: org.id as string, status: 'ok' })
    } catch (err) {
      results.push({ orgId: org.id as string, status: `error: ${(err as Error).message}` })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
