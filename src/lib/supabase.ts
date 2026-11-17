import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null until .env.local is filled in; the app still runs fully offline without it. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null
