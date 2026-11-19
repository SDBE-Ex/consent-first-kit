// Journey D: the community council decides every new use of the data.
// Leads file requests, council members vote with a written reason, anyone can read what was decided.
// Approval never releases data. It only shows how many records the owners agreed to share for that use.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { signOut, useStaff } from '../lib/auth'
import {
  castVote, eligibleRecords, fileRequest, listRequests, publicDecisions, STATUS_LABEL, USE_LABEL,
  type CouncilRequest, type PublicDecision, type UseType, type VoteKind,
} from '../lib/council'
import { myForms } from '../lib/forms'
import { supabase } from '../lib/supabase'
import type { Dataset } from '../types'

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

// ---------- Public: what the community has decided ----------
export function Decisions() {
  const [rows, setRows] = useState<PublicDecision[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    publicDecisions().then(setRows).catch((e) => setErr(message(e, 'Could not load decisions')))
  }, [])
  return (
    <main>
      <h1>Who may use this data</h1>
      <p>Nobody uses the answers collected here without the community council saying yes. These are the council's decisions.</p>
      {err && <p className="status">{err}</p>}
      {rows?.length === 0 && <p className="status">No decisions yet. Nothing has been shared with anyone.</p>}
      {rows?.map((d, i) => (
        <section key={i} className="qcard">
          <strong>{d.requester}</strong>
          <span className="status">{USE_LABEL[d.use_type]} · {d.dataset_title}</span>
          <p>{d.purpose}</p>
          <p><strong>{STATUS_LABEL[d.status]}</strong> on {new Date(d.decided_at).toLocaleDateString()}</p>
          {d.conditions && <p className="draft">Conditions: {d.conditions}</p>}
        </section>
      ))}
    </main>
  )
}

// ---------- Council members and leads ----------
export function CouncilHome() {
  const { session, role, loading } = useStaff()
  if (!supabase) return <main><p>Server not configured.</p></main>
  if (loading) return <main><p className="status">Loading…</p></main>
  if (!session)
    return (
      <main>
        <h1>Council sign-in</h1>
        <p>Sign in with your email link first.</p>
        <Link to="/lead">Go to sign-in</Link>
      </main>
    )
  if (role !== 'council' && role !== 'lead')
    return (
      <main>
        <h1>Waiting for access</h1>
        <p>Signed in as {session.user.email}. An admin needs to add you to the council before you can see requests.</p>
        <button onClick={signOut}>Sign out</button>
      </main>
    )
  return <CouncilInner role={role} />
}

function CouncilInner({ role }: { role: 'council' | 'lead' }) {
  const [requests, setRequests] = useState<CouncilRequest[]>([])
  const [err, setErr] = useState('')
  const refresh = () => listRequests().then(setRequests).catch((e) => setErr(message(e, 'Could not load requests')))
  useEffect(() => { listRequests().then(setRequests).catch((e) => setErr(message(e, 'Could not load requests'))) }, [])
  const size = requests[0]?.council_size ?? 0
  return (
    <main>
      <h1>{role === 'council' ? 'Council requests' : 'Requests to use the data'}</h1>
      {role === 'council' && (
        <p className="status">
          You decide whether the data may be used, and on what terms. A request is decided when a majority of the whole
          council ({requests[0]?.majority ?? 2} of {size || '…'}) agree. Your vote cannot be changed, and nobody can see who voted how.
        </p>
      )}
      {size > 0 && size < 3 && <p className="warn">The council has fewer than 3 members. Nothing can be decided until there are at least 3.</p>}
      {err && <p className="status">{err}</p>}
      {role === 'lead' && <NewRequest onFiled={refresh} />}
      {requests.length === 0 && <p className="status">No requests yet.</p>}
      {requests.map((r) => <RequestCard key={r.id} r={r} role={role} onChange={refresh} />)}
      <Link to="/decisions">What the public sees</Link>
      {role === 'lead' && <Link to="/lead">Back to your forms</Link>}
      <button className="link" onClick={signOut}>Sign out</button>
    </main>
  )
}

// ---------- A lead files a request on behalf of someone who wants to use a dataset ----------
function NewRequest({ onFiled }: { onFiled: () => void }) {
  const [forms, setForms] = useState<Dataset[]>([])
  const [open, setOpen] = useState(false)
  const [datasetId, setDatasetId] = useState('')
  const [requester, setRequester] = useState('')
  const [useType, setUseType] = useState<UseType>('research')
  const [purpose, setPurpose] = useState('')
  const [benefit, setBenefit] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    myForms().then((f) => {
      const live = f.filter((x) => x.status === 'published')
      setForms(live)
      setDatasetId((cur) => cur || live[0]?.id || '')
    }).catch(() => setForms([]))
  }, [])
  const ready = datasetId && requester.trim().length >= 3 && purpose.trim().length >= 20 && benefit.trim().length >= 20
  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await fileRequest({ datasetId, requester, useType, purpose, communityBenefit: benefit })
      setRequester(''); setPurpose(''); setBenefit(''); setOpen(false)
      onFiled()
    } catch (e) {
      setErr(message(e, 'Could not file the request'))
    } finally {
      setBusy(false)
    }
  }
  if (!open) return <button className="primary" onClick={() => setOpen(true)}>File a new request</button>
  return (
    <section className="col">
      <h2>New request</h2>
      <p className="status">Say plainly who is asking, what they want to do, and how the community benefits. The council reads exactly this.</p>
      {forms.length === 0 && <p className="warn">Only published forms can be requested. Publish a form first.</p>}
      <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
        {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
      </select>
      <input placeholder="Who is asking? (organisation or person)" value={requester} maxLength={120} onChange={(e) => setRequester(e.target.value)} />
      <select value={useType} onChange={(e) => setUseType(e.target.value as UseType)}>
        {(Object.keys(USE_LABEL) as UseType[]).map((u) => <option key={u} value={u}>{USE_LABEL[u]}</option>)}
      </select>
      {useType === 'ai_training' && <p className="warn">Only answers from people who said yes to AI training can ever be counted for this.</p>}
      <textarea placeholder="What will they do with it? (at least 20 characters)" value={purpose} rows={3} onChange={(e) => setPurpose(e.target.value)} />
      <textarea placeholder="How does the community benefit? (at least 20 characters)" value={benefit} rows={3} onChange={(e) => setBenefit(e.target.value)} />
      {err && <p className="status">{err}</p>}
      <div className="row">
        <button onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary" disabled={!ready || busy} onClick={submit}>File request</button>
      </div>
    </section>
  )
}

// ---------- One request: read it, vote, or see the count once approved ----------
function RequestCard({ r, role, onChange }: { r: CouncilRequest; role: 'council' | 'lead'; onChange: () => void }) {
  const approved = r.status === 'approved' || r.status === 'approved_with_conditions'
  const [count, setCount] = useState<{ n: number | null } | null>(null)
  const [err, setErr] = useState('')
  async function showCount() {
    setErr('')
    try {
      setCount({ n: await eligibleRecords(r.id) })
    } catch (e) {
      setErr(message(e, 'Could not get the count'))
    }
  }
  return (
    <section className={`qcard${approved ? ' approved' : ''}`}>
      <strong>{r.requester}</strong>
      <span className="status">{USE_LABEL[r.use_type]} · {r.dataset_title}</span>
      <p><strong>What they will do:</strong> {r.purpose}</p>
      <p><strong>Benefit to the community:</strong> {r.community_benefit}</p>
      <p><strong>{STATUS_LABEL[r.status]}</strong>
        {r.status === 'pending' && ` · ${r.votes.length} of ${r.council_size} have voted, ${r.majority} needed to decide`}</p>
      {r.conditions && <p className="draft">Conditions: {r.conditions}</p>}
      {r.votes.map((v, i) => (
        <p key={i} className="status">{v.vote === 'reject' ? 'Reject' : v.vote === 'approve' ? 'Approve' : 'Approve with conditions'}: {v.reason}</p>
      ))}
      {r.status === 'pending' && role === 'council' && !r.i_voted && <VoteForm id={r.id} onVoted={onChange} />}
      {r.status === 'pending' && role === 'council' && r.i_voted && <p className="status">You have voted. Your vote cannot be changed.</p>}
      {approved && (
        <>
          <button onClick={showCount}>How many records can this use cover?</button>
          {count && (
            <p className="status">
              {count.n === null
                ? 'Fewer than 5 records (or none). The number is hidden so it cannot point at a person.'
                : `${count.n} records, counting only people who agreed to ${USE_LABEL[r.use_type].toLowerCase()} and have not withdrawn.`}
            </p>
          )}
          <p className="status">Approval does not hand over any answers. Nothing leaves the kit until a release path is built and the council agrees how.</p>
        </>
      )}
      {err && <p className="status">{err}</p>}
    </section>
  )
}

function VoteForm({ id, onVoted }: { id: string; onVoted: () => void }) {
  const [vote, setVote] = useState<VoteKind | null>(null)
  const [reason, setReason] = useState('')
  const [conditions, setConditions] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = vote && reason.trim().length >= 10 && (vote !== 'approve_with_conditions' || conditions.trim().length >= 10)
  async function submit() {
    if (!vote) return
    if (!window.confirm('Your vote cannot be changed. Cast it now?')) return
    setBusy(true)
    setErr('')
    try {
      await castVote(id, vote, reason, vote === 'approve_with_conditions' ? conditions : undefined)
      onVoted()
    } catch (e) {
      setErr(message(e, 'Could not cast the vote'))
    } finally {
      setBusy(false)
    }
  }
  const choice = (v: VoteKind, label: string) => (
    <button className={vote === v ? 'on' : ''} onClick={() => setVote(v)}>{label}</button>
  )
  return (
    <div className="col">
      <div className="row">
        {choice('approve', 'Approve')}
        {choice('approve_with_conditions', 'Approve with conditions')}
        {choice('reject', 'Reject')}
      </div>
      {vote === 'approve_with_conditions' && (
        <textarea placeholder="What must they agree to? (at least 10 characters)" value={conditions} rows={2} onChange={(e) => setConditions(e.target.value)} />
      )}
      <textarea placeholder="Your reason, in your own words (at least 10 characters)" value={reason} rows={2} onChange={(e) => setReason(e.target.value)} />
      {err && <p className="status">{err}</p>}
      <button className="primary" disabled={!ready || busy} onClick={submit}>Cast my vote</button>
    </div>
  )
}
