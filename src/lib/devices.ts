// Device enrolment (migration 0004). A programme lead creates a one-time code for a phone; the phone
// trades it once, online, for a token that proves it is enrolled when it syncs. Collection itself
// works offline: the token is only checked on the server at sync time.
import { supabase } from './supabase'

export interface DeviceRow {
  id: string
  label: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

/** Lead: a one-time code (valid 24 hours) to type into a health worker's phone. */
export async function createEnrolment(label: string): Promise<string> {
  if (!supabase) throw new Error('Server not configured')
  const { data, error } = await supabase.rpc('create_enrolment', { p_label: label.trim() })
  if (error) throw new Error(error.message)
  return data as string
}

/** Phone: trade a code for a device token. Returns null when the code is wrong, used or expired. */
export async function redeemEnrolment(code: string): Promise<string | null> {
  if (!supabase) throw new Error('Server not configured')
  const { data, error } = await supabase.rpc('redeem_enrolment', { p_code: code })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function listDevices(): Promise<DeviceRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('my_devices')
  if (error) throw new Error(error.message)
  return (data as DeviceRow[]) ?? []
}

export async function revokeDevice(id: string) {
  if (!supabase) throw new Error('Server not configured')
  const { error } = await supabase.rpc('revoke_device', { p_id: id })
  if (error) throw new Error(error.message)
}
