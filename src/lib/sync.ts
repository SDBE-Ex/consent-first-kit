// Pushes encrypted-at-rest local submissions to the server when the phone has signal.
// Answers and identity go to separate RPCs, so they are never in the same request body or table.
import { supabase } from './supabase'
import { clearSubmission, listPending } from './localStore'

export async function syncNow(): Promise<{ synced: number; skipped: string | null }> {
  if (!supabase) return { synced: 0, skipped: 'Server not configured yet' }
  if (!navigator.onLine) return { synced: 0, skipped: 'No signal' }

  let synced = 0
  for (const sub of await listPending()) {
    const { error } = await supabase.rpc('submit_answers', {
      p_dataset_id: sub.datasetId,
      p_check_code: sub.checkCode,
      p_lang: sub.lang,
      p_consent_care: sub.consent.care,
      p_consent_research: sub.consent.research,
      p_consent_ai: sub.consent.aiTraining,
      p_answers: sub.answers,
    })
    if (error) continue
    if (sub.identity) {
      const { error: idErr } = await supabase.rpc('submit_identity', {
        p_check_code: sub.checkCode,
        p_identity: sub.identity,
      })
      if (idErr) continue
    }
    await clearSubmission(sub.localId)
    synced++
  }
  return { synced, skipped: null }
}
