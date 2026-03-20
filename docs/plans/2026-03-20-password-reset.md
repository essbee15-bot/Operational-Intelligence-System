# Password Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Forgot password?" flow to the login screen using Supabase Auth + Resend as the SMTP provider, with a special "contact your administrator" message for platform admins.

**Architecture:** Five new files (two pages, two server actions, one route handler) plus a one-line change to the login page. Supabase handles all token security via its PKCE reset flow. The admin client (`createAdminClient`) is used only to detect platform-admin emails before deciding whether to send a reset link.

**Tech Stack:** Next.js 16 App Router, Supabase SSR (`@supabase/ssr`), existing `createClient` / `createAdminClient` helpers.

---

## Pre-flight: One-time Supabase Dashboard Config

These are manual steps — do them before starting the code tasks. They cannot be automated.

1. **Supabase dashboard → Authentication → SMTP Settings**
   - Enable custom SMTP
   - Host: `smtp.resend.com`, Port: `465`, User: `resend`, Password: your Resend API key
   - Sender name: `Leadership Hub`, Sender email: a verified Resend sender address

2. **Supabase dashboard → Authentication → URL Configuration**
   - Add to "Redirect URLs" allowlist:
     - `http://localhost:3000/auth/callback`
     - `https://<your-production-domain>/auth/callback`

---

## Task 1: Add "Forgot password?" link to the login page

**Files:**
- Modify: `src/app/login/page.tsx`

**Step 1: Add the link**

Inside `src/app/login/page.tsx`, add this `<a>` tag immediately after the closing `</button>` of the Sign In button (line 42):

```tsx
<a
  href="/login/forgot-password"
  style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#6b7280', textDecoration: 'none', marginTop: '0.25rem' }}
>
  Forgot your password?
</a>
```

Also update the message paragraph (line 14) to handle both red errors and green success messages:

```tsx
{message && (
  <p style={{
    textAlign: 'center',
    color: message.startsWith('Password updated') ? '#166534' : '#dc2626',
    fontSize: '0.875rem',
    margin: 0,
  }}>
    {message}
  </p>
)}
```

**Step 2: Verify in browser**

Start dev server (`npm run dev`). Visit `http://localhost:3000/login`. Confirm the "Forgot your password?" link appears below Sign In and clicking it navigates to `/login/forgot-password` (404 is expected at this stage).

**Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: add forgot password link to login page"
```

---

## Task 2: Create the forgot-password page

**Files:**
- Create: `src/app/login/forgot-password/page.tsx`

**Step 1: Create the file**

```tsx
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
```

**Step 2: Verify in browser**

Visit `http://localhost:3000/login/forgot-password`. Confirm:
- The email form renders
- `?message=sent` shows the green confirmation banner and hides the form
- `?message=platform_admin` shows the amber "contact administrator" message and hides the form
- `?message=expired` shows the red expiry message and keeps the form visible
- "← Back to sign in" navigates to `/login`

**Step 3: Commit**

```bash
git add src/app/login/forgot-password/page.tsx
git commit -m "feat: add forgot-password page"
```

---

## Task 3: Create the forgot-password server action

**Files:**
- Create: `src/app/login/forgot-password/actions.ts`

**Step 1: Create the file**

```ts
'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get('email') as string).trim().toLowerCase()

  // Use the admin client (bypasses RLS) to check if this is a platform admin.
  // We must never reveal whether an email exists, but platform admins need
  // a different message since email reset won't be their recovery path.
  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('is_platform_admin')
    .eq('email', email)
    .maybeSingle()

  if (profile?.is_platform_admin) {
    redirect('/login/forgot-password?message=platform_admin')
  }

  // Derive the origin for the redirect URL.
  const headersList = await headers()
  const origin = headersList.get('origin') ?? headersList.get('x-forwarded-proto')
    ? `${headersList.get('x-forwarded-proto')}://${headersList.get('host')}`
    : 'http://localhost:3000'

  const supabase = await createClient()

  // Fire and forget — we never tell the caller whether the email exists.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/login/reset-password`,
  })

  // Always show the same success message regardless of outcome.
  redirect('/login/forgot-password?message=sent')
}
```

**Step 2: Manual smoke test**

With the dev server running:
1. Submit the form with an **unknown email** → should redirect to `?message=sent` (no error revealed)
2. Submit with a **known non-admin email** → should redirect to `?message=sent` (check Supabase Auth logs to confirm the email was queued)
3. Submit with a **platform-admin email** → should redirect to `?message=platform_admin`

**Step 3: Commit**

```bash
git add src/app/login/forgot-password/actions.ts
git commit -m "feat: add forgot-password server action with platform-admin guard"
```

---

## Task 4: Create the auth callback route handler

This route exchanges the PKCE code that Supabase embeds in the reset email link. Without it, Supabase can't establish the session needed to update the password.

**Files:**
- Create: `src/app/auth/callback/route.ts`

**Step 1: Create the file**

```ts
import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Code missing or exchange failed — link is expired/already used.
  return NextResponse.redirect(
    `${origin}/login/forgot-password?message=expired`
  )
}
```

**Step 2: Verify**

After Task 3's smoke test produced a real email in your inbox, click the reset link. You should be redirected through `/auth/callback` to `/login/reset-password` (which will 404 until Task 5). Check the browser URL to confirm the callback did not redirect to the error page.

**Step 3: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "feat: add auth callback route for PKCE code exchange"
```

---

## Task 5: Create the reset-password page

**Files:**
- Create: `src/app/login/reset-password/page.tsx`

**Step 1: Create the file**

```tsx
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
```

**Step 2: Verify in browser**

- Visiting `/login/reset-password` directly (no session) should redirect to `/login`
- Arriving via a valid reset email link should show the new password form
- `?message=Passwords+do+not+match` should display the error in red above the form

**Step 3: Commit**

```bash
git add src/app/login/reset-password/page.tsx
git commit -m "feat: add reset-password page"
```

---

## Task 6: Create the reset-password server action

**Files:**
- Create: `src/app/login/reset-password/actions.ts`

**Step 1: Create the file**

```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function resetPassword(formData: FormData) {
  const password = formData.get('password') as string
  const confirm = formData.get('confirm') as string

  // Server-side validation (client minLength is UX only, not security).
  if (password.length < 8) {
    redirect('/login/reset-password?message=Password+must+be+at+least+8+characters')
  }

  if (password !== confirm) {
    redirect('/login/reset-password?message=Passwords+do+not+match')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect('/login/reset-password?message=Failed+to+update+password.+Please+try+again.')
  }

  // Sign out so the user returns to a clean login state.
  await supabase.auth.signOut()
  redirect('/login?message=Password+updated+successfully.+Please+sign+in.')
}
```

**Step 2: End-to-end smoke test**

Run the full flow from start to finish:

1. Go to `http://localhost:3000/login`
2. Click "Forgot your password?"
3. Enter a real non-admin user email → submit
4. Check email inbox → click the reset link
5. On the reset page, enter mismatched passwords → confirm error message appears
6. Enter a valid new password (8+ chars, matching) → submit
7. Confirm redirect to `/login` with green *"Password updated successfully. Please sign in."* message
8. Sign in with the new password → confirm login works

**Step 3: Test the platform-admin guard**

1. On `forgot-password`, enter the platform-admin email → submit
2. Confirm redirect to `?message=platform_admin` with the amber "contact system administrator" message
3. Confirm no email arrives in the platform-admin inbox

**Step 4: Test the expiry path**

1. Request a reset link for a user email
2. Request a second link immediately (this invalidates the first)
3. Click the first (now-invalid) link → confirm redirect to `?message=expired` on the forgot-password page

**Step 5: Commit**

```bash
git add src/app/login/reset-password/actions.ts
git commit -m "feat: add reset-password server action"
```

---

## Task 7: Final build check

**Step 1: Run the production build**

```bash
npm run build
```

Expected: `✓ Compiled successfully` with no TypeScript errors.

**Step 2: Commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: address build warnings from password reset pages"
```

---

## Summary of all new files

| File | Role |
|------|------|
| `src/app/login/page.tsx` | +link + green/red message colour |
| `src/app/login/forgot-password/page.tsx` | Email entry form, state banners |
| `src/app/login/forgot-password/actions.ts` | Platform-admin guard, `resetPasswordForEmail` |
| `src/app/auth/callback/route.ts` | PKCE code exchange |
| `src/app/login/reset-password/page.tsx` | New password form, session guard |
| `src/app/login/reset-password/actions.ts` | Validation, `updateUser`, sign-out |
