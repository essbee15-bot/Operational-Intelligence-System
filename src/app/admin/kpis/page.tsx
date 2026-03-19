import React from 'react'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { addKpiFromCatalogue, addBespokeOrgKpi, updateOrgKpiSettings, removeOrgKpi } from './actions'

const CATEGORIES = [
  { key: 'sales',      label: 'Sales & Revenue',       bg: '#eff6ff', color: '#1d4ed8' },
  { key: 'finance',    label: 'Finance & Costs',        bg: '#f0fdf4', color: '#166534' },
  { key: 'operations', label: 'Operations & Delivery',  bg: '#fffbeb', color: '#92400e' },
  { key: 'customer',   label: 'Customer & Quality',     bg: '#fff1f2', color: '#9f1239' },
  { key: 'hr',         label: 'People & HR',            bg: '#faf5ff', color: '#6b21a8' },
  { key: 'projects',   label: 'Projects & Delivery',    bg: '#ecfeff', color: '#0e7490' },
  { key: 'other',      label: 'Other',                  bg: '#f3f4f6', color: '#374151' },
]
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

const FREQUENCIES: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annual: 'Annual', ad_hoc: 'Ad hoc',
}

export default async function AdminKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; edit?: string; message?: string }>
}) {
  const { view: viewParam, edit: editId, message } = await searchParams
  const activeView = viewParam === 'catalogue' ? 'catalogue' : 'assigned'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()

  // Org's assigned KPIs
  const { data: orgKpis } = await adminClient
    .from('kpis')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('category')
    .order('display_order')

  // System catalogue KPIs (null org_id, active)
  const { data: systemKpis } = await adminClient
    .from('kpis')
    .select('*')
    .is('organization_id', null)
    .eq('is_active', true)
    .order('category')
    .order('display_order')

  // Org users for owner dropdown
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email')
    .eq('organization_id', profile.organization_id)
    .eq('is_anonymised', false)
    .order('full_name')

  const userMap: Record<string, string> = Object.fromEntries(
    (orgUsers ?? []).map(u => [u.id, u.full_name ?? u.email ?? 'Unknown'])
  )

  // System KPIs not yet assigned to this org
  const assignedTemplateIds = new Set(
    (orgKpis ?? []).filter(k => k.template_kpi_id).map(k => k.template_kpi_id as string)
  )
  const unassigned = (systemKpis ?? []).filter(k => !assignedTemplateIds.has(k.id as string))

  // Group assigned KPIs by category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgByCategory: Record<string, any[]> = {}
  ;(orgKpis ?? []).forEach(k => {
    const cat = k.category as string
    if (!orgByCategory[cat]) orgByCategory[cat] = []
    orgByCategory[cat]!.push(k)
  })

  // Group unassigned catalogue by category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catByCategory: Record<string, any[]> = {}
  unassigned.forEach(k => {
    const cat = k.category as string
    if (!catByCategory[cat]) catByCategory[cat] = []
    catByCategory[cat]!.push(k)
  })

  const isSuccess = ['added', 'updated', 'removed'].some(w => message?.includes(w))

  const today = new Date().toISOString().split('T')[0]

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>KPI Management</h1>
        <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
          Assign KPIs to your organisation, set targets, and control who can see each one.
        </p>
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        {[
          { key: 'assigned',  label: `Your KPIs (${(orgKpis ?? []).length})` },
          { key: 'catalogue', label: `Add from Catalogue (${unassigned.length} available)` },
        ].map(tab => (
          <a
            key={tab.key}
            href={`/admin/kpis?view=${tab.key}`}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.875rem', textDecoration: 'none',
              borderBottom: activeView === tab.key ? '2px solid #111827' : '2px solid transparent',
              color: activeView === tab.key ? '#111827' : '#6b7280',
              fontWeight: activeView === tab.key ? 600 : 400,
              marginBottom: '-1px', whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* ── ASSIGNED KPIs ─────────────────────────────────────────────────── */}
      {activeView === 'assigned' && (
        <>
          {(orgKpis ?? []).length === 0 ? (
            <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#92400e' }}>
              No KPIs assigned yet. Use the &quot;Add from Catalogue&quot; tab to get started, or add bespoke KPIs below.
            </div>
          ) : (
            CATEGORIES.map(cat => {
              const kpis = orgByCategory[cat.key] ?? []
              if (kpis.length === 0) return null
              return (
                <div key={cat.key} style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: cat.color }}>
                    <span style={{ backgroundColor: cat.bg, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>{cat.label}</span>
                  </h3>
                  <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>KPI</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Target</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Owner</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Visibility</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Status</th>
                          <th style={{ padding: '0.5rem 0.875rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpis.map((kpi, idx) => {
                          const isEditing = editId === (kpi.id as string)
                          return (
                            <React.Fragment key={kpi.id as string}>
                              <tr style={{ borderBottom: !isEditing && idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none', opacity: kpi.is_active ? 1 : 0.55 }}>
                                <td style={{ padding: '0.625rem 0.875rem' }}>
                                  <div style={{ fontWeight: 500, color: '#111827' }}>{kpi.name as string}</div>
                                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.125rem' }}>
                                    {kpi.unit as string ?? ''}{kpi.unit && kpi.target_frequency ? ' · ' : ''}{FREQUENCIES[kpi.target_frequency as string] ?? ''}
                                    {kpi.template_kpi_id ? ' · from catalogue' : ' · bespoke'}
                                  </div>
                                </td>
                                <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>
                                  {kpi.target_value != null ? `${kpi.target_value}${kpi.unit ? ` ${kpi.unit}` : ''}` : '—'}
                                </td>
                                <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>
                                  {kpi.owner_id ? userMap[kpi.owner_id as string] ?? '—' : '—'}
                                </td>
                                <td style={{ padding: '0.625rem 0.875rem' }}>
                                  <span style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', borderRadius: '9999px', backgroundColor: kpi.audience === 'management_only' ? '#fef2f2' : '#f0fdf4', color: kpi.audience === 'management_only' ? '#991b1b' : '#166534' }}>
                                    {kpi.audience === 'management_only' ? 'Management only' : 'Everyone'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.625rem 0.875rem' }}>
                                  <span style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', borderRadius: '9999px', backgroundColor: kpi.is_active ? '#f0fdf4' : '#f3f4f6', color: kpi.is_active ? '#166534' : '#6b7280' }}>
                                    {kpi.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {isEditing
                                    ? <a href="/admin/kpis" style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none', marginRight: '0.75rem' }}>Cancel</a>
                                    : <a href={`/admin/kpis?edit=${kpi.id as string}`} style={{ fontSize: '0.75rem', color: '#374151', textDecoration: 'none', marginRight: '0.75rem' }}>Edit</a>
                                  }
                                  <form style={{ display: 'inline' }}>
                                    <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                    <button formAction={removeOrgKpi} style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                      title="Also deletes all recorded values for this KPI">
                                      Remove
                                    </button>
                                  </form>
                                </td>
                              </tr>

                              {isEditing && (
                                <tr>
                                  <td colSpan={6} style={{ padding: 0, borderBottom: idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                                    <div style={{ padding: '1rem 0.875rem', backgroundColor: '#f0f7ff', borderLeft: '3px solid #2563eb' }}>
                                      <form style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                        <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.625rem' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Target value</label>
                                            <input
                                              name="target_value" type="number" step="any"
                                              defaultValue={kpi.target_value != null ? String(kpi.target_value) : ''}
                                              placeholder={`e.g. 100${kpi.unit ? ` ${kpi.unit as string}` : ''}`}
                                              style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem' }}
                                            />
                                          </div>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Owner</label>
                                            <select name="owner_id" defaultValue={kpi.owner_id as string ?? ''} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                              <option value="">— No owner —</option>
                                              {(orgUsers ?? []).map(u => (
                                                <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Visibility</label>
                                            <select name="audience" defaultValue={kpi.audience as string} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                              <option value="everyone">Everyone</option>
                                              <option value="management_only">Management only</option>
                                            </select>
                                          </div>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Status</label>
                                            <select name="is_active" defaultValue={String(kpi.is_active)} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                              <option value="true">Active</option>
                                              <option value="false">Inactive</option>
                                            </select>
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                          <button formAction={updateOrgKpiSettings} style={{ padding: '0.375rem 1rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                                            Save
                                          </button>
                                          <a href="/admin/kpis" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', border: '1px solid #d1d5db', borderRadius: '4px' }}>
                                            Cancel
                                          </a>
                                        </div>
                                      </form>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })
          )}

          {/* Add bespoke KPI */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Add Bespoke KPI</h3>
            <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>KPI Name *</label>
                  <input name="name" type="text" required maxLength={200} placeholder="e.g. Weekly leads generated"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Category *</label>
                  <select name="category" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Unit</label>
                  <input name="unit" type="text" maxLength={20} placeholder="£, %, count…"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Target value</label>
                  <input name="target_value" type="number" step="any" placeholder="Optional"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Measured</label>
                  <select name="target_frequency" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                    {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Visibility</label>
                  <select name="audience" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
                    <option value="everyone">Everyone</option>
                    <option value="management_only">Management only</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                  <input name="description" type="text" maxLength={300} placeholder="What this KPI measures"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }} />
                </div>
              </div>
              <button formAction={addBespokeOrgKpi} style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}>
                Add Bespoke KPI
              </button>
            </form>
          </div>

          <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
            ⚠ Removing a KPI permanently deletes all recorded values for it.
          </p>
        </>
      )}

      {/* ── CATALOGUE TAB ─────────────────────────────────────────────────── */}
      {activeView === 'catalogue' && (
        <>
          {unassigned.length === 0 ? (
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '1.25rem', fontSize: '0.875rem', color: '#166534' }}>
              All system catalogue KPIs have been assigned to your organisation.
            </div>
          ) : (
            <>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                Click &ldquo;+ Assign&rdquo; to add a system KPI to your organisation. You can then set your own target and assign an owner.
              </p>
              {CATEGORIES.map(cat => {
                const kpis = catByCategory[cat.key] ?? []
                if (kpis.length === 0) return null
                return (
                  <div key={cat.key} style={{ marginBottom: '1rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: cat.color }}>
                      <span style={{ backgroundColor: cat.bg, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>{cat.label}</span>
                    </h3>
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <tbody>
                          {kpis.map((kpi, idx) => (
                            <tr key={kpi.id as string} style={{ borderBottom: idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                              <td style={{ padding: '0.625rem 0.875rem', fontWeight: 500, color: '#111827' }}>{kpi.name as string}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>{kpi.description as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151', whiteSpace: 'nowrap' }}>
                                {kpi.unit as string ?? ''}{kpi.unit && kpi.target_frequency ? ' · ' : ''}{FREQUENCIES[kpi.target_frequency as string] ?? ''}
                              </td>
                              <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                                <form style={{ display: 'inline' }}>
                                  <input type="hidden" name="template_kpi_id" value={kpi.id as string} />
                                  <button formAction={addKpiFromCatalogue} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                                    + Assign
                                  </button>
                                </form>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}
