import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { createOption, deleteOption, hideSystemOption } from './actions'

const CATEGORIES = [
  { key: 'went_well',       label: 'What Went Well' },
  { key: 'went_badly',      label: 'What Went Badly' },
  { key: 'learned',         label: 'What Was Learned' },
  { key: 'risk_blockers',   label: 'Risk Blockers' },
  { key: 'risk_support',    label: 'What Would Help' },
  { key: 'risk_mitigation', label: 'Risk Mitigation' },
  { key: 'development_type', label: 'Development Types' },
  { key: 'meeting_purpose', label: 'Meeting Purpose' },
]

export default async function OptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; message?: string }>
}) {
  const { category: categoryParam, message } = await searchParams
  const activeCategory = CATEGORIES.find(c => c.key === categoryParam)?.key ?? 'went_well'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()

  // Load system defaults and org overrides for this category
  const { data: allOptions } = await adminClient
    .from('predefined_options')
    .select('*')
    .eq('category', activeCategory)
    .or(`organization_id.is.null,organization_id.eq.${adminProfile.organization_id}`)
    .order('display_order')

  // System defaults — check if org has hidden any
  const systemOptions = (allOptions ?? []).filter(o => o.organization_id === null)
  const orgOptions = (allOptions ?? []).filter(o => o.organization_id === adminProfile.organization_id)

  // Build a set of labels the org has hidden (overrides with is_active=false)
  const hiddenLabels = new Set(orgOptions.filter(o => !o.is_active).map(o => o.label))
  // Build a set of labels the org has added (is_active=true with org_id set)
  const orgAddedOptions = orgOptions.filter(o => o.is_active)

  const isSuccess = message?.includes('successfully') || message === 'Option added successfully' || message === 'Option updated' || message === 'Option removed'

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>Dropdown Options</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Manage the predefined options shown in meeting and review dropdowns. System defaults are shown in grey — you can hide them or add your own.
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
            href={`/admin/options?category=${c.key}`}
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

      {/* System defaults */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>
          System Defaults
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>— cannot be edited, but can be hidden</span>
        </h2>
        {systemOptions.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No system defaults for this category.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {systemOptions.map(opt => {
              const isHidden = hiddenLabels.has(opt.label)
              return (
                <div key={opt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: '#f9fafb', borderRadius: '4px', opacity: isHidden ? 0.5 : 1 }}>
                  <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                    {opt.label}
                    {isHidden && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>(hidden)</span>}
                  </span>
                  <form style={{ display: 'inline' }}>
                    <input type="hidden" name="label" value={opt.label} />
                    <input type="hidden" name="category" value={activeCategory} />
                    <button
                      formAction={hideSystemOption}
                      style={{ fontSize: '0.75rem', color: isHidden ? '#2563eb' : '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {isHidden ? 'Restore' : 'Hide'}
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Org custom options */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>
          Your Organisation&apos;s Options ({orgAddedOptions.length})
        </h2>
        {orgAddedOptions.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No custom options yet. Add one below.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {orgAddedOptions.map(opt => (
              <div key={opt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px' }}>
                <span style={{ fontSize: '0.875rem', color: '#374151' }}>{opt.label}</span>
                <form style={{ display: 'inline' }}>
                  <input type="hidden" name="option_id" value={opt.id} />
                  <input type="hidden" name="category" value={activeCategory} />
                  <button
                    formAction={deleteOption}
                    style={{ fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new option */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Add Option</h2>
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
              placeholder="e.g. Stakeholder delays"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
            />
          </div>
          <button
            formAction={createOption}
            style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
          >
            Add Option
          </button>
        </form>
      </div>
    </div>
  )
}
