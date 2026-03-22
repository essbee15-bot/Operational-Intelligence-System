import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { saveAiSettings } from './actions'
import PageShell from '@/components/PageShell'

export default async function AdminAiPage({
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

  if (!profile || profile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id as string

  const { data: settings } = await adminClient
    .from('ai_settings')
    .select('*')
    .eq('organization_id', orgId)
    .single()

  const { count: embeddingCount } = await adminClient
    .from('ai_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  const [{ count: projectCount }, { count: meetingCount }, { count: goalCount }] = await Promise.all([
    adminClient.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    adminClient.from('meetings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    adminClient.from('objectives').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  const totalEmbeddable = (projectCount ?? 0) + (meetingCount ?? 0) + (goalCount ?? 0)

  const isSuccess = message?.toLowerCase().includes('saved') || message?.toLowerCase().includes('success')
  const isError   = message && !isSuccess
  const isEnabled = (settings?.is_enabled as boolean | null) ?? false
  const provider  = (settings?.provider  as string | null) ?? 'openai'
  const hasKey    = !!(settings?.api_key as string | null)

  return (
    <PageShell>
    <div className="page-content" style={{ maxWidth: '680px' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Assistant</h1>
          <p className="page-subtitle">Configure the AI co-pilot for your organisation.</p>
        </div>
        <a href="/admin" className="btn btn-secondary">← Admin</a>
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1.25rem', backgroundColor: isError ? '#fef2f2' : '#f0fdf4', border: `1px solid ${isError ? '#fca5a5' : '#86efac'}`, color: isError ? '#991b1b' : '#166534', fontSize: '0.875rem' }}>
          {message}
        </div>
      )}

      {/* Status */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: isEnabled && hasKey ? '#22c55e' : '#9ca3af', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{isEnabled && hasKey ? 'Active' : !hasKey ? 'No API key' : 'Disabled'}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Vector index</div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#111827' }}>
            {embeddingCount ?? 0} / {totalEmbeddable} records
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Provider</div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#111827' }}>
            {provider === 'openai' ? 'OpenAI' : 'Anthropic'}
          </div>
        </div>
      </div>

      {/* Config form */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Configuration</h2>
        <form action={saveAiSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>Enable AI Assistant</div>
              <div style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>Makes the chat widget visible to all users in your org</div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input type="radio" name="is_enabled" value="true" defaultChecked={isEnabled} /> On
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input type="radio" name="is_enabled" value="false" defaultChecked={!isEnabled} /> Off
              </label>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Provider</label>
            <select
              name="provider"
              defaultValue={provider}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', backgroundColor: 'white' }}
            >
              <option value="openai">OpenAI — enables vector search + text search</option>
              <option value="anthropic">Anthropic — text search only (no embeddings API)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>API Key</label>
            <input
              type="password"
              name="api_key"
              defaultValue={(settings?.api_key as string | null) ?? ''}
              placeholder={provider === 'openai' ? 'sk-proj-...' : 'sk-ant-api03-...'}
              autoComplete="off"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
            <p style={{ margin: '0.375rem 0 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>Stored per-organisation. Only org admins can view or change this.</p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>Model</label>
            <input
              type="text"
              name="model"
              defaultValue={(settings?.model as string | null) ?? 'gpt-4o-mini'}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', fontFamily: 'monospace' }}
              placeholder="e.g. gpt-4o-mini, claude-3-5-haiku-20241022"
            />
            <p style={{ margin: '0.375rem 0 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
              OpenAI: gpt-4o-mini, gpt-4o · Anthropic: claude-3-5-haiku-20241022, claude-3-5-sonnet-20241022
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={{ padding: '0.5rem 1.25rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
              Save Settings
            </button>
          </div>
        </form>
      </div>

      {/* Vector indexing */}
      {hasKey && provider === 'openai' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>Vector Index</h2>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.6 }}>
            Generates semantic embeddings for projects, meetings, and goals. Enables the AI to find records by meaning, not just keywords. Run once to index existing data.
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 0.875rem', backgroundColor: '#f9fafb', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.875rem' }}>
            <span style={{ color: '#374151' }}>{embeddingCount ?? 0} / {totalEmbeddable} records indexed</span>
            {(embeddingCount ?? 0) === totalEmbeddable && totalEmbeddable > 0 && (
              <span style={{ color: '#166534', fontWeight: 500 }}>✓ Up to date</span>
            )}
          </div>
          <EmbedTrigger />
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>Cost: approx $0.0001 per 100 records using text-embedding-3-small.</p>
        </div>
      )}

      <div style={{ padding: '1rem', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.7 }}>
        <strong style={{ color: '#374151' }}>Privacy:</strong> The AI only searches data from your organisation. Conversations are session-only and never stored. Your API key is only used when a user sends a message.
      </div>
    </div>
    </PageShell>
  )
}

// Client component — just a button that calls the embed endpoint via fetch
function EmbedTrigger() {
  return (
    <div id="embed-container">
      <button
        type="button"
        id="embed-trigger"
        style={{ padding: '0.5rem 1rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
        onClick={undefined}
      >
        Generate / Update Embeddings
      </button>
      {/* Inline script — minimal, no framework needed */}
      <script dangerouslySetInnerHTML={{ __html: `
        document.getElementById('embed-trigger').addEventListener('click', async function() {
          this.disabled = true; this.textContent = 'Generating…';
          try {
            var r = await fetch('/api/ai/embed', {method:'POST',headers:{'Content-Type':'application/json'}});
            var d = await r.json();
            this.textContent = d.error ? 'Error: '+d.error : 'Done — '+(d.indexed||0)+' records indexed. Reload to refresh count.';
          } catch(e) { this.textContent = 'Failed'; }
          this.disabled = false;
        });
      ` }} />
    </div>
  )
}
