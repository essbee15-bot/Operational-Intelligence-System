import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { createField, deleteField, updateField } from './actions'

const ENTITY_TYPES = [
  { key: 'meeting', label: 'Meetings' },
  { key: 'project', label: 'Projects' },
  { key: 'kpi', label: 'KPIs' },
  { key: 'user', label: 'Users' },
]

const FIELD_TYPES = [
  { key: 'text', label: 'Short Text' },
  { key: 'textarea', label: 'Long Text' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'select', label: 'Dropdown (Select)' },
  { key: 'checkbox', label: 'Checkbox (Yes/No)' },
]

export default async function FieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; message?: string; edit?: string }>
}) {
  const { entity: entityParam, message, edit: editId } = await searchParams
  const activeEntity = ENTITY_TYPES.find(e => e.key === entityParam)?.key ?? 'meeting'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: adminProfile } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || adminProfile.role !== 'admin') redirect('/')

  const { data: fields } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('organization_id', adminProfile.organization_id)
    .eq('entity_type', activeEntity)
    .order('display_order')

  const editField = editId ? fields?.find(f => f.id === editId) : null
  const isSuccess = message?.includes('successfully')

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <a href="/" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>← Dashboard</a>
      </div>
      <h1 style={{ margin: '0 0 0.25rem 0' }}>Custom Fields</h1>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem 0', fontSize: '0.875rem' }}>
        Define additional fields to capture on each record type. These will appear when creating and editing records.
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

      {/* Entity type tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0' }}>
        {ENTITY_TYPES.map(e => (
          <a
            key={e.key}
            href={`/admin/fields?entity=${e.key}`}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              textDecoration: 'none',
              borderBottom: activeEntity === e.key ? '2px solid #111827' : '2px solid transparent',
              color: activeEntity === e.key ? '#111827' : '#6b7280',
              fontWeight: activeEntity === e.key ? 600 : 400,
              marginBottom: '-1px',
            }}
          >
            {e.label}
          </a>
        ))}
      </div>

      {/* Existing fields */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>
          {ENTITY_TYPES.find(e => e.key === activeEntity)?.label} Fields ({fields?.length ?? 0})
        </h2>

        {!fields || fields.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>No custom fields defined yet. Add one below.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Label</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Key</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: 600, color: '#374151' }}>Required</th>
                <th style={{ padding: '0.5rem 0' }}></th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.625rem 0', color: '#111827', fontWeight: 500 }}>{f.label}</td>
                  <td style={{ padding: '0.625rem 0', color: '#374151' }}>
                    {FIELD_TYPES.find(t => t.key === f.field_type)?.label ?? f.field_type}
                    {f.field_type === 'select' && Array.isArray(f.options) && f.options.length > 0 && (
                      <span style={{ color: '#9ca3af', fontSize: '0.75rem', marginLeft: '0.375rem' }}>
                        ({(f.options as string[]).join(', ')})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280', fontFamily: 'monospace', fontSize: '0.8rem' }}>{f.field_key}</td>
                  <td style={{ padding: '0.625rem 0', color: '#6b7280' }}>{f.is_required ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '0.625rem 0', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                      <a
                        href={`/admin/fields?entity=${activeEntity}&edit=${f.id}`}
                        style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}
                      >
                        Edit
                      </a>
                      <form style={{ display: 'inline' }}>
                        <input type="hidden" name="field_id" value={f.id} />
                        <input type="hidden" name="entity_type" value={activeEntity} />
                        <button
                          formAction={deleteField}
                          style={{ fontSize: '0.8rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit field form */}
      {editField && (
        <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600 }}>Edit Field: {editField.label}</h2>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input type="hidden" name="field_id" value={editField.id} />
            <input type="hidden" name="entity_type" value={activeEntity} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Label</label>
                <input
                  name="label"
                  type="text"
                  required
                  defaultValue={editField.label}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Type</label>
                <select
                  name="field_type"
                  defaultValue={editField.field_type}
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
                >
                  {FIELD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Options <span style={{ color: '#9ca3af', fontWeight: 400 }}>(dropdown only — comma separated)</span>
              </label>
              <input
                name="options"
                type="text"
                defaultValue={Array.isArray(editField.options) ? (editField.options as string[]).join(', ') : ''}
                placeholder="Option A, Option B, Option C"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input type="checkbox" name="is_required" defaultChecked={editField.is_required} />
              Required field
            </label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                formAction={updateField}
                style={{ padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Save Changes
              </button>
              <a
                href={`/admin/fields?entity=${activeEntity}`}
                style={{ padding: '0.625rem 1.25rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', color: '#374151', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                Cancel
              </a>
            </div>
          </form>
        </div>
      )}

      {/* Add new field */}
      {!editField && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Add Field</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0 0 1rem 0' }}>
            The field key is auto-generated from the label and used to store data.
          </p>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input type="hidden" name="entity_type" value={activeEntity} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="label" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Label</label>
                <input
                  id="label"
                  name="label"
                  type="text"
                  required
                  placeholder="e.g. Budget, Outcome Notes"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label htmlFor="field_type" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Type</label>
                <select
                  id="field_type"
                  name="field_type"
                  defaultValue="text"
                  style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem', backgroundColor: 'white' }}
                >
                  {FIELD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor="options" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                Options <span style={{ color: '#9ca3af', fontWeight: 400 }}>(dropdown only — comma separated)</span>
              </label>
              <input
                id="options"
                name="options"
                type="text"
                placeholder="Option A, Option B, Option C"
                style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input type="checkbox" name="is_required" />
              Required field
            </label>
            <button
              formAction={createField}
              style={{ alignSelf: 'flex-start', padding: '0.625rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Add Field
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
