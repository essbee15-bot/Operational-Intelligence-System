import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import PageShell from '@/components/PageShell'
import {
  saveDiagnostic,
  advanceStep,
  addSetupTeam,
  removeSetupTeam,
  addSetupUser,
  saveReportingLines,
  addSetupKpis,
  completeSetup,
} from './actions'

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; message?: string }>
}) {
  const { step, message } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single()

  // Only org admins can access the setup wizard
  if (!profile || profile.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()
  const orgId = profile.organization_id

  // Load or create setup progress
  let { data: progress } = await adminClient
    .from('setup_progress')
    .select('*')
    .eq('organization_id', orgId)
    .single()

  if (!progress) {
    // First visit — create the setup_progress row
    const { data: created } = await adminClient
      .from('setup_progress')
      .insert({ organization_id: orgId, current_step: 0 })
      .select()
      .single()
    progress = created
  }

  const currentStep = step !== undefined ? parseInt(step, 10) : (progress?.current_step ?? 0)
  const totalSteps = 7
  const progressPercent = Math.round(((currentStep) / (totalSteps - 1)) * 100)

  // ── Data for each step ──────────────────────────────────────────────────────

  // Step 1: diagnostic answers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answers: any = progress?.diagnostic_answers ?? {}

  // Step 2: existing teams
  const { data: teams } = await adminClient
    .from('teams')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name')

  // Step 3 & 4: org users (excluding current admin for manager assignment)
  const { data: orgUsers } = await adminClient
    .from('users')
    .select('id, full_name, email, role, manager_id')
    .eq('organization_id', orgId)
    .order('full_name')

  // Step 5: KPI catalogue (system templates with org_id = NULL)
  const { data: catalogueKpis } = await adminClient
    .from('kpis')
    .select('id, name, category, description, unit, target_frequency')
    .is('organization_id', null)
    .order('category')
    .order('display_order')

  // Already-assigned KPIs
  const { data: assignedKpis } = await adminClient
    .from('kpis')
    .select('id, name, template_kpi_id, category, unit')
    .eq('organization_id', orgId)

  const assignedTemplateIds = new Set((assignedKpis ?? []).map(k => k.template_kpi_id).filter(Boolean))

  // Step 6: summary counts
  const teamCount = teams?.length ?? 0
  const userCount = orgUsers?.length ?? 0
  const kpiCount = assignedKpis?.length ?? 0

  return (
    <PageShell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          Setup Your Organisation
        </h1>

        {/* Progress bar */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
            Step {currentStep + 1} of {totalSteps}
          </div>
          <div style={{
            height: 8,
            background: '#e5e7eb',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: progressPercent + '%',
              background: '#2563eb',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        {/* Message banner */}
        {message && (
          <div style={{
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 6,
            fontSize: '0.875rem',
            color: '#0369a1',
          }}>
            {message}
          </div>
        )}

        {/* ── Step 0: Diagnostic Questionnaire ── */}
        {currentStep === 0 && (
          <form action={saveDiagnostic}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              Tell us about your organisation
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Q1 */}
              <label style={labelStyle}>
                How many people are in your organisation?
                <input
                  name="people_count"
                  type="number"
                  min="1"
                  required
                  defaultValue={answers.people_count || ''}
                  style={inputStyle}
                />
              </label>

              {/* Q2 */}
              <label style={labelStyle}>
                How many teams or departments?
                <input
                  name="team_count"
                  type="number"
                  min="1"
                  required
                  defaultValue={answers.team_count || ''}
                  style={inputStyle}
                />
              </label>

              {/* Q3 */}
              <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Do you currently run regular 1:1s?</legend>
                {['Yes', 'No', 'Sometimes'].map(opt => (
                  <label key={opt} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="regular_121s"
                      value={opt}
                      required
                      defaultChecked={answers.regular_121s === opt}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>

              {/* Q4 */}
              <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Do you track KPIs formally?</legend>
                {['Yes', 'No', 'Some departments'].map(opt => (
                  <label key={opt} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="track_kpis"
                      value={opt}
                      required
                      defaultChecked={answers.track_kpis === opt}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>

              {/* Q5 */}
              <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Do you have a formal performance review process?</legend>
                {['Yes', 'No'].map(opt => (
                  <label key={opt} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="performance_reviews"
                      value={opt}
                      required
                      defaultChecked={answers.performance_reviews === opt}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>

              {/* Q6 */}
              <label style={labelStyle}>
                What&apos;s your biggest leadership challenge?
                <textarea
                  name="biggest_challenge"
                  maxLength={300}
                  rows={3}
                  defaultValue={answers.biggest_challenge || ''}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </label>

              {/* Q7 */}
              <fieldset style={fieldsetStyle}>
                <legend style={legendStyle}>Are projects tracked anywhere currently?</legend>
                {['Yes', 'No', 'Informally'].map(opt => (
                  <label key={opt} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="project_tracking"
                      value={opt}
                      required
                      defaultChecked={answers.project_tracking === opt}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>
            </div>

            <button type="submit" style={primaryButtonStyle}>
              See My Results &rarr;
            </button>
          </form>
        )}

        {/* ── Step 1: Diagnostic Results ── */}
        {currentStep === 1 && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              Here&apos;s where we can help
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {generateInsights(answers).map((insight, i) => (
                <div key={i} style={{
                  padding: '1rem 1.25rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#fff',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: insight.priority === 'high' ? '#dc2626' : '#f59e0b',
                      flexShrink: 0,
                    }} />
                    <strong style={{ fontSize: '1rem' }}>{insight.title}</strong>
                  </div>
                  <p style={{ margin: 0, color: '#555', fontSize: '0.875rem', lineHeight: 1.5 }}>
                    {insight.description}
                  </p>
                </div>
              ))}
            </div>

            <form action={advanceStep}>
              <input type="hidden" name="next_step" value="2" />
              <button type="submit" style={primaryButtonStyle}>
                Let&apos;s Get Started &rarr;
              </button>
            </form>
          </div>
        )}

        {/* ── Step 2: Create Teams ── */}
        {currentStep === 2 && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              Create Your Teams
            </h2>

            {(teams && teams.length > 0) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#666', marginBottom: '0.75rem' }}>
                  Your teams
                </h3>
                {teams.map(team => (
                  <div key={team.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    marginBottom: '0.5rem',
                    background: '#fff',
                  }}>
                    <span>{team.name}</span>
                    <form action={removeSetupTeam}>
                      <input type="hidden" name="team_id" value={team.id} />
                      <button type="submit" style={dangerSmallButtonStyle}>Remove</button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <form action={addSetupTeam} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <input
                name="name"
                type="text"
                placeholder="Team name"
                required
                maxLength={100}
                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
              />
              <button type="submit" style={secondaryButtonStyle}>Add Team</button>
            </form>

            <form action={advanceStep}>
              <input type="hidden" name="next_step" value="3" />
              <button type="submit" style={primaryButtonStyle}>
                Next &rarr;
              </button>
            </form>
          </div>
        )}

        {/* ── Step 3: Add Users ── */}
        {currentStep === 3 && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              Add Your People
            </h2>

            {(orgUsers && orgUsers.length > 1) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#666', marginBottom: '0.75rem' }}>
                  Current users
                </h3>
                {orgUsers.map(u => (
                  <div key={u.id} style={{
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    marginBottom: '0.5rem',
                    background: '#fff',
                    fontSize: '0.875rem',
                  }}>
                    <strong>{u.full_name}</strong>{' '}
                    <span style={{ color: '#888' }}>({u.email}) — {u.role}</span>
                  </div>
                ))}
              </div>
            )}

            <form action={addSetupUser} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#fafafa',
              marginBottom: '1.5rem',
            }}>
              <input
                name="full_name"
                type="text"
                placeholder="Full name"
                required
                style={{ ...inputStyle, marginTop: 0 }}
              />
              <input
                name="email"
                type="email"
                placeholder="Email address"
                required
                style={{ ...inputStyle, marginTop: 0 }}
              />
              <select name="role" required style={{ ...inputStyle, marginTop: 0 }}>
                <option value="">Select role...</option>
                <option value="manager">Manager</option>
                <option value="contributor">Contributor</option>
              </select>
              <input
                name="temp_password"
                type="text"
                placeholder="Temporary password (min 8 chars)"
                required
                minLength={8}
                style={{ ...inputStyle, marginTop: 0 }}
              />
              <button type="submit" style={secondaryButtonStyle}>Add User</button>
            </form>

            <form action={advanceStep}>
              <input type="hidden" name="next_step" value="4" />
              <button type="submit" style={primaryButtonStyle}>
                Next &rarr;
              </button>
            </form>
          </div>
        )}

        {/* ── Step 4: Reporting Lines ── */}
        {currentStep === 4 && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Set Reporting Lines
            </h2>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Choose who each person reports to. This determines 1:1 pairings and score roll-ups.
            </p>

            <form action={saveReportingLines}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {(orgUsers ?? []).map(u => (
                  <div key={u.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: '#fff',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <strong style={{ fontSize: '0.875rem' }}>{u.full_name}</strong>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>{u.role}</div>
                    </div>
                    <select
                      name={'manager_' + u.id}
                      defaultValue={u.manager_id ?? ''}
                      style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 160 }}
                    >
                      <option value="">No manager</option>
                      {(orgUsers ?? [])
                        .filter(m => m.id !== u.id)
                        .map(m => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))
                      }
                    </select>
                  </div>
                ))}
              </div>

              <button type="submit" style={primaryButtonStyle}>
                Save &amp; Next &rarr;
              </button>
            </form>
          </div>
        )}

        {/* ── Step 5: Choose KPIs ── */}
        {currentStep === 5 && (
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Choose Your KPIs
            </h2>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Pick from the catalogue or create your own. You can always add more later.
            </p>

            <form action={addSetupKpis}>
              {/* Catalogue KPIs grouped by category */}
              {catalogueKpis && catalogueKpis.length > 0 && (() => {
                const categories = Array.from(new Set(catalogueKpis.map(k => k.category)))
                return categories.map(cat => (
                  <div key={cat} style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#888',
                      marginBottom: '0.5rem',
                    }}>
                      {cat}
                    </h3>
                    {catalogueKpis.filter(k => k.category === cat).map(kpi => {
                      const alreadyAdded = assignedTemplateIds.has(kpi.id)
                      return (
                        <label key={kpi.id} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          padding: '0.5rem 0.75rem',
                          border: '1px solid #e5e7eb',
                          borderRadius: 6,
                          marginBottom: '0.375rem',
                          background: alreadyAdded ? '#f0fdf4' : '#fff',
                          cursor: alreadyAdded ? 'default' : 'pointer',
                          opacity: alreadyAdded ? 0.7 : 1,
                        }}>
                          <input
                            type="checkbox"
                            name="catalogue_kpi_id"
                            value={kpi.id}
                            disabled={alreadyAdded}
                            defaultChecked={alreadyAdded}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                              {kpi.name}
                              {kpi.unit && <span style={{ color: '#999', fontWeight: 400 }}> ({kpi.unit})</span>}
                              {alreadyAdded && <span style={{ color: '#16a34a', fontSize: '0.75rem', marginLeft: 6 }}>Added</span>}
                            </div>
                            {kpi.description && (
                              <div style={{ fontSize: '0.75rem', color: '#777' }}>{kpi.description}</div>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                ))
              })()}

              {/* Custom KPI mini-form */}
              <div style={{
                padding: '1rem',
                border: '1px dashed #d1d5db',
                borderRadius: 8,
                background: '#fafafa',
                marginBottom: '1.5rem',
              }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                  Create a custom KPI
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    name="custom_kpi_name"
                    type="text"
                    placeholder="KPI name"
                    maxLength={200}
                    style={{ ...inputStyle, marginTop: 0, flex: 2, minWidth: 160 }}
                  />
                  <input
                    name="custom_kpi_unit"
                    type="text"
                    placeholder="Unit (e.g. %, count)"
                    style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 100 }}
                  />
                  <input
                    name="custom_kpi_target"
                    type="number"
                    placeholder="Target"
                    step="any"
                    style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 80 }}
                  />
                </div>
              </div>

              <button type="submit" style={primaryButtonStyle}>
                Next &rarr;
              </button>
            </form>
          </div>
        )}

        {/* ── Step 6: Complete ── */}
        {currentStep === 6 && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#10003;</div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              You&apos;re all set!
            </h2>
            <p style={{ color: '#555', fontSize: '1rem', marginBottom: '2rem', lineHeight: 1.6 }}>
              {teamCount} team{teamCount !== 1 ? 's' : ''},{' '}
              {userCount} user{userCount !== 1 ? 's' : ''},{' '}
              {kpiCount} KPI{kpiCount !== 1 ? 's' : ''} configured.
            </p>

            <form action={completeSetup}>
              <button type="submit" style={primaryButtonStyle}>
                Go to Dashboard &rarr;
              </button>
            </form>
          </div>
        )}
      </div>
    </PageShell>
  )
}

// ── Insight generation ────────────────────────────────────────────────────────

interface Insight {
  title: string
  description: string
  priority: 'high' | 'medium'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateInsights(answers: any): Insight[] {
  const insights: Insight[] = []

  if (answers.regular_121s === 'No') {
    insights.push({
      title: 'Start tracking 1:1s',
      description: 'Regular 1:1s are the foundation of good leadership. We\'ll help you structure them with templates and automatic follow-up tracking.',
      priority: 'high',
    })
  }
  if (answers.regular_121s === 'Sometimes') {
    insights.push({
      title: 'Formalise your 1:1s',
      description: 'You\'re already doing some 1:1s — great! Making them consistent and tracked will surface patterns you\'re currently missing.',
      priority: 'medium',
    })
  }
  if (answers.track_kpis === 'No') {
    insights.push({
      title: 'Set up your metrics',
      description: 'Without KPIs, it\'s hard to know if things are improving. We\'ll help you pick the right metrics for your teams.',
      priority: 'high',
    })
  }
  if (answers.performance_reviews === 'No') {
    insights.push({
      title: 'Build a performance framework',
      description: 'Our scoring system gives you an objective, data-driven view of how people are performing — no more guesswork at review time.',
      priority: 'high',
    })
  }
  if (answers.project_tracking === 'No' || answers.project_tracking === 'Informally') {
    insights.push({
      title: 'Get project visibility',
      description: 'Tracking projects alongside meetings and KPIs gives you the complete picture of what\'s consuming capacity.',
      priority: 'medium',
    })
  }

  // Always show this one
  insights.push({
    title: 'Unlock leadership insights',
    description: `With ${answers.people_count || 'your'} people, the scoring system will identify who's growing, who needs support, and where your strongest leaders are.`,
    priority: 'high',
  })

  return insights
}

// ── Shared inline styles ──────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#333',
}

const inputStyle: React.CSSProperties = {
  marginTop: '0.375rem',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.875rem',
  outline: 'none',
}

const fieldsetStyle: React.CSSProperties = {
  border: 'none',
  padding: 0,
  margin: 0,
}

const legendStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#333',
  marginBottom: '0.5rem',
}

const radioLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  marginRight: '1rem',
  fontSize: '0.875rem',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '0.625rem 1.5rem',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#f3f4f6',
  color: '#333',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
}

const dangerSmallButtonStyle: React.CSSProperties = {
  padding: '0.25rem 0.75rem',
  background: 'transparent',
  color: '#dc2626',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  fontSize: '0.75rem',
  cursor: 'pointer',
}
