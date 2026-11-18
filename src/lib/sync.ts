// Pushes encrypted-at-rest local submissions to the server when the phone has signal.
// Answers and identity go to separate RPCs, so they are never in the same request body or table.
// Both RPCs are idempotent (migration 0003), so a record that half-synced is safe to retry.
// Both require an enrolled phone (migration 0004).
import { supabase } from './supabase'
import { clearDeviceToken, clearSubmission, getDeviceToken, listPending } from './localStore'

export interface SyncResult {
  synced: number
  failed: number // records that stay on the phone, encrypted, to be retried
  skipped: string | null
}

const NOT_ENROLLED = 'This phone is not enrolled. Ask your programme lead for a code.'
const REVOKED = 'This phone was removed by your programme lead. Ask for a new code to enrol again.'

export async function syncNow(): Promise<SyncResult> {
  if (!supabase) return { synced: 0, failed: 0, skipped: 'Server not configured yet' }
  if (!navigator.onLine) return { synced: 0, failed: 0, skipped: 'No signal' }
  const token = await getDeviceToken()
  if (!token) return { synced: 0, failed: 0, skipped: NOT_ENROLLED }

  let synced = 0
  let failed = 0
  for (const sub of await listPending()) {
    const { error } = await supabase.rpc('submit_answers', {
      p_device_token: token,
      p_dataset_id: sub.datasetId,
      p_check_code: sub.checkCode,
      p_lang: sub.lang,
      p_consent_care: sub.consent.care,
      p_consent_research: sub.consent.research,
      p_consent_ai: sub.consent.aiTraining,
      p_answers: sub.answers,
    })
    if (error) {
      // The server refused the phone itself: stop, keep everything on the phone, and say why.
      if (error.message.includes('device not enrolled')) {
        await clearDeviceToken()
        return { synced, failed: failed + 1, skipped: REVOKED }
      }
      failed++
      continue
    }
    if (sub.identity) {
      const { error: idErr } = await supabase.rpc('submit_identity', {
        p_device_token: token,
        p_check_code: sub.checkCode,
        p_identity: sub.identity,
      })
      if (idErr) {
        failed++
        continue
      }
    }
    await clearSubmission(sub.localId)
    synced++
  }
  return { synced, failed, skipped: null }
}
