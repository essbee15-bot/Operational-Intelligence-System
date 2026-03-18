'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function changePassword(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const newPassword = formData.get('new_password') as string
  const confirmPassword = formData.get('confirm_password') as string

  if (!newPassword || newPassword.length < 8) {
    redirect('/account/change-password?message=Password must be at least 8 characters')
  }

  if (newPassword !== confirmPassword) {
    redirect('/account/change-password?message=Passwords do not match')
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })

  if (error) {
    redirect(`/account/change-password?message=Failed to update password: ${error.message}`)
  }

  redirect('/?message=Password updated successfully')
}
