import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export const dynamic = 'force-dynamic'

interface Message { role: 'user' | 'assistant'; content: string }

// ── Search org data ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchOrgData(adminClient: any, orgId: string, query: string) {
  const q = `%${query.replace(/[%_]/g, '\\$&').slice(0, 200)}%`

  const [
    { data: projects },
    { data: meetings },
    { data: goals },
    { data: actions },
  ] = await Promise.all([
    adminClient
      .from('projects')
      .select('name, description, status, priority, outcomes, capacity_impact, end_date, created_at')
      .eq('organization_id', orgId)
      .or(`name.ilike.${q},description.ilike.${q},outcomes.ilike.${q}`)
      .order('created_at', { ascending: false })
      .limit(10),

    adminClient
      .from('meetings')
      .select('title, date, general_notes, outcomes, development_requests, project_involvement_notes')
      .eq('organization_id', orgId)
      .or(`title.ilike.${q},general_notes.ilike.${q},outcomes.ilike.${q},development_requests.ilike.${q}`)
      .order('date', { ascending: false })
      .limit(8),

    adminClient
      .from('objectives')
      .select('title, status, end_date')
      .eq('organization_id', orgId)
      .or(`title.ilike.${q}`)
      .order('end_date', { ascending: false })
      .limit(6),

    adminClient
      .from('action_items')
      .select('title, status, due_date, is_closed')
      .eq('organization_id', orgId)
      .or(`title.ilike.${q}`)
      .order('due_date', { ascending: false })
      .limit(8),
  ])

  // If no text matches, fall back to recent data so the AI has context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fallbackProjects: any[] = []
  if ((projects ?? []).length === 0) {
    const { data } = await adminClient
      .from('projects')
      .select('name, description, status, priority, outcomes, capacity_impact, end_date, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(8)
    fallbackProjects = data ?? []
  }

  return {
    projects:  (projects ?? []).length > 0 ? projects ?? [] : fallbackProjects,
    meetings:  meetings ?? [],
    goals:     goals ?? [],
    actions:   actions ?? [],
  }
}

// ── Format context for the LLM ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildContext(data: { projects: any[]; meetings: any[]; goals: any[]; actions: any[] }, orgName: string) {
  const lines: string[] = []

  lines.push(`Organisation: ${orgName}`)
  lines.push('')

  if (data.projects.length > 0) {
    lines.push('PROJECTS:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.projects.forEach((p: any) => {
      lines.push(`• "${p.name}" | Status: ${p.status} | Priority: ${p.priority ?? 'medium'}${p.capacity_impact ? ` | Capacity: ${p.capacity_impact}h` : ''}${p.end_date ? ` | Due: ${new Date(p.end_date as string).toLocaleDateString('en-GB')}` : ''}`)
      if (p.description) lines.push(`  Description: ${p.description}`)
      if (p.outcomes)    lines.push(`  Outcomes/Learnings: ${p.outcomes}`)
    })
    lines.push('')
  }

  if (data.meetings.length > 0) {
    lines.push('MEETINGS (recent relevant):')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.meetings.forEach((m: any) => {
      lines.push(`• "${m.title}" (${new Date(m.date as string).toLocaleDateString('en-GB')})`)
      if (m.general_notes)            lines.push(`  Notes: ${String(m.general_notes).slice(0, 300)}`)
      if (m.project_involvement_notes) lines.push(`  Project involvement: ${String(m.project_involvement_notes).slice(0, 200)}`)
      if (m.development_requests)     lines.push(`  Development: ${String(m.development_requests).slice(0, 200)}`)
      if (m.outcomes)                 lines.push(`  Outcomes: ${String(m.outcomes).slice(0, 200)}`)
    })
    lines.push('')
  }

  if (data.goals.length > 0) {
    lines.push('GOALS / OBJECTIVES:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.goals.forEach((g: any) => {
      lines.push(`• "${g.title}" | Status: ${g.status}${g.end_date ? ` | Due: ${new Date(g.end_date as string).toLocaleDateString('en-GB')}` : ''}`)
    })
    lines.push('')
  }

  if (data.actions.length > 0) {
    lines.push('RELEVANT ACTIONS:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.actions.forEach((a: any) => {
      const st = a.is_closed ? 'completed' : a.status
      lines.push(`• "${a.title}" | Status: ${st}${a.due_date ? ` | Due: ${new Date(a.due_date as string).toLocaleDateString('en-GB')}` : ''}`)
    })
  }

  return lines.join('\n')
}

// ── LLM call abstraction ─────────────────────────────────────────────────────

async function callLLM(
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
): Promise<string> {
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `OpenAI error ${res.status}`)
    }
    const data = await res.json() as { choices: { message: { content: string } }[] }
    return data.choices[0]?.message?.content ?? ''

  } else {
    // Anthropic
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [
          ...history,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1000,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `Anthropic error ${res.status}`)
    }
    const data = await res.json() as { content: { type: string; text: string }[] }
    return data.content.find(c => c.type === 'text')?.text ?? ''
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 401 })

  const orgId = profile.organization_id as string
  const adminClient = createAdminClient()

  // Load org name + AI settings
  const [{ data: org }, { data: aiSettings }] = await Promise.all([
    adminClient.from('organizations').select('name').eq('id', orgId).single(),
    adminClient.from('ai_settings').select('*').eq('organization_id', orgId).single(),
  ])

  if (!aiSettings?.is_enabled || !aiSettings?.api_key) {
    return NextResponse.json({ error: 'AI assistant is not configured for this organisation. Ask your admin to set it up under AI Assistant settings.' }, { status: 400 })
  }

  const body = await req.json() as { message: string; history: Message[] }
  const { message: userMessage, history = [] } = body

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  // Search org data based on the user's message
  const orgData = await searchOrgData(adminClient, orgId, userMessage)
  const context = buildContext(orgData, (org?.name as string | null) ?? 'your organisation')

  const systemPrompt = `You are an AI assistant for ${(org?.name as string | null) ?? 'this organisation'}. You help users understand patterns, find relevant past experience, and make better decisions based on their organisational data.

Rules:
- Only reference information from the context provided below
- When citing a specific project, meeting, or record, name it clearly
- Be honest if you don't have sufficient data to answer well
- Highlight patterns you notice (recurring blockers, capacity issues, repeated risks)
- Keep responses concise and actionable
- Never invent details not present in the context

Context from this organisation's records:
${context}`

  try {
    const response = await callLLM(
      aiSettings.provider as string,
      aiSettings.model as string,
      aiSettings.api_key as string,
      systemPrompt,
      history.slice(-10), // last 10 messages for context window
      userMessage,
    )
    return NextResponse.json({ response })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `AI call failed: ${msg}` }, { status: 500 })
  }
}
