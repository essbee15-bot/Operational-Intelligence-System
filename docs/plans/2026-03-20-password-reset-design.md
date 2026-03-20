# Password Reset — Design Doc

**Date:** 2026-03-20
**Status:** Approved

---

## Problem

There is no way for a user to recover their account if they forget their password. The login screen has no reset flow. A platform-admin lockout would require direct Supabase dashboard access, which is appropriate for that role but nothing exists for ordinary users or org admins.

---

## Decision

- **Regular users and org admins** — standard email-based reset via Supabase Auth + Resend as the SMTP provider.
- **Platform admins** — manual reset via the Supabase dashboard (out-of-band, no in-app flow). The forgot-password form detects platform-admin emails and shows a "contact your system administrator" message instead of sending a link.

---

## Architecture

```
Login page
  └─ "Forgot password?" link
        └─ /login/forgot-password          (email entry form + server action)
              └─ supabase.auth.resetPasswordForEmail()
                    └─ Resend (SMTP) sends the email
                          └─ link → /auth/callback?next=/login/reset-password
                                └─ /auth/callback              (PKCE exchange route handler)
                                      └─ exchanges code → session
                                            └─ /login/reset-password   (new password form + server action)
                                                  └─ supabase.auth.updateUser({ password })
                                                        └─ redirect → /login
```

---

## New Files

| File | Purpose |
|------|---------|
| `src/app/login/forgot-password/page.tsx` | Email entry form |
| `src/app/login/forgot-password/actions.ts` | Server action — platform-admin check, calls `resetPasswordForEmail()` |
| `src/app/auth/callback/route.ts` | Route handler — exchanges PKCE code, redirects to reset page |
| `src/app/login/reset-password/page.tsx` | New password + confirm password form |
| `src/app/login/reset-password/actions.ts` | Server action — calls `supabase.auth.updateUser({ password })` |

### Modified Files

| File | Change |
|------|--------|
| `src/app/login/page.tsx` | Add "Forgot password?" link beneath the Sign In button |

---

## User Flows

### Contributor / Manager / Org Admin
1. Click "Forgot password?" on login screen
2. Enter email → submit
3. See "If that email is registered, a reset link is on its way" (always shown regardless of whether email exists)
4. Click link in email → `/auth/callback` exchanges PKCE code → redirect to `/login/reset-password`
5. Enter new password + confirmation → submit
6. Redirected to `/login` with success message

### Platform Admin
1. Click "Forgot password?" on login screen
2. Enter email → submit
3. Server detects `is_platform_admin = true` → no email sent
4. User sees: "Please contact your system administrator to reset your account."

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Email not in system | Show generic success message — never confirm/deny existence |
| Platform admin email | Show "contact system administrator" message, no email sent |
| Reset link expired (Supabase default: 1 hour) | `/auth/callback` redirects to `/login/forgot-password?message=Link+expired` |
| Passwords don't match | Client-side validation before submit |
| Password too short | Client-side + server-side min 8 characters |
| Reset page visited without valid session | Redirect to `/login` |
| Multiple reset requests | Each new request invalidates previous link (Supabase-native behaviour) |

---

## Password Rules

- Minimum 8 characters
- Must match confirmation field
- Validated client-side (UX) and server-side (security) before calling Supabase

---

## One-Time Manual Setup (Supabase Dashboard)

These are not code changes — they are done once by the system administrator:

1. **Auth → SMTP Settings** — enter Resend SMTP credentials (host, port, username, password)
2. **Auth → URL Configuration** — add allowed redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://<production-domain>/auth/callback`

---

## Out of Scope

- Security questions (not needed given email reset + Supabase dashboard for platform admin)
- Admin-mediated reset requests/notifications
- In-app notification system for reset requests
- Rate limiting (Supabase applies its own limits on auth emails)
