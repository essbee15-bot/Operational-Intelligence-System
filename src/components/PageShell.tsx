import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { redirect } from 'next/navigation'
import { signout } from '@/app/login/actions'
import Sidebar from './Sidebar'
import AiChatWidget from './AiChatWidget'

export default async function PageShell({
  children,
  requireAuth = true,
}: {
  children: React.ReactNode
  requireAuth?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (requireAuth && !user) redirect('/login')

  if (!user) {
    return <>{children}</>
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, role, is_platform_admin, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const isPlatformAdmin = profile.is_platform_admin ?? false
  const isAdmin = profile.role === 'admin'
  const name = profile.full_name ?? user.email ?? 'User'

  const adminClient = createAdminClient()

  // Fetch org name for display in sidebar
  let orgName: string | null = null
  // Check if AI assistant is enabled for this org (show chat widget)
  let aiEnabled = false

  if (!isPlatformAdmin && profile.organization_id) {
    const [{ data: org }, { data: aiSettings }] = await Promise.all([
      adminClient
        .from('organizations')
        .select('name')
        .eq('id', profile.organization_id)
        .single(),
      adminClient
        .from('ai_settings')
        .select('is_enabled, api_key')
        .eq('organization_id', profile.organization_id)
        .single(),
    ])
    orgName = org?.name ?? null
    aiEnabled = !!(aiSettings?.is_enabled && aiSettings?.api_key)
  }

  return (
    <div className="app-shell">
      <Sidebar
        name={name}
        role={profile.role ?? 'contributor'}
        orgName={orgName}
        isPlatformAdmin={isPlatformAdmin}
        isAdmin={isAdmin}
        signoutAction={signout}
      />
      <div className="shell-content">
        {children}
      </div>
      {aiEnabled && <AiChatWidget />}
    </div>
  )
}
