import { requestPasswordReset } from './actions'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams

  const isPlatformAdmin = message === 'platform_admin'
  const isSent = message === 'sent'
  const isExpired = message === 'expired'

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '2rem', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', minWidth: '320px' }}>
        <h2 style={{ textAlign: 'center', margin: 0 }}>Reset your password</h2>

        {!isSent && !isPlatformAdmin && (
          <p style={{ textAlign: 'center', color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
            Enter your email and we&apos;ll send you a reset link.
          </p>
        )}

        {isPlatformAdmin && (
          <p style={{ textAlign: 'center', color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', padding: '0.75rem', fontSize: '0.875rem', margin: 0 }}>
            Please contact your system administrator to reset your account.
          </p>
        )}

        {isSent && (
          <p style={{ textAlign: 'center', color: '#166534', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '4px', padding: '0.75rem', fontSize: '0.875rem', margin: 0 }}>
            If that email is registered, a reset link is on its way. Check your inbox.
          </p>
        )}

        {isExpired && (
          <p style={{ textAlign: 'center', color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>
            That link has expired or is invalid. Please request a new one.
          </p>
        )}

        {!isSent && !isPlatformAdmin && (
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
            />
            <button
              formAction={requestPasswordReset}
              style={{ padding: '0.625rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '0.25rem' }}
            >
              Send reset link
            </button>
          </form>
        )}

        <a
          href="/login"
          style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', marginTop: '0.25rem' }}
        >
          ← Back to sign in
        </a>
      </div>
    </div>
  )
}
