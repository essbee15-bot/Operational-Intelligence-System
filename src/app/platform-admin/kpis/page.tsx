import React from 'react'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import {
  createSystemKpi, updateSystemKpi, deleteSystemKpi, toggleSystemKpi,
  assignKpiToOrg, createOrgKpi, removeOrgKpi,
} from './actions'

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const cat = CAT_MAP[category] ?? { label: category, bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', backgroundColor: cat.bg, color: cat.color, whiteSpace: 'nowrap', fontWeight: 500 }}>
      {cat.label}
    </span>
  )
}

function AddKpiForm({
  orgId,
  action,
  submitLabel,
}: {
  orgId?: string
  action: (f: FormData) => Promise<void>
  submitLabel: string
}) {
  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem' }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>{submitLabel}</h3>
      <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {orgId && <input type="hidden" name="org_id" value={orgId} />}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>KPI Name *</label>
            <input
              name="name" type="text" required maxLength={200}
              placeholder="e.g. Monthly Revenue"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Category *</label>
            <select name="category" required style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Unit</label>
            <input
              name="unit" type="text" maxLength={20}
              placeholder="e.g. £, %, count, score/10"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Measured</label>
            <select name="target_frequency" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}>
              {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
          <input
            name="description" type="text" maxLength={300}
            placeholder="What this KPI measures"
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            formAction={action}
            style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PlatformKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ org_id?: string; message?: string; edit?: string }>
}) {
  const { org_id: orgFilter, message, edit: editId } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_platform_admin) redirect('/')

  const adminClient = createAdminClient()

  // Load all organisations
  const { data: orgs } = await adminClient
    .from('organizations')
    .select('id, name')
    .order('name')

  // Load system catalogue (null org_id)
  const { data: systemKpis } = await adminClient
    .from('kpis')
    .select('*')
    .is('organization_id', null)
    .order('category')
    .order('display_order')

  // Load org-specific KPIs if an org is selected
  const { data: orgKpis } = orgFilter
    ? await adminClient
        .from('kpis')
        .select('*')
        .eq('organization_id', orgFilter)
        .order('category')
        .order('display_order')
    : { data: [] }

  // Build a set of template IDs already assigned to this org
  const assignedTemplateIds = new Set(
    (orgKpis ?? [])
      .filter(k => k.template_kpi_id)
      .map(k => k.template_kpi_id as string)
  )

  // System templates not yet assigned to the selected org
  const unassignedTemplates = (systemKpis ?? []).filter(k => !assignedTemplateIds.has(k.id as string))

  // Count KPIs per org for the overview table
  const { data: orgKpiCounts } = await adminClient
    .from('kpis')
    .select('organization_id')
    .not('organization_id', 'is', null)

  const countByOrg: Record<string, number> = {}
  ;(orgKpiCounts ?? []).forEach(k => {
    const oid = k.organization_id as string
    countByOrg[oid] = (countByOrg[oid] ?? 0) + 1
  })

  // Group system KPIs by category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const systemByCategory: Record<string, any[]> = {}
  ;(systemKpis ?? []).forEach(k => {
    const cat = k.category as string
    if (!systemByCategory[cat]) systemByCategory[cat] = []
    systemByCategory[cat]!.push(k)
  })

  // Group org KPIs by category (for selected org)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgByCategory: Record<string, any[]> = {}
  ;(orgKpis ?? []).forEach(k => {
    const cat = k.category as string
    if (!orgByCategory[cat]) orgByCategory[cat] = []
    orgByCategory[cat]!.push(k)
  })

  const isSuccess = message?.includes('added') || message?.includes('assigned') || message?.includes('removed') || message?.includes('enabled') || message?.includes('disabled')
  const selectedOrg = (orgs ?? []).find(o => o.id === orgFilter)
  const orgMap = Object.fromEntries((orgs ?? []).map(o => [o.id, o.name]))

  const buildHref = (params: { org_id?: string }) => {
    const p = new URLSearchParams()
    if (params.org_id) p.set('org_id', params.org_id)
    return `/platform-admin/kpis${p.toString() ? '?' + p.toString() : ''}`
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Admin</a>
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>KPI Catalogue</h1>
        <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
          Manage the system KPI catalogue and pre-load KPIs for organisations during onboarding.
          Select an organisation to assign KPIs from the catalogue or add bespoke ones.
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

      {/* Organisation filter */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>Organisation:</span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <a
              href={buildHref({})}
              style={{ padding: '0.375rem 0.75rem', borderRadius: '6px', fontSize: '0.8125rem', textDecoration: 'none', backgroundColor: !orgFilter ? '#111827' : '#f3f4f6', color: !orgFilter ? 'white' : '#374151' }}
            >
              System Catalogue
            </a>
            {(orgs ?? []).map(org => (
              <a
                key={org.id}
                href={buildHref({ org_id: org.id })}
                style={{
                  padding: '0.375rem 0.75rem', borderRadius: '6px', fontSize: '0.8125rem',
                  textDecoration: 'none',
                  backgroundColor: orgFilter === org.id ? '#111827' : '#f3f4f6',
                  color: orgFilter === org.id ? 'white' : '#374151',
                }}
              >
                {org.name}
                {countByOrg[org.id] ? <span style={{ marginLeft: '0.375rem', opacity: 0.7, fontSize: '0.7rem' }}>({countByOrg[org.id]})</span> : ''}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── SYSTEM CATALOGUE VIEW ───────────────────────────────────────────── */}
      {!orgFilter && (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600 }}>
              System Catalogue
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8125rem', fontWeight: 400, color: '#6b7280' }}>
                {(systemKpis ?? []).length} KPIs — available to all organisations
              </span>
            </h2>
          </div>

          {CATEGORIES.map(cat => {
            const kpis = systemByCategory[cat.key] ?? []
            if (kpis.length === 0) return null
            return (
              <div key={cat.key} style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: cat.color }}>
                  {cat.label} ({kpis.length})
                </h3>
                <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Name</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Description</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Unit</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Frequency</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.875rem', fontWeight: 600, color: '#374151' }}>Status</th>
                        <th style={{ padding: '0.5rem 0.875rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.map((kpi, idx) => {
                        const isEditing = editId === (kpi.id as string)
                        return (
                          <React.Fragment key={kpi.id as string}>
                            {/* ── Normal display row ── */}
                            <tr style={{ borderBottom: (!isEditing && idx < kpis.length - 1) ? '1px solid #f3f4f6' : 'none', opacity: kpi.is_active ? 1 : 0.5 }}>
                              <td style={{ padding: '0.625rem 0.875rem', fontWeight: 500, color: '#111827' }}>{kpi.name as string}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280', maxWidth: '280px' }}>{kpi.description as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>{kpi.unit as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>{FREQUENCIES[kpi.target_frequency as string] ?? kpi.target_frequency as string}</td>
                              <td style={{ padding: '0.625rem 0.875rem' }}>
                                <span style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', borderRadius: '9999px', backgroundColor: kpi.is_active ? '#f0fdf4' : '#fef2f2', color: kpi.is_active ? '#166534' : '#991b1b' }}>
                                  {kpi.is_active ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                              <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {isEditing ? (
                                  <a href="/platform-admin/kpis" style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none', marginRight: '0.75rem' }}>Cancel</a>
                                ) : (
                                  <a href={`/platform-admin/kpis?edit=${kpi.id as string}`} style={{ fontSize: '0.75rem', color: '#374151', textDecoration: 'none', marginRight: '0.75rem' }}>Edit</a>
                                )}
                                <form style={{ display: 'inline', marginRight: '0.75rem' }}>
                                  <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                  <input type="hidden" name="is_active" value={String(kpi.is_active)} />
                                  <button formAction={toggleSystemKpi} style={{ fontSize: '0.75rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                    {kpi.is_active ? 'Disable' : 'Enable'}
                                  </button>
                                </form>
                                <form style={{ display: 'inline' }}>
                                  <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                  <button formAction={deleteSystemKpi} style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                    Remove
                                  </button>
                                </form>
                              </td>
                            </tr>

                            {/* ── Inline edit form (shown when ?edit=<id>) ── */}
                            {isEditing && (
                              <tr>
                                <td colSpan={6} style={{ padding: 0, borderBottom: idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                                  <div style={{ padding: '1rem 0.875rem', backgroundColor: '#f0f7ff', borderLeft: '3px solid #2563eb' }}>
                                    <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', fontWeight: 600, color: '#1d4ed8' }}>
                                      Edit KPI — changes will automatically sync to all organisations using this template.
                                    </p>
                                    <form style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                      <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.625rem' }}>
                                        <div style={{ gridColumn: '1 / 3', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                          <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>KPI Name *</label>
                                          <input
                                            name="name" type="text" required maxLength={200}
                                            defaultValue={kpi.name as string}
                                            style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem' }}
                                          />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                          <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Category *</label>
                                          <select name="category" defaultValue={kpi.category as string} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                          </select>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                          <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Frequency</label>
                                          <select name="target_frequency" defaultValue={kpi.target_frequency as string} style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem', backgroundColor: 'white' }}>
                                            {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                          </select>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                          <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Unit</label>
                                          <input
                                            name="unit" type="text" maxLength={20}
                                            defaultValue={kpi.unit as string ?? ''}
                                            placeholder="£, %, count…"
                                            style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem' }}
                                          />
                                        </div>
                                        <div style={{ gridColumn: '1 / 5', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                          <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#374151' }}>Description</label>
                                          <input
                                            name="description" type="text" maxLength={300}
                                            defaultValue={kpi.description as string ?? ''}
                                            style={{ padding: '0.4rem 0.5rem', border: '1px solid #93c5fd', borderRadius: '4px', fontSize: '0.8125rem' }}
                                          />
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                                        <button
                                          formAction={updateSystemKpi}
                                          style={{ padding: '0.375rem 1rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem' }}
                                        >
                                          Save &amp; Sync
                                        </button>
                                        <a href="/platform-admin/kpis" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', border: '1px solid #d1d5db', borderRadius: '4px' }}>
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
          })}

          {/* Org KPI overview */}
          {(orgs ?? []).some(o => countByOrg[o.id]) && (
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9375rem', fontWeight: 600 }}>Organisation KPI Summary</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {(orgs ?? []).map(org => (
                  <a
                    key={org.id}
                    href={buildHref({ org_id: org.id })}
                    style={{
                      padding: '0.5rem 0.875rem', borderRadius: '6px', textDecoration: 'none',
                      backgroundColor: '#f9fafb', border: '1px solid #e5e7eb',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '130px',
                    }}
                  >
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>{org.name}</span>
                    <span style={{ fontSize: '0.75rem', color: countByOrg[org.id] ? '#2563eb' : '#9ca3af', marginTop: '0.125rem' }}>
                      {countByOrg[org.id] ? `${countByOrg[org.id]} KPIs assigned` : 'No KPIs yet'}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Add system KPI form */}
          <AddKpiForm action={createSystemKpi} submitLabel="Add to System Catalogue" />
        </>
      )}

      {/* ── ORG VIEW ────────────────────────────────────────────────────────── */}
      {orgFilter && selectedOrg && (
        <>
          <div style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.0625rem', fontWeight: 600 }}>
              {selectedOrg.name} — KPIs
            </h2>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
              {(orgKpis ?? []).length} KPI{(orgKpis ?? []).length !== 1 ? 's' : ''} assigned to this organisation.
              Select from the catalogue below or add bespoke KPIs.
            </p>
          </div>

          {/* Assigned KPIs */}
          {(orgKpis ?? []).length > 0 ? (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                Assigned KPIs
              </h3>
              {CATEGORIES.map(cat => {
                const kpis = orgByCategory[cat.key] ?? []
                if (kpis.length === 0) return null
                return (
                  <div key={cat.key} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: cat.color, marginBottom: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ backgroundColor: cat.bg, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>{cat.label}</span>
                    </div>
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <tbody>
                          {kpis.map((kpi, idx) => (
                            <tr key={kpi.id as string} style={{ borderBottom: idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                              <td style={{ padding: '0.625rem 0.875rem', fontWeight: 500, color: '#111827' }}>
                                {kpi.name as string}
                                {kpi.template_kpi_id && (
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#9ca3af' }}>from catalogue</span>
                                )}
                              </td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>{kpi.description as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>{kpi.unit as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151' }}>{FREQUENCIES[kpi.target_frequency as string] ?? ''}</td>
                              <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                                <form style={{ display: 'inline' }}>
                                  <input type="hidden" name="kpi_id" value={kpi.id as string} />
                                  <input type="hidden" name="org_id" value={orgFilter} />
                                  <button formAction={removeOrgKpi} style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                    Remove
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
            </div>
          ) : (
            <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#92400e' }}>
              No KPIs assigned yet. Assign from the system catalogue below, or add a bespoke KPI.
            </div>
          )}

          {/* Assign from catalogue */}
          {unassignedTemplates.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                Assign from System Catalogue ({unassignedTemplates.length} available)
              </h3>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                Click &quot;Assign&quot; to add a system KPI to this organisation. The organisation can then track it and set their own targets.
              </p>
              {CATEGORIES.map(cat => {
                const kpis = unassignedTemplates.filter(k => k.category === cat.key)
                if (kpis.length === 0) return null
                return (
                  <div key={cat.key} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: cat.color, marginBottom: '0.375rem' }}>
                      <span style={{ backgroundColor: cat.bg, padding: '0.125rem 0.5rem', borderRadius: '9999px' }}>{cat.label}</span>
                    </div>
                    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <tbody>
                          {kpis.map((kpi, idx) => (
                            <tr key={kpi.id as string} style={{ borderBottom: idx < kpis.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                              <td style={{ padding: '0.625rem 0.875rem', fontWeight: 500, color: '#111827' }}>{kpi.name as string}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#6b7280' }}>{kpi.description as string ?? '—'}</td>
                              <td style={{ padding: '0.625rem 0.875rem', color: '#374151', whiteSpace: 'nowrap' }}>
                                {kpi.unit as string ?? ''}
                                {kpi.unit && kpi.target_frequency ? ' · ' : ''}
                                {FREQUENCIES[kpi.target_frequency as string] ?? ''}
                              </td>
                              <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>
                                <form style={{ display: 'inline' }}>
                                  <input type="hidden" name="template_kpi_id" value={kpi.id as string} />
                                  <input type="hidden" name="org_id" value={orgFilter} />
                                  <button formAction={assignKpiToOrg} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
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
            </div>
          )}

          {unassignedTemplates.length === 0 && (orgKpis ?? []).length > 0 && (
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '0.875rem 1rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#166534' }}>
              All system catalogue KPIs have been assigned to this organisation.
            </div>
          )}

          {/* Add bespoke KPI */}
          <AddKpiForm orgId={orgFilter} action={createOrgKpi} submitLabel="Add Bespoke KPI" />
        </>
      )}
    </div>
  )
}
