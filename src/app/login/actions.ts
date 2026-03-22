'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    // Map Supabase error codes to friendly messages
    const msg = error.message?.toLowerCase() ?? ''
    if (msg.includes('email not confirmed')) {
      redirect('/login?message=This account has not confirmed its email. Ask your admin to resend the confirmation or reset your password.')
    }
    if (msg.includes('invalid login credentials') || msg.includes('invalid password') || msg.includes('user not found')) {
      redirect('/login?message=Invalid email or password')
    }
    // Pass through any other Supabase error so it's visible
    redirect(`/login?message=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
