import { login } from './actions'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '2rem', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', minWidth: '320px' }}>
        <h2 style={{ textAlign: 'center', margin: 0 }}>Leadership Hub</h2>
        <p style={{ textAlign: 'center', color: '#6b7280', margin: 0, marginBottom: '1rem', fontSize: '0.875rem' }}>
          Sign in with the credentials provided to you.
        </p>

        {message && (
          <p style={{ textAlign: 'center', color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>
            {message}
          </p>
        )}

        <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
        />

        <label htmlFor="password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
        />

        <button
          formAction={login}
          style={{ padding: '0.625rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '0.5rem' }}
        >
          Sign In
        </button>
      </form>
    </div>
  )
}
