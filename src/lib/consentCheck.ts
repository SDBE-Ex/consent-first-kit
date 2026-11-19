// Journey C: a person checks or changes their choices with the code they were given.
// The code is the only credential, so lookups are rate-limited in the database (migration 0005).
import { supabase } from './supabase'

export interface ConsentState {
  care: boolean
  research: boolean
  ai_training: boolean
  withdrawn: boolean
  purpose: string
  end_date: string
}

/** Codes look like ABCD-EFGH. Accept lower case, spaces and a missing dash. */
export function normaliseCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null
}

export async function lookupConsent(code: string): Promise<ConsentState | null> {
  if (!supabase) throw new Error('Server not configured')
  const { data, error } = await supabase.rpc('get_consent', { p_check_code: code })
  if (error) throw new Error(error.message)
  return (data as ConsentState[] | null)?.[0] ?? null
}

export async function changeConsent(code: string, care: boolean, research: boolean, ai: boolean): Promise<void> {
  if (!supabase) throw new Error('Server not configured')
  const { error } = await supabase.rpc('update_consent', {
    p_check_code: code, p_care: care, p_research: research, p_ai: ai,
  })
  if (error) throw new Error(error.message)
}
