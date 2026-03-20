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
