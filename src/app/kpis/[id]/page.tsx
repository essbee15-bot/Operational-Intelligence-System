import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'
import { recordKpiValue, deleteKpiRecord } from './actions'

const CATEGORIES: Record<string, { label: string; bg: string; color: string }> = {
  sales:      { label: 'Sales & Revenue',      bg: '#eff6ff', color: '#1d4ed8' },
  finance:    { label: 'Finance & Costs',       bg: '#f0fdf4', color: '#166534' },
  operations: { label: 'Operations & Delivery', bg: '#fffbeb', color: '#92400e' },
  customer:   { label: 'Customer & Quality',    bg: '#fff1f2', color: '#9f1239' },
  hr:         { label: 'People & HR',           bg: '#faf5ff', color: '#6b21a8' },
  projects:   { label: 'Projects & Delivery',   bg: '#ecfeff', color: '#0e7490' },
  other:      { label: 'Other',                 bg: '#f3f4f6', color: '#374151' },
}

const FREQUENCIES: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annual: 'Annual', ad_hoc: 'Ad hoc',
}

export default async function KpiDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ message?: string; record?: string; back?: string }>
}) {
  const { id: kpiId } = await params
  const { message, back } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role, is_platform_admin, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.is_platform_admin && !profile.organization_id) redirect('/platform-admin/kpis')

  const isManager = profile.role === 'admin' || profile.role === 'manager'
  const adminClient = createAdminClient()

  // Load KPI — must belong to this org
  const { data: kpi } = await adminClient
    .from('kpis')
    .select('*')
    .eq('id', kpiId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (!kpi) redirect('/kpis?message=KPI not found')

  // Audience check: contributors can't view management_only KPIs
  if (kpi.audience === 'management_only' && !isManager) {
    redirect('/kpis?message=You do not have access to this KPI')
  }

  // Team check: contributors can only view team-scoped KPIs they are a member of
  if (kpi.team_id && !isManager) {
    const { data: membership } = await adminClient
      .from('team_members')
      .select('team_id')
      .eq('team_id', kpi.team_id as string)
      .eq('user_id', profile.id)
      .single()

    if (!membership) redirect('/kpis?message=You are not a member of this KPI\'s team')
  }

  // Load up to 24 records, newest first
  const { data: records } = await adminClient
    .from('kpi_records')
    .select('*')
    .eq('kpi_id', kpiId)
    .eq('organization_id', profile.organization_id)
    .order('date', { ascending: false })
    .limit(24)

  // Owner name
  let ownerName = '—'
  if (kpi.owner_id) {
    const { data: owner } = await adminClient
      .from('users')
      .select('full_name, email')
      .eq('id', kpi.owner_id as string)
      .single()
    ownerName = owner?.full_name ?? owner?.email ?? '—'
  }

  const cat = CATEGORIES[kpi.category as string] ?? CATEGORIES['other']!

  // Trend: compare latest two records
  const latest  = records?.[0]
  const previous = records?.[1]
  let trendText: string | null = null
  if (latest && previous) {
    const diff = (latest.value as number) - (previous.value as number)
    const sign = diff > 0 ? 'Up' : diff < 0 ? 'Down' : 'Flat'
    const absDiff = Math.abs(diff)
    const prevDate = new Date(previous.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    if (diff === 0) {
      trendText = `No change from last period (${prevDate})`
    } else {
      trendText = `${sign} ${absDiff}${kpi.unit ? ` ${kpi.unit as string}` : ''} from last period (${prevDate}: ${previous.value as number}${kpi.unit ? ` ${kpi.unit as string}` : ''})`
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const isSuccess = message === 'Reading recorded' || message === 'Reading removed'

  // Validate back URL to prevent open redirect (must start with /)
  const safeBack = back && back.startsWith('/') ? back : null

  return (
    <PageShell>
    <div className="page-content" style={{ maxWidth: '900px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Back link */}
      <div style={{ marginBottom: '0.5rem' }}>
        {safeBack ? (
          <a href={safeBack} style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Back to Meeting</a>
        ) : (
          <a href="/kpis" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← KPIs</a>
        )}
      </div>

      {/* Message banner */}
      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem',
          backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          color: isSuccess ? '#166534' : '#991b1b', fontSize: '0.875rem',
        }}>
          {message}
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.7rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', backgroundColor: cat.bg, color: cat.color, fontWeight: 500 }}>
                {cat.label}
              </span>
            </div>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '1.375rem', color: '#111827' }}>{kpi.name as string}</h1>
            {kpi.description && (
              <p style={{ margin: '0 0 0.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>{kpi.description as string}</p>
            )}
          </div>
          {/* Current value */}
          {latest && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', lineHeight: 1 }}>
                {latest.value as number}{kpi.unit ? <span style={{ fontSize: '1rem', color: '#6b7280', marginLeft: '0.25rem' }}>{kpi.unit as string}</span> : null}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                Current · {new Date(latest.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
          )}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6', fontSize: '0.8125rem', color: '#6b7280' }}>
          <span><strong style={{ color: '#374151' }}>Frequency:</strong> {FREQUENCIES[kpi.target_frequency as string] ?? kpi.target_frequency as string}</span>
          {kpi.target_value != null && (
            <span><strong style={{ color: '#374151' }}>Target:</strong> {kpi.target_value as number}{kpi.unit ? ` ${kpi.unit as string}` : ''}</span>
          )}
          {kpi.unit && (
            <span><strong style={{ color: '#374151' }}>Unit:</strong> {kpi.unit as string}</span>
          )}
          <span><strong style={{ color: '#374151' }}>Owner:</strong> {ownerName}</span>
          <span>
            <strong style={{ color: '#374151' }}>Visibility:</strong>{' '}
            <span style={{ color: kpi.audience === 'management_only' ? '#991b1b' : '#166534' }}>
              {kpi.audience === 'management_only' ? 'Management only' : 'Everyone'}
            </span>
          </span>
        </div>

        {/* Trend */}
        {trendText && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6', fontSize: '0.8125rem', color: '#6b7280' }}>
            📈 {trendText}
          </div>
        )}
      </div>

      {/* ── Trend chart ───────────────────────────────────────────────────── */}
      {records && records.length > 1 && (() => {
        const chronological = [...records].reverse()
        const vals = chronological.map(r => r.value as number)
        const target = kpi.target_value as number | null
        const minV = Math.min(...vals, ...(target != null ? [target] : []))
        const maxV = Math.max(...vals, ...(target != null ? [target] : []))
        const range = maxV - minV || 1
        const W = 540, H = 90, PAD = 8
        const toX = (i: number) => PAD + (i / (vals.length - 1)) * W
        const toY = (v: number) => PAD + H - ((v - minV) / range) * H
        const polyPoints = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
        const targetY = target != null ? toY(target).toFixed(1) : null
        const lastVal = vals[vals.length - 1]!
        const prevVal = vals[vals.length - 2]!
        const trendStroke = lastVal > prevVal ? '#16a34a' : lastVal < prevVal ? '#dc2626' : '#6b7280'
        return (
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>Trend</h2>
            <svg viewBox={`0 0 ${W + PAD * 2} ${H + PAD * 2}`} style={{ width: '100%', height: '110px', overflow: 'visible' }} preserveAspectRatio="none">
              {/* Target line */}
              {targetY && (
                <>
                  <line x1={PAD} y1={targetY} x2={W + PAD} y2={targetY} stroke="#86efac" strokeWidth="1.5" strokeDasharray="5 4" />
                  <text x={W + PAD + 3} y={parseFloat(targetY) + 4} fontSize="9" fill="#16a34a" style={{ fontFamily: 'system-ui' }}>target</text>
                </>
              )}
              {/* Value line */}
              <polyline points={polyPoints} fill="none" stroke={trendStroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* Data points */}
              {vals.map((v, i) => {
                const isLast = i === vals.length - 1
                return (
                  <circle key={i} cx={toX(i).toFixed(1)} cy={toY(v).toFixed(1)}
                    r={isLast ? '4.5' : '3'}
                    fill={isLast ? trendStroke : 'white'}
                    stroke={trendStroke} strokeWidth="2" />
                )
              })}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.375rem' }}>
              <span>{new Date(chronological[0]!.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span>{new Date(records[0]!.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
        )
      })()}

      {/* ── Record new value (managers/admins only) ────────────────────────── */}
      {isManager && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Record New Value</h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="kpi_id" value={kpiId} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                  Value{kpi.unit ? ` (${kpi.unit as string})` : ''} *
                </label>
                <input
                  name="value" type="number" step="any" required
                  placeholder={kpi.target_value != null ? `Target: ${kpi.target_value as number}` : 'Enter value'}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Date *</label>
                <input
                  name="date" type="date" required defaultValue={today}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Notes <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                name="notes" rows={2} maxLength={2000}
                placeholder="Context, commentary or caveats…"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <button
                formAction={recordKpiValue}
                style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Save Reading
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── History table ─────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            History {records && records.length > 0 ? `(${records.length} reading${records.length !== 1 ? 's' : ''})` : ''}
          </h2>
        </div>

        {!records || records.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
            No readings recorded yet.{isManager ? ' Use the form above to add the first one.' : ''}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Date</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Value</th>
                {kpi.target_value != null && (
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>vs Target</th>
                )}
                <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Notes</th>
                {isManager && <th style={{ padding: '0.5rem 0.875rem' }}></th>}
              </tr>
            </thead>
            <tbody>
              {records.map((rec, idx) => {
                const val = rec.value as number
                const target = kpi.target_value as number | null
                const met = target != null ? val >= target : null
                const diffPct = target != null && target !== 0
                  ? Math.round(((val - target) / target) * 100)
                  : null

                return (
                  <tr key={rec.id as string} style={{ borderBottom: idx < records.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>
                      {new Date(rec.date as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', fontWeight: 500, color: '#111827' }}>
                      {val}{kpi.unit ? ` ${kpi.unit as string}` : ''}
                    </td>
                    {kpi.target_value != null && (
                      <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '9999px',
                          backgroundColor: met ? '#f0fdf4' : '#fef2f2',
                          color: met ? '#166534' : '#991b1b',
                        }}>
                          {met ? '✓' : '✗'} {diffPct !== null ? `${diffPct > 0 ? '+' : ''}${diffPct}%` : ''}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280', maxWidth: '280px' }}>
                      {rec.notes ? (
                        <span title={rec.notes as string} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {rec.notes as string}
                        </span>
                      ) : '—'}
                    </td>
                    {isManager && (
                      <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                        <form style={{ display: 'inline' }}>
                          <input type="hidden" name="kpi_id" value={kpiId} />
                          <input type="hidden" name="record_id" value={rec.id as string} />
                          <button
                            formAction={deleteKpiRecord}
                            style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            title="Delete this reading"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {records && records.length === 24 && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
          Showing most recent 24 readings.
        </p>
      )}
    </div>
    </PageShell>
  )
}
