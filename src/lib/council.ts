// The community council decides every new use of the data (migration 0006).
// Leads file requests, council members vote, everyone can read what was decided.
// Approval never releases data: it only unlocks a count of the records whose owners agreed.
import { supabase } from './supabase'

export type UseType = 'care' | 'research' | 'ai_training'
export type VoteKind = 'approve' | 'approve_with_conditions' | 'reject'
export type RequestStatus = 'pending' | 'approved' | 'approved_with_conditions' | 'rejected'

export interface CouncilRequest {
  id: string
  dataset_id: string
  dataset_title: string
  requester: string
  use_type: UseType
  purpose: string
  community_benefit: string
  status: RequestStatus
  conditions: string | null
  created_at: string
  decided_at: string | null
  council_size: number
  majority: number
  /** Reasons only. Who cast each vote is never shown. */
  votes: { vote: VoteKind; reason: string; conditions: string | null }[]
  i_voted: boolean
}

export interface PublicDecision {
  dataset_title: string
  requester: string
  use_type: UseType
  purpose: string
  status: RequestStatus
  conditions: string | null
  decided_at: string
}

export const USE_LABEL: Record<UseType, string> = {
  care: 'Care',
  research: 'Research',
  ai_training: 'AI training',
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for the council',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Server not configured')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listRequests = () => rpc<CouncilRequest[]>('council_requests').then((d) => d ?? [])

export const publicDecisions = () => rpc<PublicDecision[]>('public_decisions').then((d) => d ?? [])

export const fileRequest = (r: {
  datasetId: string
  requester: string
  useType: UseType
  purpose: string
  communityBenefit: string
}) =>
  rpc<string>('file_use_request', {
    p_dataset_id: r.datasetId,
    p_requester: r.requester,
    p_use_type: r.useType,
    p_purpose: r.purpose,
    p_community_benefit: r.communityBenefit,
  })

/** Returns the request's status after this vote ('pending' until one side holds a majority). */
export const castVote = (requestId: string, vote: VoteKind, reason: string, conditions?: string) =>
  rpc<RequestStatus>('cast_vote', { p_request_id: requestId, p_vote: vote, p_reason: reason, p_conditions: conditions ?? null })

/** A count, never records. Null when 1 to 4 (too few to show safely). */
export const eligibleRecords = (requestId: string) => rpc<number | null>('eligible_records', { p_request_id: requestId })
