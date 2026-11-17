import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'lead' | 'reviewer' | 'worker' | null

/** Current session and staff role. Role comes from answers.staff, granted by an admin. */
export function useStaff() {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    const load = async (s: Session | null) => {
      setSession(s)
      if (s) {
        const { data } = await supabase!.rpc('my_role')
        setRole((data as Role) ?? null)
      } else setRole(null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => load(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, role, loading }
}

/** Email magic link: no passwords for staff to manage or leak. */
export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error('Server not configured')
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/lead`, shouldCreateUser: true },
  })
  if (error) throw error
}

export async function signOut() {
  await supabase?.auth.signOut()
}
