'use client'

interface Project { id: string; name: string }

export function ProjectSelector({
  projects,
  currentProjectId,
}: {
  projects: Project[]
  currentProjectId?: string
}) {
  return (
    <select
      id="project_selector"
      defaultValue={currentProjectId ?? ''}
      onChange={e => {
        if (e.target.value) {
          window.location.href = `/meetings/new?type=project_meeting&project_id=${e.target.value}`
        }
      }}
      style={{
        padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px',
        fontSize: '0.875rem', backgroundColor: 'white', width: '100%',
      }}
    >
      <option value="">Select a project…</option>
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}
