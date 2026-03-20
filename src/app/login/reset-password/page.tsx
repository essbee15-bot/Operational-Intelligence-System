import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { resetPassword } from './actions'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // This page is only reachable via a valid reset link.
  // If there's no session, the link was not used or has expired.
  if (!user) redirect('/login')

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '2rem', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', minWidth: '320px' }}>
        <h2 style={{ textAlign: 'center', margin: 0 }}>Set a new password</h2>
        <p style={{ textAlign: 'center', color: '#6b7280', margin: 0, marginBottom: '0.25rem', fontSize: '0.875rem' }}>
          Choose a new password for your account.
        </p>

        {message && (
          <p style={{ textAlign: 'center', color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>
            {message}
          </p>
        )}

        <label htmlFor="password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>New password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
        />

        <label htmlFor="confirm" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Confirm password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
        />

        <button
          formAction={resetPassword}
          style={{ padding: '0.625rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '0.5rem' }}
        >
          Update password
        </button>
      </form>
    </div>
  )
}
