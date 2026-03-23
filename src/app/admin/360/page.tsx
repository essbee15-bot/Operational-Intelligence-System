import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createCycle } from './actions'
import PageShell from '@/components/PageShell'

export default async function Admin360Page({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/?message=Unauthorised')

  const adminClient = createAdminClient()

  // Load all review cycles for the org
  const { data: cycles } = await adminClient
    .from('review_cycles')
    .select('id, name, description, is_closed, opens_at, closes_at, custom_questions, created_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  // Load response counts per cycle
  const cycleIds = (cycles ?? []).map(c => c.id as string)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responsesByCycle: Record<string, any[]> = {}
  const completionsByCycle: Record<string, number> = {}

  if (cycleIds.length > 0) {
    const { data: allResponses } = await adminClient
      .from('review_responses')
      .select('cycle_id, manager_id')
      .eq('organization_id', profile.organization_id)
      .in('cycle_id', cycleIds)

    ;(allResponses ?? []).forEach(r => {
      const cid = r.cycle_id as string
      if (!responsesByCycle[cid]) responsesByCycle[cid] = []
      responsesByCycle[cid].push(r)
    })

    const { data: allCompletions } = await adminClient
      .from('review_completions')
      .select('cycle_id')
      .in('cycle_id', cycleIds)

    ;(allCompletions ?? []).forEach(c => {
      const cid = c.cycle_id as string
      completionsByCycle[cid] = (completionsByCycle[cid] ?? 0) + 1
    })
  }

  const isSuccess =
    message?.toLowerCase().includes('created') ||
    message?.toLowerCase().includes('closed') ||
    message?.toLowerCase().includes('reopened')

  const defaultOpensAt = new Date().toISOString().slice(0, 16)

  return (
    <PageShell>
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>360 Feedback</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Create review cycles for anonymous upward feedback on managers.
          </p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.5rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* Create cycle form */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Create New Cycle</h2>
        <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Cycle name <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                id="name" name="name" type="text" required maxLength={200}
                placeholder="Q1 2026 Manager Review"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="opens_at" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Opens at</label>
              <input
                id="opens_at" name="opens_at" type="datetime-local"
                defaultValue={defaultOpensAt}
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="description" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
              Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="description" name="description" type="text" maxLength={300}
              placeholder="Brief description of this review cycle…"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <button
            formAction={createCycle}
            style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Create Cycle →
          </button>
        </form>
      </div>

      {/* Cycles list */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            Review Cycles ({(cycles ?? []).length})
          </h2>
        </div>

        {(cycles ?? []).length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.375rem 0', color: '#374151', fontWeight: 500, fontSize: '0.9375rem' }}>No review cycles yet</p>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.875rem' }}>
              Create your first 360 review cycle to start collecting anonymous manager feedback.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Cycle</th>
                <th style={{ textAlign: 'left', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Responses</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Managers</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 1rem', fontWeight: 600, color: '#374151' }}>Completions</th>
                <th style={{ padding: '0.625rem 1rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {(cycles ?? []).map((cycle, idx) => {
                const responses = responsesByCycle[cycle.id as string] ?? []
                const responseCount = responses.length
                const managerCount = new Set(responses.map(r => r.manager_id as string)).size
                const completionCount = completionsByCycle[cycle.id as string] ?? 0
                const isClosed = cycle.is_closed as boolean

                return (
                  <tr key={cycle.id as string} style={{ borderBottom: idx < (cycles ?? []).length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ fontWeight: 500, color: '#111827' }}>{cycle.name as string}</div>
                      {(cycle.description as string | null) && (
                        <div style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.125rem' }}>{cycle.description as string}</div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px',
                        backgroundColor: isClosed ? '#f3f4f6' : '#f0fdf4',
                        color: isClosed ? '#6b7280' : '#166534',
                      }}>
                        {isClosed ? 'Closed' : 'Open'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      {responseCount}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      {managerCount}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      {completionCount}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <a href={`/admin/360/${cycle.id as string}`} style={{ fontSize: '0.8125rem', color: '#2563eb', textDecoration: 'none' }}>
                        Manage →
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </PageShell>
  )
}
