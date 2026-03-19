import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  if (!res.ok) throw new Error(`Embedding API error ${res.status}`)
  const data = await res.json() as { data: { embedding: number[] }[] }
  return data.data[0]!.embedding
}

function formatEmbedText(type: string, record: Record<string, unknown>): string {
  if (type === 'project') {
    return [
      `Project: ${record.name ?? ''}`,
      record.description ? `Description: ${record.description}` : '',
      record.status ? `Status: ${record.status}` : '',
      record.outcomes ? `Outcomes: ${record.outcomes}` : '',
    ].filter(Boolean).join('\n')
  }
  if (type === 'meeting') {
    return [
      `Meeting: ${record.title ?? ''}`,
      record.general_notes ? `Notes: ${record.general_notes}` : '',
      record.outcomes ? `Outcomes: ${record.outcomes}` : '',
      record.project_involvement_notes ? `Projects: ${record.project_involvement_notes}` : '',
    ].filter(Boolean).join('\n')
  }
  if (type === 'goal') {
    return `Objective: ${record.title ?? ''} (${record.status ?? ''})`
  }
  return String(record.title ?? record.name ?? '')
}

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const orgId = profile.organization_id as string
  const adminClient = createAdminClient()

  const { data: aiSettings } = await adminClient
    .from('ai_settings')
    .select('api_key, provider')
    .eq('organization_id', orgId)
    .single()

  if (!aiSettings?.api_key || aiSettings.provider !== 'openai') {
    return NextResponse.json({ error: 'OpenAI API key required for embeddings' }, { status: 400 })
  }

  const apiKey = aiSettings.api_key as string

  const [{ data: projects }, { data: meetings }, { data: goals }] = await Promise.all([
    adminClient.from('projects').select('id, name, description, status, outcomes').eq('organization_id', orgId),
    adminClient.from('meetings').select('id, title, general_notes, outcomes, project_involvement_notes').eq('organization_id', orgId),
    adminClient.from('objectives').select('id, title, status').eq('organization_id', orgId),
  ])

  const records: { type: string; record: Record<string, unknown> }[] = [
    ...(projects ?? []).map(r => ({ type: 'project', record: r as Record<string, unknown> })),
    ...(meetings ?? []).map(r => ({ type: 'meeting', record: r as Record<string, unknown> })),
    ...(goals ?? []).map(r => ({ type: 'goal', record: r as Record<string, unknown> })),
  ]

  let indexed = 0
  const errors: string[] = []

  for (const { type, record } of records) {
    const text = formatEmbedText(type, record)
    if (!text.trim()) continue

    try {
      const embedding = await generateEmbedding(text, apiKey)

      await adminClient
        .from('ai_embeddings')
        .upsert({
          organization_id: orgId,
          record_type:     type,
          record_id:       record.id,
          content_text:    text,
          embedding:       JSON.stringify(embedding), // pgvector accepts JSON array string
        }, { onConflict: 'organization_id,record_type,record_id' })

      indexed++
    } catch (err) {
      errors.push(`${type}:${record.id} — ${err instanceof Error ? err.message : 'unknown'}`)
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 50))
  }

  return NextResponse.json({ indexed, errors: errors.slice(0, 5) })
}
