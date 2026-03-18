import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createSystemOption, deleteSystemOption, toggleSystemOption } from './actions'

const CATEGORIES = [
  { key: 'went_well',        label: 'What Went Well' },
  { key: 'went_badly',       label: 'What Went Badly' },
  { key: 'learned',          label: 'What Was Learned' },
  { key: 'risk_blockers',    label: 'Risk Blockers' },
  { key: 'risk_support',     label: 'What Would Help' },
  { key: 'risk_mitigation',  label: 'Risk Mitigation' },
  { key: 'development_type', label: 'Development Types' },
  { key: 'meeting_purpose',  label: 'Meeting Purpose' },
]

export default async function PlatformOptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; message?: string }>
}) {
  const { category: categoryParam, message } = await searchParams
  const activeCategory = CATEGORIES.find(c => c.key === categoryParam)?.key ?? 'went_well'

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

  // Load all system defaults for this category (organization_id IS NULL)
  const { data: systemOptions } = await adminClient
    .from('predefined_options')
    .select('*')
    .is('organization_id', null)
    .eq('category', activeCategory)
    .order('display_order')

  // Count how many orgs have customised each option (added org-specific overrides)
  const { data: orgCustomisations } = await adminClient
    .from('predefined_options')
    .select('label, organization_id, is_active')
    .not('organization_id', 'is', null)
    .eq('category', activeCategory)

  // Build a map of label → { orgsHiding, orgsAdding }
  const customMap: Record<string, { hiding: number; custom: number }> = {}
  ;(orgCustomisations ?? []).forEach(c => {
    if (!customMap[c.label]) customMap[c.label] = { hiding: 0, custom: 0 }
    if (!c.is_active) customMap[c.label]!.hiding++
    else customMap[c.label]!.custom++
  })

  // Org-unique options (not matching any system default label)
  const systemLabels = new Set((systemOptions ?? []).map(o => o.label))
  const orgUniqueOptions = (orgCustomisations ?? []).filter(c => !systemLabels.has(c.label) && c.is_active)
  const uniqueByLabel: Record<string, number> = {}
  orgUniqueOptions.forEach(o => {
    uniqueByLabel[o.label] = (uniqueByLabel[o.label] ?? 0) + 1
  })

  const isSuccess = message?.includes('added') || message?.includes('removed') || message?.includes('enabled') || message?.includes('disabled')

  return (
    <div style={{ maxWidth: '850px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/platform-admin" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Platform Admin</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>System Dropdown Options</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Manage the system-wide default options available to all organisations. Organisations can add their own options and hide these defaults.
        Use this to ensure consistent terminology across the platform.
      </p>

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

      {/* Category tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        {CATEGORIES.map(c => (
          <a
            key={c.key}
            href={`/platform-admin/options?category=${c.key}`}
            style={{
              padding: '0.5rem 0.875rem',
              fontSize: '0.8125rem',
              textDecoration: 'none',
              borderBottom: activeCategory === c.key ? '2px solid #111827' : '2px solid transparent',
              color: activeCategory === c.key ? '#111827' : '#6b7280',
              fontWeight: activeCategory === c.key ? 600 : 400,
              marginBottom: '-1px',
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </a>
        ))}
      </div>

      {/* System defaults for this category */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>
          System Defaults
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>
            — shown to all organisations by default
          </span>
        </h2>

        {(systemOptions ?? []).length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No system defaults for this category yet. Add one below.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {(systemOptions ?? []).map(opt => {
              const info = customMap[opt.label]
              return (
                <div
                  key={opt.id as string}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.625rem 0.75rem',
                    backgroundColor: opt.is_active ? '#f9fafb' : '#fef2f2',
                    borderRadius: '4px',
                    border: opt.is_active ? '1px solid #e5e7eb' : '1px solid #fca5a5',
                    opacity: opt.is_active ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                      {opt.label as string}
                      {!opt.is_active && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>(disabled platform-wide)</span>}
                    </span>
                    {info && (info.hiding > 0 || info.custom > 0) && (
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                        {info.hiding > 0 ? `${info.hiding} org${info.hiding !== 1 ? 's' : ''} hidden · ` : ''}
                        {info.custom > 0 ? `${info.custom} org${info.custom !== 1 ? 's' : ''} custom` : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <form style={{ display: 'inline' }}>
                      <input type="hidden" name="option_id" value={opt.id as string} />
                      <input type="hidden" name="category" value={activeCategory} />
                      <input type="hidden" name="is_active" value={String(opt.is_active)} />
                      <button
                        formAction={toggleSystemOption}
                        style={{ fontSize: '0.75rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {opt.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                    <form style={{ display: 'inline' }}>
                      <input type="hidden" name="option_id" value={opt.id as string} />
                      <input type="hidden" name="category" value={activeCategory} />
                      <button
                        formAction={deleteSystemOption}
                        style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        title="Permanently remove this system default"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Org-unique options (what orgs have added beyond system defaults) */}
      {Object.keys(uniqueByLabel).length > 0 && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>
            Organisation-Added Options
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>— custom options added by individual organisations</span>
          </h2>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
            If you see repeated terminology here, consider adding it as a system default so all organisations benefit.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Object.entries(uniqueByLabel).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px' }}>
                <span style={{ fontSize: '0.875rem', color: '#1d4ed8' }}>{label}</span>
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  Used by {count} org{count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new system option */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Add System Default</h2>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8125rem', color: '#6b7280' }}>
          This will appear for all organisations unless they choose to hide it.
        </p>
        <form style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <input type="hidden" name="category" value={activeCategory} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="label" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Option label</label>
            <input
              id="label"
              name="label"
              type="text"
              required
              maxLength={300}
              placeholder="e.g. Clear communication"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <button
            formAction={createSystemOption}
            style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
          >
            Add to System
          </button>
        </form>
      </div>
    </div>
  )
}
